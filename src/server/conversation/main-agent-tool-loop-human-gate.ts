import { randomUUID } from "node:crypto";

import { actionRiskForTool, createPendingDecisionForAction, evaluateActionPolicy } from "@/server/guards/action-policy";
import { createHumanGateActionId } from "@/server/guards/human-gate";
import { resolveBudgetUpgrade, resolveStandardTaskBudget } from "@/server/guards/task-budget-policy";
import type { MainAgentToolDefinition } from "@/server/tools/main-agent-tool-registry";

import type { MainAgentReActDispatchResult } from "./main-agent-controlled-react-loop";
import type { MainAgentToolLoopCall, MainAgentToolLoopContext } from "./main-agent-tool-loop-types";
import type { PptAssetBatchExecutionPlan } from "./main-agent-tool-loop-ppt-assets";
import {
  compactContinuationObservation,
  persistAgentToolObservation,
  toolInvocationReplayResult,
} from "./main-agent-tool-loop-observations";
import { appendAgentObservationMetadata, createAgentObservation, type AgentObservation } from "./react-control";
import type { ExecutionEnvelope, IntentGrant } from "./task-contract";

type TaskAggregate = NonNullable<Awaited<ReturnType<MainAgentToolLoopContext["controlPlaneStore"]["getTaskAggregate"]>>>;

export async function handleHumanGate(input: {
  context: MainAgentToolLoopContext;
  definition: MainAgentToolDefinition;
  call: MainAgentToolLoopCall;
  executionEnvelope: ExecutionEnvelope | undefined;
  aggregate: TaskAggregate | null;
  intentGrant: IntentGrant | undefined;
  pptAssetBatchExecution: PptAssetBatchExecutionPlan | null;
}): Promise<MainAgentReActDispatchResult | null> {
  const { context, definition, call, executionEnvelope, aggregate, intentGrant, pptAssetBatchExecution } = input;
  if (typeof definition.internalToolId !== "string") return null;
  const { input: loopInput, state, controlPlaneStore } = context;
  const actionRisk = pptAssetBatchExecution?.pendingUnitCount === 0 ? "internal" : actionRiskForTool(definition);
  const policy = evaluateActionPolicy({
    risk: actionRisk,
    intentGrant,
    externalProviderCallsUsed: Math.max(
      state.externalProviderCallsUsed,
      pptAssetBatchExecution?.authoritativeProviderCallsUsed ?? 0,
    ) + Math.max(0, (pptAssetBatchExecution?.pendingUnitCount ?? 1) - 1),
    expectedScope: {
      projectId: loopInput.project.id,
      intentEpoch: loopInput.project.intentEpoch ?? 0,
      intensity: loopInput.project.generationIntensity ?? "standard",
    },
  });
  if (policy.kind !== "human_gate") return null;
  if (!loopInput.taskBrief || !aggregate) {
    return {
      status: "blocked",
      observation: compactContinuationObservation("blocked", [policy.reason], { nextAction: "ask_teacher" }),
    };
  }
  const capabilityId = definition.capabilityId;
  if (!capabilityId) throw new Error("HumanGate business Tool requires a capabilityId.");
  const actionId = createHumanGateActionId({
    projectId: loopInput.project.id,
    capabilityId,
    messageId: loopInput.triggerMessage.id,
  });
  state.activeHumanGateDecision = createPendingDecisionForAction({
    action: actionRisk,
    decision: policy,
    actionId,
    actorUserId: loopInput.identity!.actorUserId,
    projectId: loopInput.project.id,
    taskId: loopInput.taskBrief.taskId,
    intentEpoch: loopInput.taskBrief.intentEpoch,
    planId: aggregate.plan.planId,
    intentGrant,
    disclosedBudget: disclosedBudgetFor(policy.reason, loopInput.taskBrief, intentGrant),
  });
  state.currentMetadata = {
    ...state.currentMetadata,
    pendingDecision: structuredClone(state.activeHumanGateDecision),
  };
  const policyObservationResult = executionEnvelope
    ? await persistPolicyObservation({ context, definition, call, executionEnvelope, reason: policy.reason })
    : undefined;
  if (policyObservationResult?.kind === "replay") return policyObservationResult.result;
  const policyObservation = policyObservationResult?.observation;
  await persistMessageMetadata(context);
  await controlPlaneStore.appendEvent({
    eventId: randomUUID(),
    projectId: loopInput.project.id,
    taskId: loopInput.taskBrief.taskId,
    runId: `turn:${loopInput.triggerMessage.id}`,
    intentEpoch: loopInput.taskBrief.intentEpoch,
    kind: "decision_pending",
    visibility: "teacher",
    occurredAt: new Date().toISOString(),
    payload: {
      decisionId: state.activeHumanGateDecision.decisionId,
      actionId,
      status: "waiting",
      reasonCode: policy.reason,
      question: state.activeHumanGateDecision.question,
    },
  });
  return {
    status: "blocked",
    observation: compactContinuationObservation("blocked", [policy.reason], {
      observationId: policyObservation?.observationId,
      nextAction: "ask_teacher",
    }),
  };
}

function disclosedBudgetFor(
  reason: string,
  taskBrief: NonNullable<MainAgentToolLoopContext["input"]["taskBrief"]>,
  intentGrant: IntentGrant | undefined,
) {
  if (reason === "budget_not_disclosed") {
    const budget = resolveStandardTaskBudget(taskBrief);
    return {
      budgetPolicyVersion: budget.policyVersion,
      maxCostCredits: null,
      maxExternalProviderCalls: budget.maxExternalProviderCalls,
    };
  }
  if (reason === "budget_upgrade") {
    const budget = resolveBudgetUpgrade({
      taskBrief,
      currentMaxExternalProviderCalls: intentGrant?.maxExternalProviderCalls,
    });
    return {
      budgetPolicyVersion: budget.policyVersion,
      maxCostCredits: null,
      maxExternalProviderCalls: budget.maxExternalProviderCalls,
    };
  }
  return undefined;
}

async function persistPolicyObservation(input: {
  context: MainAgentToolLoopContext;
  definition: MainAgentToolDefinition & { internalToolId: string };
  call: MainAgentToolLoopCall;
  executionEnvelope: ExecutionEnvelope;
  reason: string;
}): Promise<
  | { kind: "observation"; observation: AgentObservation }
  | { kind: "replay"; result: MainAgentReActDispatchResult }
> {
  const { context, definition, call, executionEnvelope, reason } = input;
  const { input: loopInput, state, controlPlaneStore } = context;
  let invocationId: string = randomUUID();
  const claim = await controlPlaneStore.startToolInvocation({
    invocationId,
    envelope: executionEnvelope,
    toolName: definition.internalToolId,
    request: structuredClone(call.arguments),
  });
  if (claim.kind !== "claimed") {
    return { kind: "replay", result: toolInvocationReplayResult(claim) };
  }
  invocationId = claim.invocation.invocationId;
  const observation = createAgentObservation({
    projectId: loopInput.project.id,
    source: reason === "budget_not_disclosed" || reason === "budget_upgrade" ? "budget" : "validation",
    status: "blocked",
    actionKey: definition.internalToolId,
    inputHash: executionEnvelope.idempotencyKey,
    reasonCodes: [reason],
    reportRefs: [],
    targetLocators: [],
    responsibleStage: "action_policy",
    minimalNextAction: "ask_teacher",
    teacherSafeSummary: "这一步需要先完成相应授权或预算决定，当前没有执行外部操作。",
  });
  await persistAgentToolObservation({
    controlPlaneStore,
    invocationId,
    executionEnvelope,
    triggerMessageId: loopInput.triggerMessage.id,
    observation,
  });
  state.currentPlanRevision += 1;
  state.currentMetadata = appendAgentObservationMetadata(state.currentMetadata, observation);
  return { kind: "observation", observation };
}

async function persistMessageMetadata(context: MainAgentToolLoopContext) {
  await context.input.service.updateMessageMetadata(
    context.input.project.id,
    context.input.triggerMessage.id,
    context.state.currentMetadata,
  );
}
