import { randomUUID } from "node:crypto";

import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import {
  dispatchMainAgentToolCall,
  type MainAgentToolDispatchResult,
} from "@/server/tools/main-agent-tool-dispatcher";
import {
  isMainAgentControlToolDefinition,
  type MainAgentToolDefinition,
} from "@/server/tools/main-agent-tool-registry";
import { routeToolCall } from "@/server/tools/tool-router";

import { appendAgentHarnessBudgetEventMetadata } from "./agent-harness-budget";
import type { MainAgentReActDispatchResult } from "./main-agent-controlled-react-loop";
import { handleAgentToolResult } from "./main-agent-tool-loop-agent-result";
import { handleBusinessToolResult } from "./main-agent-tool-loop-business-result";
import { dispatchDialogueCheckpoint } from "./main-agent-tool-loop-dialogue";
import {
  prepareMainAgentToolExecution,
  type PreparedMainAgentToolExecution,
} from "./main-agent-tool-loop-execution";
import { handleHumanGate } from "./main-agent-tool-loop-human-gate";
import { appendMainAgentToolExposureTrace } from "./main-agent-tool-loop-metadata";
import {
  compactContinuationObservation,
} from "./main-agent-tool-loop-observations";
import {
  preparePptAssetBatchExecution,
  type PptAssetBatchExecutionPlan,
} from "./main-agent-tool-loop-ppt-assets";
import type {
  MainAgentToolLoopCall,
  MainAgentToolLoopContext,
  MainAgentToolLoopDispatch,
} from "./main-agent-tool-loop-types";
import {
  resolveBusinessToolInstruction,
  resolveReviewTarget,
  toApprovedRuntimeArtifact,
  toArtifactRef,
  toRuntimeProjectContext,
} from "./main-agent-tool-input-projection";
import { appendAgentObservationMetadata, createAgentObservation } from "./react-control";
import {
  createExecutionEnvelope,
  type ExecutionEnvelope,
  type IntentGrant,
  type TaskBrief,
} from "./task-contract";

type TaskAggregate = NonNullable<Awaited<ReturnType<MainAgentToolLoopContext["controlPlaneStore"]["getTaskAggregate"]>>>;

type PreparedDispatchAuthority = {
  definition: MainAgentToolDefinition;
  aggregate: TaskAggregate | null;
  intentGrant: IntentGrant | undefined;
  executionEnvelope: ExecutionEnvelope | undefined;
  pptAssetBatchExecution: PptAssetBatchExecutionPlan | null;
};

export function createMainAgentToolDispatch(context: MainAgentToolLoopContext): MainAgentToolLoopDispatch {
  return async (call) => {
    const authority = await prepareDispatchAuthority(context, call);
    if (authority.kind === "handled") return authority.result;
    return executePreparedToolCall(context, call, authority.prepared);
  };
}

async function prepareDispatchAuthority(
  context: MainAgentToolLoopContext,
  call: MainAgentToolLoopCall,
): Promise<
  | { kind: "handled"; result: MainAgentReActDispatchResult }
  | { kind: "ready"; prepared: PreparedDispatchAuthority }
> {
  const { input, state, controlPlaneStore } = context;
  const definition = state.definitions.find((candidate) => candidate.transportName === call.toolName);
  if (!definition) {
    return {
      kind: "handled",
      result: {
        status: "blocked",
        observation: compactContinuationObservation("blocked", ["tool_not_available"], { nextAction: "replan" }),
      },
    };
  }
  state.currentMetadata = appendMainAgentToolExposureTrace(state.currentMetadata, {
    sequence: ++state.toolExposureSequence,
    event: "tool_selected",
    intentEpoch: input.project.intentEpoch ?? 0,
    allowedToolNames: state.definitions.map((tool) => tool.transportName),
    selectedToolName: call.toolName,
  });
  await persistMessageMetadata(context);
  const currentProject = await input.service.getProject(input.project.id);
  if ((currentProject.intentEpoch ?? 0) !== (input.project.intentEpoch ?? 0)) {
    return {
      kind: "handled",
      result: {
        status: "inconclusive",
        observation: compactContinuationObservation("inconclusive", ["intent_changed"], { nextAction: "replan" }),
      },
    };
  }
  await input.service.renewProjectExecutionLease({ ...input.fence!, leaseMs: 10 * 60 * 1000 });
  const aggregate = input.taskBrief
    ? await controlPlaneStore.getTaskAggregate(input.taskBrief.projectId, input.taskBrief.intentEpoch)
    : null;
  if (input.taskBrief && (!aggregate || aggregate.taskBrief.digest !== input.taskBrief.digest)) {
    return {
      kind: "handled",
      result: {
        status: "inconclusive",
        observation: compactContinuationObservation(
          "inconclusive",
          ["task_aggregate_stale"],
          { nextAction: "replan" },
        ),
      },
    };
  }
  const intentGrant = aggregate?.intentGrant ?? input.intentGrant;
  const executionEnvelope = input.taskBrief
    ? createExecutionEnvelope({
        actorUserId: input.identity!.actorUserId,
        taskBrief: input.taskBrief,
        planRevision: state.currentPlanRevision,
        intensity: input.project.generationIntensity ?? "standard",
        intentGrant: intentGrant ?? createUnauthorizedIntentGrant(
          input.taskBrief,
          input.project.generationIntensity ?? "standard",
        ),
        action: { toolName: definition.internalToolId ?? definition.id, arguments: call.arguments },
      })
    : undefined;
  const pptAssetBatchExecution = executionEnvelope && input.taskBrief
    ? await preparePptAssetBatchExecution({
        service: input.service,
        projectId: input.project.id,
        definition,
        artifacts: context.taskArtifacts(),
        taskBrief: input.taskBrief,
      })
    : null;
  return {
    kind: "ready",
    prepared: { definition, aggregate, intentGrant, executionEnvelope, pptAssetBatchExecution },
  };
}

async function executePreparedToolCall(
  context: MainAgentToolLoopContext,
  call: MainAgentToolLoopCall,
  prepared: PreparedDispatchAuthority,
): Promise<MainAgentReActDispatchResult> {
  const { definition, aggregate, intentGrant, executionEnvelope, pptAssetBatchExecution } = prepared;
  if (isMainAgentControlToolDefinition(definition)) {
    return dispatchDialogueCheckpoint({ context, definition, call, executionEnvelope });
  }
  const humanGate = await handleHumanGate({
    context,
    definition,
    call,
    executionEnvelope,
    aggregate,
    intentGrant,
    pptAssetBatchExecution,
  });
  if (humanGate) return humanGate;
  const execution = await prepareMainAgentToolExecution({
    context,
    definition,
    call,
    executionEnvelope,
    pptAssetBatchExecution,
  });
  if (execution.kind === "handled") return execution.result;
  const dispatch = await executeSelectedTool(context, call, definition, executionEnvelope, execution);
  const providerBudgetEvent = dispatch.kind === "business_tool" && dispatch.result.budgetEvent.providerSubmitted
    ? dispatch.result.budgetEvent
    : undefined;
  await persistProviderBudgetEvent(context, providerBudgetEvent);
  updatePptDirectorPlan(context, dispatch);
  if (dispatch.kind === "blocked") {
    return handleBlockedDispatch(context, definition, executionEnvelope, execution, dispatch);
  }
  if (dispatch.kind === "business_tool") {
    return handleBusinessToolResult({
      context,
      definition,
      call,
      executionEnvelope,
      invocationId: execution.invocationId,
      providerGeneration: execution.providerGeneration,
      providerBudgetEvent,
      businessSkillContext: execution.businessSkillContext,
      dispatch,
    });
  }
  return handleAgentToolResult({
    context,
    executionEnvelope,
    invocationId: execution.invocationId,
    dispatch,
  });
}

async function executeSelectedTool(
  context: MainAgentToolLoopContext,
  call: MainAgentToolLoopCall,
  definition: MainAgentToolDefinition,
  executionEnvelope: ExecutionEnvelope | undefined,
  execution: PreparedMainAgentToolExecution,
) {
  const { input, state } = context;
  const reviewTargetRef = resolveReviewTarget(call.arguments, context.taskArtifacts());
  return dispatchMainAgentToolCall({
    invocationId: execution.invocationId,
    toolName: call.toolName,
    arguments: call.arguments,
    serverContext: {
      identity: input.identity!,
      projectId: input.project.id,
      intentEpoch: input.project.intentEpoch ?? 0,
      sourceMessageId: input.triggerMessage.id,
      generationIntensity: input.project.generationIntensity,
      approvedArtifactRefs: context.taskArtifacts().filter(isArtifactTrustedForDownstream).map(toArtifactRef),
      reviewTargetRef,
      executionEnvelope,
      executionScope: input.taskBrief ? {
        actorUserId: input.identity!.actorUserId,
        projectId: input.project.id,
        taskId: input.taskBrief.taskId,
        intentEpoch: input.project.intentEpoch ?? 0,
        planRevision: executionEnvelope?.planRevision ?? state.currentPlanRevision,
        intensity: input.project.generationIntensity ?? "standard",
        taskBriefDigest: input.taskBrief.digest,
      } : undefined,
    },
  }, {
    agentToolExecutor: input.executor,
    businessToolRouter: input.businessToolRouter ?? routeToolCall,
    allowBusinessExecution: true,
    buildBusinessToolInput: (request, internalToolId) => ({
      toolName: internalToolId,
      projectId: input.project.id,
      project: input.project,
      runtime: input.runtime,
      projectContext: toRuntimeProjectContext(input.project, input.taskBrief),
      approvedArtifacts: context.taskArtifacts()
        .filter(isArtifactTrustedForDownstream)
        .filter((artifact) => definition.requiredArtifactKinds.includes(artifact.kind))
        .map(toApprovedRuntimeArtifact),
      userInstruction: resolveBusinessToolInstruction(request.arguments, input.triggerMessage.content),
      toolInput: {
        ...structuredClone(request.arguments),
        taskBrief: structuredClone(input.taskBrief ?? null),
        intentGrant: structuredClone(input.intentGrant ?? null),
        generationIntensity: input.project.generationIntensity ?? "standard",
        intentEpoch: input.project.intentEpoch ?? 0,
      },
      artifactRefs: context.taskArtifacts().map((artifact) => ({
        kind: artifact.kind,
        artifactId: artifact.id,
        title: artifact.title,
        summary: artifact.summary,
      })),
      resolvedArtifacts: context.taskArtifacts(),
      sourceMessageId: input.triggerMessage.id,
      executionIntentEpoch: input.project.intentEpoch ?? 0,
      executionEnvelope,
      executionInputHash: execution.providerGeneration?.active.job.inputHash ?? executionEnvelope?.idempotencyKey ??
        hashRunInput({
          projectId: input.project.id,
          toolName: internalToolId,
          arguments: request.arguments,
          intentEpoch: input.project.intentEpoch ?? 0,
        }),
      pptDirectorPlan: internalToolId === "create_ppt_design_draft" ? state.latestPptDirectorPlan : undefined,
      businessSkillContext: execution.businessSkillContext,
      ...(execution.providerGeneration ? { generationTaskLifecycle: execution.providerGeneration.lifecycle } : {}),
      ...(execution.providerGeneration?.pptAssetBatchLifecycle
        ? { pptAssetBatchLifecycle: execution.providerGeneration.pptAssetBatchLifecycle }
        : {}),
    }),
  });
}

async function persistProviderBudgetEvent(
  context: MainAgentToolLoopContext,
  event: Extract<MainAgentToolDispatchResult, { kind: "business_tool" }>["result"]["budgetEvent"] | undefined,
) {
  if (!event) return;
  context.state.externalProviderCallsUsed += event.providerSubmissionCount ?? 1;
  context.state.currentMetadata = appendAgentHarnessBudgetEventMetadata(context.state.currentMetadata, event);
  await persistMessageMetadata(context);
}

function updatePptDirectorPlan(context: MainAgentToolLoopContext, dispatch: MainAgentToolDispatchResult) {
  if (dispatch.kind !== "agent_tool" || dispatch.envelope.toolId !== "ppt_director.plan_or_repair" ||
      dispatch.result.status !== "succeeded") return;
  context.state.latestPptDirectorPlan = {
    invocationId: dispatch.envelope.invocationId,
    projectId: dispatch.envelope.projectId,
    intentEpoch: dispatch.envelope.intentEpoch,
    structuredOutput: structuredClone(dispatch.result.structuredOutput),
    approvedArtifactRefs: dispatch.envelope.approvedArtifactRefs.map((ref) => ({
      artifactId: ref.artifactId,
      kind: ref.kind,
      version: ref.version,
      digest: ref.digest,
    })),
  };
}

async function handleBlockedDispatch(
  context: MainAgentToolLoopContext,
  definition: MainAgentToolDefinition,
  executionEnvelope: ExecutionEnvelope | undefined,
  execution: PreparedMainAgentToolExecution,
  dispatch: Extract<MainAgentToolDispatchResult, { kind: "blocked" }>,
): Promise<MainAgentReActDispatchResult> {
  const { input, state, controlPlaneStore } = context;
  if (executionEnvelope) {
    const observation = createAgentObservation({
      observationId: dispatch.result.observation.observationId,
      projectId: input.project.id,
      source: "tool",
      status: "blocked",
      actionKey: definition.internalToolId ?? definition.id,
      inputHash: executionEnvelope.idempotencyKey,
      reasonCodes: [dispatch.result.observation.kind, dispatch.result.observation.internalReasonSanitized],
      reportRefs: [],
      targetLocators: [],
      responsibleStage: definition.internalToolId ?? definition.id,
      minimalNextAction: "repair_upstream",
      teacherSafeSummary: dispatch.result.observation.teacherSafeSummary,
    });
    await controlPlaneStore.commitToolObservation({
      invocationId: execution.invocationId,
      ...(execution.providerGeneration ? {
        generationJob: {
          jobId: execution.providerGeneration.active.job.id,
          status: "failed" as const,
          errorMessage: dispatch.result.observation.teacherSafeSummary,
        },
      } : {}),
      observation: {
        observationId: observation.observationId,
        status: observation.status,
        reasonCodes: observation.reasonCodes,
        payload: structuredClone(observation) as unknown as Record<string, unknown>,
      },
      event: {
        eventId: randomUUID(),
        projectId: input.project.id,
        taskId: executionEnvelope.taskId,
        runId: `turn:${input.triggerMessage.id}`,
        intentEpoch: input.project.intentEpoch ?? 0,
        kind: "tool_observed",
        visibility: "internal",
        occurredAt: new Date().toISOString(),
        payload: { observationId: observation.observationId, status: "blocked" },
      },
    });
    state.currentMetadata = appendAgentObservationMetadata(state.currentMetadata, observation);
    await persistMessageMetadata(context);
  }
  return {
    status: "blocked",
    observation: compactContinuationObservation("blocked", [dispatch.result.observation.kind], {
      observationId: dispatch.result.observation.observationId,
      summary: dispatch.result.observation.teacherSafeSummary,
      nextAction: "replan",
    }),
  };
}

function createUnauthorizedIntentGrant(taskBrief: TaskBrief, intensity: IntentGrant["intensity"]): IntentGrant {
  return {
    schemaVersion: "intent-grant.v1",
    taskId: taskBrief.taskId,
    projectId: taskBrief.projectId,
    intentEpoch: taskBrief.intentEpoch,
    standardWorkAuthorized: false,
    intensity,
    budgetPolicyVersion: null,
    maxCostCredits: null,
    maxExternalProviderCalls: null,
    requiredCheckpoints: [],
    expiresAt: null,
  };
}

async function persistMessageMetadata(context: MainAgentToolLoopContext) {
  await context.input.service.updateMessageMetadata(
    context.input.project.id,
    context.input.triggerMessage.id,
    context.state.currentMetadata,
  );
}
