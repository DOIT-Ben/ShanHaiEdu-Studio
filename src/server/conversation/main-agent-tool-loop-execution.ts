import { randomUUID } from "node:crypto";

import type { BusinessToolSkillContext } from "@/server/skills/business-tool-skill-runtime";
import { skillRuntimeFailureReason } from "@/server/skills/business-tool-skill-runtime";
import type { MainAgentToolDefinition } from "@/server/tools/main-agent-tool-registry";

import { persistBusinessSkillRuntimeFailure } from "./business-skill-tool-failure";
import type { MainAgentReActDispatchResult } from "./main-agent-controlled-react-loop";
import type { MainAgentToolLoopCall, MainAgentToolLoopContext } from "./main-agent-tool-loop-types";
import {
  observationForContinuation,
  toolInvocationReplayResult,
} from "./main-agent-tool-loop-observations";
import type { PptAssetBatchExecutionPlan } from "./main-agent-tool-loop-ppt-assets";
import {
  claimMainAgentToolInvocation,
  prepareNativeProviderGenerationForInvocation,
} from "./native-provider-generation";
import { appendAgentObservationMetadata, createAgentObservation } from "./react-control";
import type { ExecutionEnvelope } from "./task-contract";

type InvocationReady = Extract<Awaited<ReturnType<typeof claimMainAgentToolInvocation>>, { kind: "ready" }>;
type ProviderReady = Extract<
  Awaited<ReturnType<typeof prepareNativeProviderGenerationForInvocation>>,
  { kind: "ready" }
>;

export type PreparedMainAgentToolExecution = {
  kind: "ready";
  invocationId: string;
  invocationClaim: InvocationReady["claim"] | undefined;
  businessSkillContext: BusinessToolSkillContext | undefined;
  providerGeneration: ProviderReady["generation"];
};

export async function prepareMainAgentToolExecution(input: {
  context: MainAgentToolLoopContext;
  definition: MainAgentToolDefinition;
  call: MainAgentToolLoopCall;
  executionEnvelope: ExecutionEnvelope | undefined;
  pptAssetBatchExecution: PptAssetBatchExecutionPlan | null;
}): Promise<PreparedMainAgentToolExecution | { kind: "handled"; result: MainAgentReActDispatchResult }> {
  const { context, definition, call, executionEnvelope, pptAssetBatchExecution } = input;
  const { input: loopInput, state, controlPlaneStore } = context;
  const invocationStart = executionEnvelope
    ? await claimMainAgentToolInvocation({
        service: loopInput.service,
        controlPlaneStore,
        invocationId: randomUUID(),
        executionEnvelope,
        definition,
        artifacts: context.taskArtifacts(),
        arguments: call.arguments,
        pptAssetBatchLifecycle: pptAssetBatchExecution?.lifecycle,
      })
    : null;
  if (invocationStart?.kind === "replay") {
    return { kind: "handled", result: toolInvocationReplayResult(invocationStart.claim) };
  }
  const invocationId = invocationStart?.invocationId ?? randomUUID();
  const invocationClaim = invocationStart?.claim;
  const skillPreparation = await prepareBusinessSkillContext({
    context,
    definition,
    invocationId,
    invocationClaim,
    executionEnvelope,
  });
  if (skillPreparation.kind === "handled") return skillPreparation;
  const providerPreparation = executionEnvelope
    ? invocationClaim?.kind === "in_progress"
      ? { kind: "ready" as const, generation: invocationStart?.resumedProviderGeneration ?? null }
      : await prepareNativeProviderGenerationForInvocation({
          service: loopInput.service,
          controlPlaneStore,
          invocationId,
          executionEnvelope,
          triggerMessageId: loopInput.triggerMessage.id,
          messageMetadata: state.currentMetadata,
          projectId: loopInput.project.id,
          definition,
          artifacts: context.taskArtifacts(),
          arguments: call.arguments,
          idempotencyKey: executionEnvelope.idempotencyKey,
          taskBriefDigest: executionEnvelope.taskBriefDigest,
          intentEpoch: executionEnvelope.intentEpoch,
          pptAssetBatchLifecycle: pptAssetBatchExecution?.lifecycle,
        })
    : { kind: "ready" as const, generation: null };
  if (providerPreparation.kind === "failed") {
    state.currentPlanRevision += 1;
    state.currentMetadata = providerPreparation.messageMetadata;
    return { kind: "handled", result: providerPreparation.dispatchResult };
  }
  const providerGeneration = providerPreparation.generation;
  if (invocationClaim) state.currentPlanRevision += 1;
  if (providerGeneration?.active.job.status === "submission_unknown") {
    return {
      kind: "handled",
      result: await persistSubmissionUnknown(context, definition, executionEnvelope!, invocationId),
    };
  }
  return {
    kind: "ready",
    invocationId,
    invocationClaim,
    businessSkillContext: skillPreparation.businessSkillContext,
    providerGeneration,
  };
}

async function prepareBusinessSkillContext(input: {
  context: MainAgentToolLoopContext;
  definition: MainAgentToolDefinition;
  invocationId: string;
  invocationClaim: InvocationReady["claim"] | undefined;
  executionEnvelope: ExecutionEnvelope | undefined;
}): Promise<
  | { kind: "ready"; businessSkillContext: BusinessToolSkillContext | undefined }
  | { kind: "handled"; result: MainAgentReActDispatchResult }
> {
  const { context, definition, invocationId, invocationClaim, executionEnvelope } = input;
  const { input: loopInput } = context;
  const skillBoundBusinessTool = typeof definition.internalToolId === "string" &&
    Boolean(definition.businessSkillName);
  const formalSkillBoundBusinessTool = skillBoundBusinessTool && definition.businessSkillBindingMode === "skill";
  const missingSkillRuntimeMustBlock = formalSkillBoundBusinessTool || loopInput.businessSkillRuntimeMode === "required";
  if (skillBoundBusinessTool && !loopInput.businessSkillRuntime && missingSkillRuntimeMustBlock) {
    return handleSkillRuntimeFailure({
      context,
      definition,
      invocationId,
      invocationClaim,
      executionEnvelope,
      reasonCode: "skill_runtime_config_missing",
    });
  }
  if (!skillBoundBusinessTool || !loopInput.businessSkillRuntime) {
    return { kind: "ready", businessSkillContext: undefined };
  }
  try {
    const businessSkillContext = await loopInput.businessSkillRuntime.loadForSelectedTool({
      selectedBy: "main_agent",
      businessToolName: definition.id,
    });
    return { kind: "ready", businessSkillContext };
  } catch (error) {
    return handleSkillRuntimeFailure({
      context,
      definition,
      invocationId,
      invocationClaim,
      executionEnvelope,
      reasonCode: skillRuntimeFailureReason(error) ?? "business_skill_load_failed",
    });
  }
}

async function handleSkillRuntimeFailure(input: {
  context: MainAgentToolLoopContext;
  definition: MainAgentToolDefinition;
  invocationId: string;
  invocationClaim: InvocationReady["claim"] | undefined;
  executionEnvelope: ExecutionEnvelope | undefined;
  reasonCode: string;
}): Promise<{ kind: "handled"; result: MainAgentReActDispatchResult }> {
  const { context, definition, invocationId, invocationClaim, executionEnvelope, reasonCode } = input;
  const { input: loopInput, state, controlPlaneStore } = context;
  if (invocationClaim?.kind === "in_progress") {
    return { kind: "handled", result: toolInvocationReplayResult(invocationClaim) };
  }
  const required = loopInput.businessSkillRuntimeMode === "required";
  const nextAction = required ? "pause" : "replan";
  if (executionEnvelope && invocationClaim?.kind === "claimed" && typeof definition.internalToolId === "string") {
    const failure = await persistBusinessSkillRuntimeFailure({
      controlPlaneStore,
      invocationId,
      executionEnvelope,
      triggerMessageId: loopInput.triggerMessage.id,
      toolName: definition.internalToolId,
      reasonCode,
      nextAction: required ? "pause" : "repair_upstream",
    });
    state.currentMetadata = appendAgentObservationMetadata(state.currentMetadata, failure.observation);
    await persistMessageMetadata(context);
    return {
      kind: "handled",
      result: {
        status: "blocked",
        observation: observationForContinuation(failure.observation, {
          nextAction,
          reportRefs: [{
            id: failure.validationReport.reportId,
            kind: "validation",
            digest: failure.validationReport.reportDigest,
          }],
        }),
      },
    };
  }
  return {
    kind: "handled",
    result: {
      status: "blocked",
      observation: { status: "blocked", reasonCodes: [reasonCode], nextAction },
    },
  };
}

async function persistSubmissionUnknown(
  context: MainAgentToolLoopContext,
  definition: MainAgentToolDefinition,
  executionEnvelope: ExecutionEnvelope,
  invocationId: string,
): Promise<MainAgentReActDispatchResult> {
  const { input, state, controlPlaneStore } = context;
  const observation = createAgentObservation({
    projectId: input.project.id,
    source: "tool",
    status: "inconclusive",
    actionKey: definition.internalToolId ?? definition.id,
    inputHash: executionEnvelope.idempotencyKey,
    reasonCodes: ["submission_unknown"],
    reportRefs: [],
    targetLocators: [],
    responsibleStage: definition.internalToolId ?? definition.id,
    minimalNextAction: "pause",
    teacherSafeSummary: "生成任务的提交状态需要核对，系统没有自动重复提交。",
  });
  await controlPlaneStore.commitToolFailure({
    invocationId,
    observation: {
      observationId: observation.observationId,
      status: observation.status,
      reasonCodes: observation.reasonCodes,
      payload: structuredClone(observation) as unknown as Record<string, unknown>,
    },
    event: {
      eventId: randomUUID(),
      projectId: executionEnvelope.projectId,
      taskId: executionEnvelope.taskId,
      runId: `turn:${input.triggerMessage.id}`,
      intentEpoch: executionEnvelope.intentEpoch,
      kind: "tool_observed",
      visibility: "internal",
      occurredAt: new Date().toISOString(),
      payload: { observationId: observation.observationId, status: observation.status },
    },
  });
  state.currentMetadata = appendAgentObservationMetadata(state.currentMetadata, observation);
  await persistMessageMetadata(context);
  return {
    status: "inconclusive",
    observation: observationForContinuation(observation, { nextAction: "pause" }),
  };
}

async function persistMessageMetadata(context: MainAgentToolLoopContext) {
  await context.input.service.updateMessageMetadata(
    context.input.project.id,
    context.input.triggerMessage.id,
    context.state.currentMetadata,
  );
}
