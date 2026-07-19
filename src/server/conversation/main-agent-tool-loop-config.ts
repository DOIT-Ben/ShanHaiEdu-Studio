import { randomUUID } from "node:crypto";

import type { Artifact } from "@/generated/prisma/client";
import type { AgentRuntime } from "@/server/agent-runtime/types";
import {
  appendAgentObservationMetadata,
  appendRunCheckpointMetadata,
  createAgentObservation,
  createRunCheckpoint,
  readAgentObservationsFromMetadata,
  type AgentObservation,
} from "@/server/conversation/react-control";
import { actionRiskForTool, createPendingDecisionForAction, evaluateActionPolicy } from "@/server/guards/action-policy";
import { createHumanGateActionId } from "@/server/guards/human-gate";
import { resolveBudgetUpgrade, resolveStandardTaskBudget } from "@/server/guards/task-budget-policy";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { createValidationReport, hasValidValidationReportDigest, hashArtifactDraft } from "@/server/contracts/contract-validator";
import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { isArtifactBoundToTask } from "@/server/quality/artifact-truth-boundary";
import { adaptPptAgentCriticReview } from "@/server/ppt-quality/ppt-agent-critic-review-adapter";
import { buildPptFullDeckReviewArtifact, buildPptSampleReviewArtifact } from "@/server/ppt-quality/ppt-review-artifact";
import { buildPptAssetRequestBatch } from "@/server/ppt-quality/ppt-asset-request-builder";
import type { PptAssetBatchLifecycle } from "@/server/ppt-quality/ppt-asset-batch-run";
import type { PptDesignPackage } from "@/server/ppt-quality/ppt-quality-types";
import type { PptAssetRequest, PptGeneratedAsset } from "@/server/ppt-quality/ppt-asset-types";
import { adaptVideoAgentCriticReview } from "@/server/video-quality/video-agent-critic-review-adapter";
import { appendAgentToolReportMetadata, createPersistedAgentToolReport } from "@/server/tools/agent-tool-report";
import type { AgentToolArtifactRef, AgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import { isMainAgentControlToolDefinition, listMainAgentToolDefinitions, type MainAgentToolDefinition } from "@/server/tools/main-agent-tool-registry";
import { routeToolCall } from "@/server/tools/tool-router";
import type { AgentToolRouterResult } from "@/server/tools/agent-tool-router";
import type { AgentToolPolicyOutcome } from "@/server/tools/agent-tool-types";
import type { AgentToolExecutor } from "@/server/tools/agent-tool-types";
import type { PptDirectorPlanBinding } from "@/server/ppt-quality/ppt-director-design-adapter";
import { dispatchMainAgentToolCall } from "@/server/tools/main-agent-tool-dispatcher";
import { toolDefinitionToOpenAiFunctionTool } from "@/server/tools/openai-tool-schema";
import type { ToolRouterInput } from "@/server/tools/tool-router";
import type { ToolExecutionResult } from "@/server/tools/tool-types";
import type { ToolDefinition } from "@/server/tools/tool-types";
import type { ValidationReport } from "@/server/quality/quality-types";
import type { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactRecord, ConversationMessageRecord, ExecutionIdentitySnapshot, GenerationJobRecord, ProjectExecutionFence, ProjectRecord, SaveArtifactInput } from "@/server/workbench/types";
import type { MainConversationAgentInput } from "./main-conversation-agent";
import { appendAgentHarnessBudgetEventMetadata } from "./agent-harness-budget";
import type { MainAgentReActContextTelemetry, MainAgentReActDispatchResult } from "./main-agent-controlled-react-loop";
import { createMainAgentRoundBudgetPause } from "./main-agent-run-pause";
import { createExecutionEnvelope, type IntentGrant, type PendingDecision, type TaskBrief, type TaskRequestedOutput } from "./task-contract";
import { isCapabilityInTaskScope } from "./task-output-scope";
import { createControlPlaneStore, type ToolInvocationClaim } from "./control-plane-store";
import { buildSemanticContextSnapshot } from "./context-semantic-snapshot";
import { restoreMainAgentReActCheckpoint, type MainAgentReActCheckpoint } from "./main-agent-react-checkpoint";
import { resolveProjectSemanticScope } from "./project-semantic-scope";
import { evaluateTaskCompletionContract } from "./task-completion-contract";
import {
  skillRuntimeFailureReason,
  type BusinessToolSkillContext,
  type BusinessToolSkillResultValidation,
  type BusinessToolSkillRuntime,
} from "@/server/skills/business-tool-skill-runtime";
import { BusinessToolSkillOutputContractError } from "@/server/skills/business-tool-skill-output-contract";
import {
  createDialogueCheckpoint,
  isDialogueCheckpoint,
  type DialogueCheckpoint,
  type DialogueCheckpointOption,
} from "./dialogue-checkpoint";

type WorkbenchService = ReturnType<typeof createWorkbenchService>;

const nonRepeatableFrontStageToolIds = new Set([
  "create_lesson_plan",
  "create_ppt_outline",
  "create_video_course_anchor",
  "generate_intro_creative_themes",
  "generate_intro_video_script",
  "generate_video_storyboard",
  "generate_video_asset_brief",
  "plan_video_segments",
  "create_ppt_design_draft",
  "generate_video_narration",
]);

export type CreateMainAgentToolLoopOptionsInput = {
  service: WorkbenchService;
  project: ProjectRecord;
  triggerMessage: ConversationMessageRecord;
  artifacts: ArtifactRecord[];
  identity?: ExecutionIdentitySnapshot;
  fence?: ProjectExecutionFence;
  executor?: AgentToolExecutor<AgentToolInvocationEnvelope>;
  intentGrant?: IntentGrant;
  taskBrief?: TaskBrief;
  planRevision?: number;
  externalProviderCallsUsed?: number;
  businessToolRouter?: (input: ToolRouterInput) => Promise<ToolExecutionResult>;
  runtime?: AgentRuntime;
  controlPlaneStore?: ReturnType<typeof createControlPlaneStore>;
  businessSkillRuntime?: BusinessToolSkillRuntime;
  businessSkillRuntimeMode?: "optional" | "required";
  resumeCheckpoint?: MainAgentReActCheckpoint | Record<string, unknown> | null;
};

export function createMainAgentToolLoopOptions(
  input: CreateMainAgentToolLoopOptionsInput,
): MainConversationAgentInput["agentToolLoop"] | undefined {
  const controlPlaneStore = input.controlPlaneStore ?? createControlPlaneStore();
  if (!input.identity || !input.fence) return undefined;
  const taskArtifacts = () => input.taskBrief
    ? input.artifacts.filter((artifact) => isArtifactBoundToTask(artifact, input.taskBrief!))
    : input.artifacts;
  const qualifiedDefinitions = () => {
    const currentArtifacts = taskArtifacts();
    const approvedArtifactKinds = new Set(currentArtifacts.filter(isArtifactTrustedForDownstream).map((artifact) => artifact.kind));
    const presentArtifactKinds = new Set(currentArtifacts.map((artifact) => artifact.kind));
    return listMainAgentToolDefinitions().filter((tool) =>
      (tool.adapterKind !== "agent" || Boolean(input.executor)) &&
      tool.mainAgentExecutable && isCurrentlyQualifiedMainAgentTool(tool, approvedArtifactKinds, presentArtifactKinds, input.taskBrief) && (
        tool.internalToolId !== "create_ppt_design_draft" || Boolean(input.runtime)
      ),
    );
  };
  let definitions = qualifiedDefinitions();
  if (!input.taskBrief && definitions.length === 0) return undefined;
  let currentMetadata = structuredClone(input.triggerMessage.metadata);
  let externalProviderCallsUsed = input.externalProviderCallsUsed ?? 0;
  let currentPlanRevision = input.planRevision ?? 0;
  let latestPptDirectorPlan: PptDirectorPlanBinding | undefined;
  let activeDialogueCheckpoint: DialogueCheckpoint | undefined;
  let activeHumanGateDecision: PendingDecision | undefined;
  let toolExposureSequence = readMainAgentToolExposureTrace(currentMetadata).length;
  const taskBudget = input.taskBrief ? resolveStandardTaskBudget(input.taskBrief) : undefined;
  const resumeCheckpoint = input.resumeCheckpoint
    ? restoreMainAgentReActCheckpoint(input.resumeCheckpoint as MainAgentReActCheckpoint)
    : undefined;

  const persistCheckpoint = input.taskBrief ? async (event: {
    checkpoint: MainAgentReActCheckpoint;
    toolRoundsUsed: number;
    observationIds: string[];
    segmentIndex?: number;
    pendingToolName?: string;
    reason?: string;
  }, status: "active" | "paused_recovery") => {
    const aggregate = await controlPlaneStore.getTaskAggregate(input.taskBrief!.projectId, input.taskBrief!.intentEpoch);
    if (!aggregate || aggregate.taskBrief.digest !== input.taskBrief!.digest) {
      throw new Error("ReAct checkpoint requires the current TaskAggregate.");
    }
    if (aggregate.plan.revision !== currentPlanRevision || aggregate.status !== "active") {
      throw new Error("ReAct checkpoint cannot commit a stale task plan.");
    }
    const persistedPlan = { ...aggregate.plan, status };
    const previousSnapshot = await controlPlaneStore.getLatestSemanticSnapshot({
      projectId: input.taskBrief!.projectId,
      taskId: input.taskBrief!.taskId,
      intentEpoch: input.taskBrief!.intentEpoch,
      maxPlanRevision: aggregate.plan.revision,
    });
    const observations = readAgentObservationsFromMetadata(currentMetadata);
    const semanticSnapshot = buildSemanticContextSnapshot({
      taskBrief: input.taskBrief!,
      plan: persistedPlan,
      pendingDecision: activeDialogueCheckpoint ?? activeHumanGateDecision ?? previousSnapshot?.snapshot.pendingDecision ?? null,
      trustedArtifactRefs: input.artifacts
        .filter((artifact) => isArtifactTrustedForDownstream(artifact) && isArtifactBoundToTask(artifact, input.taskBrief!))
        .map((artifact) => ({
          artifactId: artifact.id,
          kind: artifact.kind,
          version: artifact.version,
          digest: hashArtifactDraft({
            nodeKey: artifact.nodeKey,
            kind: artifact.kind,
            title: artifact.title,
            summary: artifact.summary,
            markdownContent: artifact.markdownContent,
            structuredContent: artifact.structuredContent,
          }),
          taskId: input.taskBrief!.taskId,
          taskBriefDigest: input.taskBrief!.digest,
          intentEpoch: input.taskBrief!.intentEpoch,
          bindingSource: artifact.taskBriefDigest
            ? "tool_execution" as const
            : artifact.origin === "teacher_input" ? "current_intent_teacher_input" as const : "current_intent_compatibility" as const,
        })),
      observationRefs: observations.map((observation) => ({
        observationId: observation.observationId,
        reasonCodes: observation.reasonCodes,
        intentEpoch: input.taskBrief!.intentEpoch,
      })),
      recentMessages: [
        ...(previousSnapshot?.snapshot.recentMessages ?? []),
        { role: input.triggerMessage.role, content: input.triggerMessage.content },
      ],
    });
    await controlPlaneStore.commitRunCheckpoint({
      taskBrief: input.taskBrief!,
      intentGrant: aggregate.intentGrant,
      plan: persistedPlan,
      checkpoint: structuredClone(event.checkpoint) as unknown as Record<string, unknown>,
      semanticSnapshot,
      event: {
        eventId: randomUUID(),
        projectId: input.taskBrief!.projectId,
        taskId: input.taskBrief!.taskId,
        runId: `turn:${input.triggerMessage.id}`,
        intentEpoch: input.taskBrief!.intentEpoch,
        kind: "task_updated",
        visibility: "internal",
        occurredAt: new Date().toISOString(),
        payload: {
          checkpointDigest: event.checkpoint.checkpointDigest,
          toolRoundsUsed: event.toolRoundsUsed,
          observationIds: [...event.observationIds],
          status,
          ...(event.segmentIndex === undefined ? {} : { segmentIndex: event.segmentIndex }),
          ...(event.pendingToolName ? { pendingToolName: event.pendingToolName } : {}),
          ...(event.reason ? { reasonCode: event.reason } : {}),
        },
      },
    });
  } : undefined;

  const exposeQualifiedTools = async () => {
    definitions = qualifiedDefinitions();
    currentMetadata = appendMainAgentToolExposureTrace(currentMetadata, {
      sequence: ++toolExposureSequence,
      event: "tools_exposed",
      intentEpoch: input.project.intentEpoch ?? 0,
      allowedToolNames: definitions.map((tool) => tool.transportName),
    });
    await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
    return {
      tools: definitions.map(toolDefinitionToOpenAiFunctionTool),
      allowedToolNames: definitions.map((tool) => tool.transportName),
    };
  };

  return {
    tools: definitions.map(toolDefinitionToOpenAiFunctionTool),
    allowedToolNames: definitions.map((tool) => tool.transportName),
    prepareTools: exposeQualifiedTools,
    refreshTools: exposeQualifiedTools,
    describeToolCall: (call) => describeTeacherVisibleToolCall({
      toolName: call.toolName,
      definitions,
      taskBrief: input.taskBrief,
      artifacts: taskArtifacts(),
    }),
    validateCompletion: () => evaluateTaskCompletionContract(input.taskBrief, input.artifacts),
    maxToolRounds: taskBudget?.maxToolRounds ?? 8,
    maxToolRoundsPerSegment: input.taskBrief && input.intentGrant ? 8 : undefined,
    resumeCheckpoint,
    getCheckpointSeed: () => ({
      projectId: input.project.id,
      taskId: input.taskBrief?.taskId ?? null,
      taskBriefDigest: input.taskBrief?.digest ?? null,
      intentEpoch: input.project.intentEpoch ?? null,
      planRevision: currentPlanRevision,
      generationIntensity: input.project.generationIntensity ?? null,
      authorization: {
        standardWorkAuthorized: input.intentGrant?.standardWorkAuthorized ?? false,
        budgetPolicyVersion: input.intentGrant?.budgetPolicyVersion ?? null,
        maxCostCredits: input.intentGrant?.maxCostCredits ?? null,
        maxExternalProviderCalls: input.intentGrant?.maxExternalProviderCalls ?? null,
      },
    }),
    onContextTelemetry: async (event) => {
      currentMetadata = appendMainAgentReActContextTelemetry(currentMetadata, event);
      await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
    },
    onSegmentCheckpoint: persistCheckpoint ? async (event) => persistCheckpoint(event, "active") : undefined,
    onRecoveryCheckpoint: persistCheckpoint ? async (event) => {
      if (event.reason === "human_gate_required") {
        const observations = readAgentObservationsFromMetadata(currentMetadata);
        const latestObservation = [...observations].reverse().find((observation) =>
          event.observationIds.includes(observation.observationId));
        const latestToolName = event.checkpoint.completedRounds.at(-1)?.toolName ?? "main_agent_tool_loop";
        currentMetadata = appendRunCheckpointMetadata(
          currentMetadata,
          createRunCheckpoint({
            checkpointId: event.checkpoint.checkpointDigest,
            projectId: input.project.id,
            planVersion: currentPlanRevision,
            reason: "human_gate_required",
            actionKey: latestObservation?.actionKey ?? latestToolName,
            inputHash: latestObservation?.inputHash,
            observationRefs: event.observationIds,
          }),
        );
        await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
      }
      if (event.reason === "dialogue_checkpoint_required") {
        if (!activeDialogueCheckpoint) throw new Error("DialogueCheckpoint recovery requires a pending checkpoint.");
        const observations = readAgentObservationsFromMetadata(currentMetadata);
        const latestObservation = [...observations].reverse().find((observation) =>
          event.observationIds.includes(observation.observationId));
        currentMetadata = appendRunCheckpointMetadata(
          { ...currentMetadata, dialogueCheckpoint: structuredClone(activeDialogueCheckpoint) },
          createRunCheckpoint({
            checkpointId: event.checkpoint.checkpointDigest,
            projectId: input.project.id,
            planVersion: currentPlanRevision,
            reason: "dialogue_checkpoint_required",
            actionKey: latestObservation?.actionKey ?? "request_teacher_decision",
            inputHash: latestObservation?.inputHash,
            observationRefs: event.observationIds,
          }),
        );
        await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
      }
      if (event.reason === "completion_contract_unsatisfied") {
        const observation = createAgentObservation({
          projectId: input.project.id,
          source: "validation",
          status: "blocked",
          actionKey: "main_agent_completion_contract",
          inputHash: hashRunInput({
            taskBriefDigest: input.taskBrief?.digest ?? null,
            intentEpoch: input.project.intentEpoch ?? 0,
            planRevision: currentPlanRevision,
            remainingRequestedOutputs: event.remainingRequestedOutputs ?? [],
          }),
          reasonCodes: ["completion_contract_unsatisfied", "remaining_requested_outputs"],
          reportRefs: [],
          targetLocators: [],
          responsibleStage: "main_agent_control_loop",
          minimalNextAction: "pause",
          teacherSafeSummary: "当前任务还没有完整完成，进度已保存，可以从现有成果继续。",
        });
        currentMetadata = appendRunCheckpointMetadata(
          appendAgentObservationMetadata(currentMetadata, observation),
          createRunCheckpoint({
            checkpointId: event.checkpoint.checkpointDigest,
            projectId: input.project.id,
            planVersion: currentPlanRevision,
            reason: "completion_contract_unsatisfied",
            actionKey: "main_agent_completion_contract",
            inputHash: observation.inputHash,
            observationRefs: [...event.observationIds, observation.observationId],
          }),
        );
        await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
      }
      if (event.reason === "adapter_failed") {
        const observations = readAgentObservationsFromMetadata(currentMetadata);
        const latestObservation = [...observations].reverse().find((observation) =>
          event.observationIds.includes(observation.observationId));
        const latestToolName = event.checkpoint.completedRounds.at(-1)?.toolName ?? "main_agent_tool_loop";
        currentMetadata = appendMainAgentToolExposureTrace(
          appendRunCheckpointMetadata(
            currentMetadata,
            createRunCheckpoint({
              checkpointId: event.checkpoint.checkpointDigest,
              projectId: input.project.id,
              planVersion: currentPlanRevision,
              reason: "adapter_failed",
              actionKey: latestObservation?.actionKey ?? latestToolName,
              inputHash: latestObservation?.inputHash,
              observationRefs: event.observationIds,
            }),
          ),
          {
            sequence: ++toolExposureSequence,
            event: "run_paused",
            intentEpoch: input.project.intentEpoch ?? 0,
            allowedToolNames: definitions.map((tool) => tool.transportName),
            selectedToolName: latestToolName,
            rejectionReason: "adapter_failed",
          },
        );
        await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
      }
      if (event.reason === "repeated_tool_call" || event.reason === "repeated_tool_failure") {
        const observations = readAgentObservationsFromMetadata(currentMetadata);
        const latestObservation = [...observations].reverse().find((observation) =>
          event.observationIds.includes(observation.observationId));
        const latestToolName = event.checkpoint.completedRounds.at(-1)?.toolName ?? "main_agent_tool_loop";
        currentMetadata = appendMainAgentToolExposureTrace(
          appendRunCheckpointMetadata(
            currentMetadata,
            createRunCheckpoint({
              checkpointId: event.checkpoint.checkpointDigest,
              projectId: input.project.id,
              planVersion: currentPlanRevision,
              reason: "repeated_failure",
              actionKey: latestObservation?.actionKey ?? latestToolName,
              inputHash: latestObservation?.inputHash,
              observationRefs: event.observationIds,
            }),
          ),
          {
            sequence: ++toolExposureSequence,
            event: "run_paused",
            intentEpoch: input.project.intentEpoch ?? 0,
            allowedToolNames: definitions.map((tool) => tool.transportName),
            selectedToolName: latestToolName,
            rejectionReason: event.reason,
          },
        );
        await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
      }
      await persistCheckpoint(event, "paused_recovery");
    } : undefined,
    onRejectedToolCall: async (event) => {
      currentMetadata = appendMainAgentToolExposureTrace(currentMetadata, {
        sequence: ++toolExposureSequence,
        event: "tool_rejected",
        intentEpoch: input.project.intentEpoch ?? 0,
        allowedToolNames: definitions.map((tool) => tool.transportName),
        selectedToolName: event.toolName,
        rejectionReason: event.reason,
      });
      await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
    },
    onBudgetExhausted: async (event) => {
      const pause = createMainAgentRoundBudgetPause({
        projectId: input.project.id,
        taskBriefDigest: input.taskBrief?.digest ?? null,
        intentEpoch: input.project.intentEpoch ?? 0,
        planRevision: currentPlanRevision,
        event,
      });
      currentMetadata = appendMainAgentToolExposureTrace(
        appendRunCheckpointMetadata(
          appendAgentObservationMetadata(currentMetadata, pause.observation),
          pause.checkpoint,
        ),
        {
          sequence: ++toolExposureSequence,
          event: "run_paused",
          intentEpoch: input.project.intentEpoch ?? 0,
          allowedToolNames: definitions.map((tool) => tool.transportName),
          selectedToolName: event.pendingToolName ?? undefined,
          rejectionReason: event.reason,
        },
      );
      await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
    },
    dispatch: async (call) => {
      const requestedDefinition = definitions.find((definition) => definition.transportName === call.toolName);
      if (!requestedDefinition) {
        return {
          status: "blocked",
          observation: compactContinuationObservation("blocked", ["tool_not_available"], { nextAction: "replan" }),
        };
      }
      currentMetadata = appendMainAgentToolExposureTrace(currentMetadata, {
        sequence: ++toolExposureSequence,
        event: "tool_selected",
        intentEpoch: input.project.intentEpoch ?? 0,
        allowedToolNames: definitions.map((tool) => tool.transportName),
        selectedToolName: call.toolName,
      });
      await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
      const currentProject = await input.service.getProject(input.project.id);
      if ((currentProject.intentEpoch ?? 0) !== (input.project.intentEpoch ?? 0)) {
        return {
          status: "inconclusive",
          observation: compactContinuationObservation("inconclusive", ["intent_changed"], { nextAction: "replan" }),
        };
      }
      await input.service.renewProjectExecutionLease({ ...input.fence!, leaseMs: 10 * 60 * 1000 });
      const authoritativeAggregate = input.taskBrief
        ? await controlPlaneStore.getTaskAggregate(input.taskBrief.projectId, input.taskBrief.intentEpoch)
        : null;
      if (input.taskBrief && (!authoritativeAggregate || authoritativeAggregate.taskBrief.digest !== input.taskBrief.digest)) {
        return {
          status: "inconclusive",
          observation: compactContinuationObservation("inconclusive", ["task_aggregate_stale"], { nextAction: "replan" }),
        };
      }
      const authoritativeIntentGrant = authoritativeAggregate?.intentGrant ?? input.intentGrant;
      const executionEnvelope = input.taskBrief
        ? createExecutionEnvelope({
            actorUserId: input.identity!.actorUserId,
            taskBrief: input.taskBrief,
            planRevision: currentPlanRevision,
            intensity: input.project.generationIntensity ?? "standard",
            intentGrant: authoritativeIntentGrant ?? createUnauthorizedIntentGrant(
              input.taskBrief,
              input.project.generationIntensity ?? "standard",
            ),
            action: { toolName: requestedDefinition.internalToolId ?? requestedDefinition.id, arguments: call.arguments },
          })
        : undefined;
      const pptAssetBatchExecution = executionEnvelope && input.taskBrief
        ? await preparePptAssetBatchExecution({
            service: input.service,
            projectId: input.project.id,
            definition: requestedDefinition,
            artifacts: taskArtifacts(),
            taskBrief: input.taskBrief,
          })
        : null;
      if (isMainAgentControlToolDefinition(requestedDefinition)) {
        if (!executionEnvelope || !input.taskBrief) {
          return {
            status: "blocked",
            observation: compactContinuationObservation("blocked", ["dialogue_checkpoint_task_required"], { nextAction: "replan" }),
          };
        }
        let invocationId: string = randomUUID();
        const claim = await controlPlaneStore.startToolInvocation({
          invocationId,
          envelope: executionEnvelope,
          toolName: requestedDefinition.id,
          request: structuredClone(call.arguments),
        });
        if (claim.kind === "terminal_replay") {
          const replayCheckpoint = claim.observation.payload.dialogueCheckpoint;
          if (isDialogueCheckpoint(replayCheckpoint)) activeDialogueCheckpoint = replayCheckpoint;
          return {
            status: "blocked",
            pauseKind: "dialogue_checkpoint",
            observation: compactContinuationObservation("needs_input", claim.observation.reasonCodes, {
              observationId: claim.observation.observationId,
              nextAction: "ask_teacher",
              summary: activeDialogueCheckpoint?.question ?? "需要教师判断当前理解边界。",
            }),
          };
        }
        if (claim.kind === "in_progress") return toolInvocationReplayResult(claim);
        invocationId = claim.invocation.invocationId;
        let dialogueCheckpoint: DialogueCheckpoint;
        try {
          dialogueCheckpoint = createDialogueCheckpointFromArguments({
            argumentsValue: call.arguments,
            projectId: input.project.id,
            taskId: input.taskBrief.taskId,
            intentEpoch: input.taskBrief.intentEpoch,
            planRevision: currentPlanRevision + 1,
            sourceMessageId: input.triggerMessage.id,
          });
        } catch {
          const observation = createAgentObservation({
            projectId: input.project.id,
            source: "validation",
            status: "failed",
            actionKey: requestedDefinition.id,
            inputHash: executionEnvelope.idempotencyKey,
            reasonCodes: ["dialogue_checkpoint_input_invalid"],
            reportRefs: [],
            targetLocators: [],
            responsibleStage: "main_agent_control_loop",
            minimalNextAction: "repair_upstream",
            teacherSafeSummary: "当前需要确认的问题还不完整，正在重新组织。",
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
              eventId: randomUUID(), projectId: input.project.id, taskId: input.taskBrief.taskId,
              runId: `turn:${input.triggerMessage.id}`, intentEpoch: input.taskBrief.intentEpoch,
              kind: "tool_observed", visibility: "internal", occurredAt: new Date().toISOString(),
              payload: { observationId: observation.observationId, status: observation.status },
            },
          });
          currentPlanRevision += 1;
          currentMetadata = appendAgentObservationMetadata(currentMetadata, observation);
          await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
          return { status: "failed", observation: observationForContinuation(observation, { nextAction: "replan" }) };
        }
        const observation = createAgentObservation({
          projectId: input.project.id,
          source: "tool",
          status: "needs_input",
          actionKey: requestedDefinition.id,
          inputHash: executionEnvelope.idempotencyKey,
          reasonCodes: ["dialogue_checkpoint_requested"],
          reportRefs: [],
          targetLocators: [],
          responsibleStage: "main_agent_control_loop",
          minimalNextAction: "ask_teacher",
          teacherSafeSummary: dialogueCheckpoint.question,
        });
        await controlPlaneStore.commitToolObservation({
          invocationId,
          invocationStatus: "succeeded",
          observation: {
            observationId: observation.observationId,
            status: observation.status,
            reasonCodes: observation.reasonCodes,
            payload: {
              ...structuredClone(observation),
              dialogueCheckpoint: structuredClone(dialogueCheckpoint),
            },
          },
          event: {
            eventId: randomUUID(),
            projectId: input.project.id,
            taskId: input.taskBrief.taskId,
            runId: `turn:${input.triggerMessage.id}`,
            intentEpoch: input.taskBrief.intentEpoch,
            kind: "decision_pending",
            visibility: "teacher",
            occurredAt: new Date().toISOString(),
            payload: {
              activityId: dialogueCheckpoint.checkpointId,
              label: "需要你判断一个会影响结果的方向",
              status: "needs_input",
              observationId: observation.observationId,
              dialogueCheckpoint: structuredClone(dialogueCheckpoint),
            },
          },
        });
        currentPlanRevision += 1;
        activeDialogueCheckpoint = dialogueCheckpoint;
        currentMetadata = appendAgentObservationMetadata(
          { ...currentMetadata, dialogueCheckpoint: structuredClone(dialogueCheckpoint) },
          observation,
        );
        await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
        return {
          status: "blocked",
          pauseKind: "dialogue_checkpoint",
          observation: observationForContinuation(observation, {
            nextAction: "ask_teacher",
            summary: dialogueCheckpoint.question,
          }),
        };
      }
      if (typeof requestedDefinition.internalToolId === "string") {
        const actionRisk = pptAssetBatchExecution?.pendingUnitCount === 0
          ? "internal"
          : actionRiskForTool(requestedDefinition);
        const policy = evaluateActionPolicy({
          risk: actionRisk,
          intentGrant: authoritativeIntentGrant,
          externalProviderCallsUsed: Math.max(
            externalProviderCallsUsed,
            pptAssetBatchExecution?.authoritativeProviderCallsUsed ?? 0,
          ) + Math.max(0, (pptAssetBatchExecution?.pendingUnitCount ?? 1) - 1),
          expectedScope: {
            projectId: input.project.id,
            intentEpoch: input.project.intentEpoch ?? 0,
            intensity: input.project.generationIntensity ?? "standard",
          },
        });
        if (policy.kind === "human_gate") {
          if (!input.taskBrief || !authoritativeAggregate) {
            return {
              status: "blocked",
              observation: compactContinuationObservation("blocked", [policy.reason], { nextAction: "ask_teacher" }),
            };
          }
          const capabilityId = requestedDefinition.capabilityId;
          if (!capabilityId) throw new Error("HumanGate business Tool requires a capabilityId.");
          const actionId = createHumanGateActionId({
            projectId: input.project.id,
            capabilityId,
            messageId: input.triggerMessage.id,
          });
          const standardBudget = resolveStandardTaskBudget(input.taskBrief);
          const upgradedBudget = resolveBudgetUpgrade({
            taskBrief: input.taskBrief,
            currentMaxExternalProviderCalls: authoritativeIntentGrant?.maxExternalProviderCalls,
          });
          activeHumanGateDecision = createPendingDecisionForAction({
            action: actionRisk,
            decision: policy,
            actionId,
            actorUserId: input.identity!.actorUserId,
            projectId: input.project.id,
            taskId: input.taskBrief.taskId,
            intentEpoch: input.taskBrief.intentEpoch,
            planId: authoritativeAggregate.plan.planId,
            intentGrant: authoritativeIntentGrant,
            disclosedBudget: policy.reason === "budget_not_disclosed"
              ? {
                  budgetPolicyVersion: standardBudget.policyVersion,
                  maxCostCredits: null,
                  maxExternalProviderCalls: standardBudget.maxExternalProviderCalls,
                }
              : policy.reason === "budget_upgrade"
                ? {
                    budgetPolicyVersion: upgradedBudget.policyVersion,
                    maxCostCredits: null,
                    maxExternalProviderCalls: upgradedBudget.maxExternalProviderCalls,
                  }
                : undefined,
          });
          currentMetadata = {
            ...currentMetadata,
            pendingDeliveryPlan: {
              status: "pending",
              teacherRequest: input.taskBrief.goal,
              toolPlan: {
                planId: activeHumanGateDecision.planId,
                capabilityId,
                reasonForUser: requestedDefinition.teacherDescription ?? requestedDefinition.description,
                internalReason: `native_human_gate:${policy.reason}`,
                inputDraft: structuredClone(call.arguments),
                missingInputs: [],
                upstreamPlan: [],
                nextSuggestedCapabilities: [],
                requiresConfirmation: true,
                expectedArtifactKind: requestedDefinition.producedArtifactKind ?? capabilityId,
              },
              taskBrief: structuredClone(input.taskBrief),
              ...(authoritativeIntentGrant ? { intentGrant: structuredClone(authoritativeIntentGrant) } : {}),
              externalProviderCallsUsed,
              runtimeKind: "openai",
              actionId,
              pendingDecision: structuredClone(activeHumanGateDecision),
            },
          };
          let policyObservation: AgentObservation | undefined;
          if (executionEnvelope) {
            let policyInvocationId: string = randomUUID();
            const claim = await controlPlaneStore.startToolInvocation({
              invocationId: policyInvocationId,
              envelope: executionEnvelope,
              toolName: requestedDefinition.internalToolId,
              request: structuredClone(call.arguments),
            });
            if (claim.kind !== "claimed") return toolInvocationReplayResult(claim);
            policyInvocationId = claim.invocation.invocationId;
            const observation = createAgentObservation({
              projectId: input.project.id,
              source: policy.reason === "budget_not_disclosed" || policy.reason === "budget_upgrade"
                ? "budget"
                : "validation",
              status: "blocked",
              actionKey: requestedDefinition.internalToolId,
              inputHash: executionEnvelope.idempotencyKey,
              reasonCodes: [policy.reason],
              reportRefs: [],
              targetLocators: [],
              responsibleStage: "action_policy",
              minimalNextAction: "ask_teacher",
              teacherSafeSummary: "这一步需要先完成相应授权或预算决定，当前没有执行外部操作。",
            });
            policyObservation = observation;
            await persistAgentToolObservation({
              controlPlaneStore,
              invocationId: policyInvocationId,
              executionEnvelope,
              triggerMessageId: input.triggerMessage.id,
              observation,
            });
            currentPlanRevision += 1;
            currentMetadata = appendAgentObservationMetadata(currentMetadata, observation);
          }
          await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
          await controlPlaneStore.appendEvent({
            eventId: randomUUID(),
            projectId: input.project.id,
            taskId: input.taskBrief.taskId,
            runId: `turn:${input.triggerMessage.id}`,
            intentEpoch: input.taskBrief.intentEpoch,
            kind: "decision_pending",
            visibility: "teacher",
            occurredAt: new Date().toISOString(),
            payload: {
              decisionId: activeHumanGateDecision.decisionId,
              actionId,
              status: "waiting",
              reasonCode: policy.reason,
              question: activeHumanGateDecision.question,
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
      }
      const reviewTargetRef = resolveReviewTarget(call.arguments, taskArtifacts());
      let businessSkillContext: BusinessToolSkillContext | undefined;
      let invocationId: string = randomUUID();
      let invocationClaim: ToolInvocationClaim | undefined;
      if (executionEnvelope) {
        const claim = await controlPlaneStore.startToolInvocation({
          invocationId,
          envelope: executionEnvelope,
          toolName: requestedDefinition.internalToolId ?? requestedDefinition.id,
          request: structuredClone(call.arguments),
        });
        if (claim.kind === "terminal_replay") return toolInvocationReplayResult(claim);
        invocationClaim = claim;
        invocationId = claim.invocation.invocationId;
      }
      const skillBoundBusinessTool = typeof requestedDefinition.internalToolId === "string" &&
        Boolean(requestedDefinition.businessSkillName);
      const formalSkillBoundBusinessTool = skillBoundBusinessTool &&
        requestedDefinition.businessSkillBindingMode === "skill";
      const missingSkillRuntimeMustBlock = formalSkillBoundBusinessTool ||
        input.businessSkillRuntimeMode === "required";
      if (skillBoundBusinessTool && !input.businessSkillRuntime && missingSkillRuntimeMustBlock) {
        if (invocationClaim?.kind === "in_progress") return toolInvocationReplayResult(invocationClaim);
        const reasonCode = "skill_runtime_config_missing";
        const pauseForRequiredRuntime = input.businessSkillRuntimeMode === "required";
        if (executionEnvelope && invocationClaim?.kind === "claimed") {
          const failure = await persistBusinessSkillRuntimeFailure({
            controlPlaneStore,
            invocationId,
            executionEnvelope,
            triggerMessageId: input.triggerMessage.id,
            toolName: requestedDefinition.internalToolId!,
            reasonCode,
            nextAction: pauseForRequiredRuntime ? "pause" : "repair_upstream",
          });
          currentMetadata = appendAgentObservationMetadata(currentMetadata, failure.observation);
          await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
          return {
            status: "blocked",
            observation: observationForContinuation(failure.observation, {
              nextAction: pauseForRequiredRuntime ? "pause" : "replan",
              reportRefs: [{ id: failure.validationReport.reportId, kind: "validation", digest: failure.validationReport.reportDigest }],
            }),
          };
        }
        return {
          status: "blocked",
          observation: compactContinuationObservation("blocked", [reasonCode], {
            nextAction: pauseForRequiredRuntime ? "pause" : "replan",
          }),
        };
      }
      if (skillBoundBusinessTool && input.businessSkillRuntime) {
        try {
          businessSkillContext = await input.businessSkillRuntime.loadForSelectedTool({
            selectedBy: "main_agent",
            businessToolName: requestedDefinition.id,
          });
        } catch (error) {
          const required = input.businessSkillRuntimeMode === "required";
          const reasonCode = skillRuntimeFailureReason(error) ?? "business_skill_load_failed";
          if (executionEnvelope && invocationClaim?.kind === "claimed") {
            const failure = await persistBusinessSkillRuntimeFailure({
              controlPlaneStore,
              invocationId,
              executionEnvelope,
              triggerMessageId: input.triggerMessage.id,
              toolName: requestedDefinition.internalToolId!,
              reasonCode,
              nextAction: required ? "pause" : "repair_upstream",
            });
            currentMetadata = appendAgentObservationMetadata(currentMetadata, failure.observation);
            await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
            return {
              status: "blocked",
              observation: observationForContinuation(failure.observation, {
                nextAction: required ? "pause" : "replan",
                reportRefs: [{ id: failure.validationReport.reportId, kind: "validation", digest: failure.validationReport.reportDigest }],
              }),
            };
          }
          return {
            status: "blocked",
            observation: compactContinuationObservation("blocked", [reasonCode], {
              nextAction: required ? "pause" : "replan",
            }),
          };
        }
      }
      const providerGeneration = executionEnvelope
        ? await prepareNativeProviderGeneration({
            service: input.service,
            projectId: input.project.id,
            definition: requestedDefinition,
            artifacts: taskArtifacts(),
            arguments: call.arguments,
            idempotencyKey: executionEnvelope.idempotencyKey,
            taskBriefDigest: executionEnvelope.taskBriefDigest,
            intentEpoch: executionEnvelope.intentEpoch,
            pptAssetBatchLifecycle: pptAssetBatchExecution?.lifecycle,
          })
        : null;
      if (invocationClaim?.kind === "in_progress" && !providerGeneration?.lifecycle.providerTaskId) {
        return toolInvocationReplayResult(invocationClaim);
      }
      if (invocationClaim) currentPlanRevision += 1;
      if (providerGeneration?.active.job.status === "submission_unknown") {
        const observation = createAgentObservation({
          projectId: input.project.id,
          source: "tool",
          status: "inconclusive",
          actionKey: requestedDefinition.internalToolId ?? requestedDefinition.id,
          inputHash: executionEnvelope!.idempotencyKey,
          reasonCodes: ["submission_unknown"],
          reportRefs: [],
          targetLocators: [],
          responsibleStage: requestedDefinition.internalToolId ?? requestedDefinition.id,
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
            projectId: executionEnvelope!.projectId,
            taskId: executionEnvelope!.taskId,
            runId: `turn:${input.triggerMessage.id}`,
            intentEpoch: executionEnvelope!.intentEpoch,
            kind: "tool_observed",
            visibility: "internal",
            occurredAt: new Date().toISOString(),
            payload: { observationId: observation.observationId, status: observation.status },
          },
        });
        currentMetadata = appendAgentObservationMetadata(currentMetadata, observation);
        await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
        return {
          status: "inconclusive",
          observation: observationForContinuation(observation, { nextAction: "pause" }),
        };
      }
      const dispatch = await dispatchMainAgentToolCall({
        invocationId,
        toolName: call.toolName,
        arguments: call.arguments,
        serverContext: {
          identity: input.identity!,
          projectId: input.project.id,
          intentEpoch: input.project.intentEpoch ?? 0,
          sourceMessageId: input.triggerMessage.id,
          generationIntensity: input.project.generationIntensity,
          approvedArtifactRefs: taskArtifacts().filter(isArtifactTrustedForDownstream).map(toArtifactRef),
          reviewTargetRef,
          executionEnvelope,
          executionScope: input.taskBrief ? {
            actorUserId: input.identity!.actorUserId,
            projectId: input.project.id,
            taskId: input.taskBrief.taskId,
            intentEpoch: input.project.intentEpoch ?? 0,
            planRevision: executionEnvelope?.planRevision ?? currentPlanRevision,
            intensity: input.project.generationIntensity ?? "standard",
            taskBriefDigest: input.taskBrief.digest,
          } : undefined,
        },
      }, { agentToolExecutor: input.executor, businessToolRouter: input.businessToolRouter ?? routeToolCall, allowBusinessExecution: true, buildBusinessToolInput: (request, internalToolId) => ({
        toolName: internalToolId,
        projectId: input.project.id,
        project: input.project,
        runtime: input.runtime,
        projectContext: toRuntimeProjectContext(input.project, input.taskBrief),
        approvedArtifacts: taskArtifacts()
          .filter(isArtifactTrustedForDownstream)
          .filter((artifact) => requestedDefinition.requiredArtifactKinds.includes(artifact.kind))
          .map(toApprovedRuntimeArtifact),
        userInstruction: resolveBusinessToolInstruction(request.arguments, input.triggerMessage.content),
        toolInput: {
          ...structuredClone(request.arguments),
          taskBrief: structuredClone(input.taskBrief ?? null),
          intentGrant: structuredClone(input.intentGrant ?? null),
          generationIntensity: input.project.generationIntensity ?? "standard",
          intentEpoch: input.project.intentEpoch ?? 0,
        },
        artifactRefs: taskArtifacts().map((artifact) => ({ kind: artifact.kind, artifactId: artifact.id, title: artifact.title, summary: artifact.summary })),
        resolvedArtifacts: taskArtifacts(),
        sourceMessageId: input.triggerMessage.id,
        executionIntentEpoch: input.project.intentEpoch ?? 0,
        executionEnvelope,
        executionInputHash: providerGeneration?.active.job.inputHash ?? executionEnvelope?.idempotencyKey ?? hashRunInput({ projectId: input.project.id, toolName: internalToolId, arguments: request.arguments, intentEpoch: input.project.intentEpoch ?? 0 }),
        pptDirectorPlan: internalToolId === "create_ppt_design_draft" ? latestPptDirectorPlan : undefined,
        businessSkillContext,
        ...(providerGeneration ? { generationTaskLifecycle: providerGeneration.lifecycle } : {}),
        ...(providerGeneration?.pptAssetBatchLifecycle ? { pptAssetBatchLifecycle: providerGeneration.pptAssetBatchLifecycle } : {}),
      }) });
      const providerBudgetEvent = dispatch.kind === "business_tool" && dispatch.result.budgetEvent.providerSubmitted
        ? dispatch.result.budgetEvent
        : undefined;
      if (providerBudgetEvent) {
        externalProviderCallsUsed += providerBudgetEvent.providerSubmissionCount ?? 1;
        currentMetadata = appendAgentHarnessBudgetEventMetadata(currentMetadata, providerBudgetEvent);
        await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
      }
      if (dispatch.kind === "agent_tool" &&
          dispatch.envelope.toolId === "ppt_director.plan_or_repair" &&
          dispatch.result.status === "succeeded") {
        latestPptDirectorPlan = {
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

      if (dispatch.kind === "blocked") {
        if (executionEnvelope) {
          const blockedObservation = createAgentObservation({
            observationId: dispatch.result.observation.observationId,
            projectId: input.project.id,
            source: "tool",
            status: "blocked",
            actionKey: requestedDefinition.internalToolId ?? requestedDefinition.id,
            inputHash: executionEnvelope.idempotencyKey,
            reasonCodes: [dispatch.result.observation.kind, dispatch.result.observation.internalReasonSanitized],
            reportRefs: [],
            targetLocators: [],
            responsibleStage: requestedDefinition.internalToolId ?? requestedDefinition.id,
            minimalNextAction: "repair_upstream",
            teacherSafeSummary: dispatch.result.observation.teacherSafeSummary,
          });
          await controlPlaneStore.commitToolObservation({
            invocationId, invocationStatus: "blocked",
            ...(providerGeneration ? {
              generationJob: {
                jobId: providerGeneration.active.job.id,
                status: "failed" as const,
                errorMessage: dispatch.result.observation.teacherSafeSummary,
              },
            } : {}),
            observation: {
              observationId: blockedObservation.observationId,
              status: blockedObservation.status,
              reasonCodes: blockedObservation.reasonCodes,
              payload: structuredClone(blockedObservation) as unknown as Record<string, unknown>,
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
              payload: { observationId: blockedObservation.observationId, status: "blocked" },
            },
          });
          currentMetadata = appendAgentObservationMetadata(currentMetadata, blockedObservation);
          await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
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
      if (dispatch.kind === "business_tool") {
        if (dispatch.result.status !== "succeeded") {
          const primaryReason = dispatch.result.status === "needs_input" ? "missing_inputs" : dispatch.result.errorCategory ?? "tool_failed";
          const failureDetails = [...new Set([
            ...(dispatch.result.observation.reasonCode ? [dispatch.result.observation.reasonCode] : []),
            ...(dispatch.result.observation.reasonDetails ?? []),
            ...safeFailureDetails(dispatch.result.observation.internalReasonSanitized),
            ...validationFailureDetails(dispatch.result.validationReport),
          ])];
          const reasonCodes = [...new Set([primaryReason, ...failureDetails])];
          const invocationValidationReport = bindFailureValidationReportToInvocation(
            dispatch.result.validationReport,
            invocationId,
            input.project.intentEpoch ?? 0,
          );
          const reportRefs = invocationValidationReport ? [{
            id: invocationValidationReport.reportId,
            kind: "validation" as const,
            digest: invocationValidationReport.reportDigest,
          }] : [];
          const observation = createAgentObservation({
            projectId: input.project.id, source: "tool", status: dispatch.result.status === "needs_input" ? "inconclusive" : "failed",
            actionKey: dispatch.result.toolId, inputHash: hashRunInput({ toolId: dispatch.result.toolId, call: call.arguments }),
            reasonCodes, reportRefs, targetLocators: [],
            responsibleStage: dispatch.result.capabilityId, minimalNextAction: "repair_upstream",
            teacherSafeSummary: dispatch.result.status === "needs_input" ? dispatch.result.assistantPrompt : dispatch.result.observation.teacherSafeSummary,
          });
          await controlPlaneStore.commitToolFailure({
            invocationId,
            ...(providerGeneration ? {
              generationJob: {
                jobId: providerGeneration.active.job.id,
                status: "errorCategory" in dispatch.result && dispatch.result.errorCategory === "submission_unknown"
                  ? "submission_unknown" as const
                  : "failed" as const,
                errorMessage: dispatch.result.observation.teacherSafeSummary,
              },
            } : {}),
            observation: {
              observationId: observation.observationId,
              status: observation.status,
              reasonCodes: observation.reasonCodes,
              payload: {
                ...structuredClone(observation),
                ...(providerBudgetEvent ? { budgetEvent: structuredClone(providerBudgetEvent) } : {}),
              } as unknown as Record<string, unknown>,
            },
            ...(invocationValidationReport ? { validationReport: invocationValidationReport } : {}),
            event: {
              eventId: randomUUID(),
              projectId: input.project.id,
              taskId: input.taskBrief!.taskId,
              runId: `turn:${input.triggerMessage.id}`,
              intentEpoch: input.project.intentEpoch ?? 0,
              kind: "tool_observed",
              visibility: "internal",
              occurredAt: new Date().toISOString(),
              payload: { observationId: observation.observationId, status: observation.status },
            },
          });
          currentMetadata = appendAgentObservationMetadata(currentMetadata, observation);
          await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
          return {
            status: observationStatusForModel(observation),
            observation: observationForContinuation(observation, {
              reportRefs,
              nextAction: "replan",
              reasonCodes,
              summary: dispatch.result.status === "needs_input"
                ? `${observation.teacherSafeSummary} missing:${dispatch.result.missingInputs.join(",")}`
                : observation.teacherSafeSummary,
            }),
          };
        }
        let formalSkillValidation: BusinessToolSkillResultValidation | undefined;
        if (businessSkillContext?.semanticSlice.bindingMode === "formal_contract") {
          try {
            if (!input.businessSkillRuntime) {
              throw new BusinessToolSkillOutputContractError(
                "formal_skill_output_contract_mismatch",
                "Formal Skill Runtime is unavailable for output validation.",
              );
            }
            formalSkillValidation = await input.businessSkillRuntime.validateSelectedToolResult({
              businessToolName: requestedDefinition.id,
              context: businessSkillContext,
              result: dispatch.result,
            });
            if (formalSkillValidation.status !== "passed") {
              throw new BusinessToolSkillOutputContractError(
                "formal_skill_output_contract_mismatch",
                "Formal Skill output validation did not produce passing evidence.",
              );
            }
          } catch (error) {
            const failure = await persistBusinessSkillOutputFailure({
              controlPlaneStore,
              invocationId,
              executionEnvelope: executionEnvelope!,
              triggerMessageId: input.triggerMessage.id,
              toolName: requestedDefinition.internalToolId!,
              businessSkillContext,
              error,
              ...(providerGeneration ? { generationJobId: providerGeneration.active.job.id } : {}),
            });
            currentMetadata = appendAgentObservationMetadata(currentMetadata, failure.observation);
            await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
            return {
              status: "failed",
              observation: observationForContinuation(failure.observation, {
                nextAction: "replan",
                reportRefs: [{
                  id: failure.validationReport.reportId,
                  kind: "validation",
                  digest: failure.validationReport.reportDigest,
                }],
              }),
            };
          }
        }
        const observationId = randomUUID();
        const committed = await controlPlaneStore.commitToolResult({
          invocationId,
          ...(providerGeneration ? { generationJobId: providerGeneration.active.job.id } : {}),
          artifact: {
            nodeKey: dispatch.result.artifactDraft.nodeKey as ArtifactRecord["nodeKey"],
            kind: dispatch.result.artifactDraft.kind as ArtifactRecord["kind"],
            title: dispatch.result.artifactDraft.title,
            status: "needs_review",
            summary: dispatch.result.artifactDraft.summary,
            markdownContent: dispatch.result.artifactDraft.markdownContent ?? "",
            structuredContent: dispatch.result.artifactDraft.structuredContent,
            validationReport: dispatch.result.validationReport,
          },
          observation: {
            observationId,
            status: "succeeded",
            reasonCodes: ["business_tool_succeeded"],
            payload: {
              actionKey: dispatch.result.toolId,
              inputHash: hashRunInput({ toolId: dispatch.result.toolId, call: call.arguments }),
              summary: dispatch.result.assistantSummary,
              ...(formalSkillValidation?.status === "passed"
                ? { businessSkillContractValidation: structuredClone(formalSkillValidation) }
                : {}),
              ...(providerBudgetEvent ? { budgetEvent: structuredClone(providerBudgetEvent) } : {}),
            },
          },
          event: {
            eventId: randomUUID(),
            projectId: input.project.id,
            taskId: input.taskBrief!.taskId,
            runId: `turn:${input.triggerMessage.id}`,
            intentEpoch: input.project.intentEpoch ?? 0,
            kind: "artifact_committed",
            visibility: "internal",
            occurredAt: new Date().toISOString(),
            payload: { observationId, toolName: requestedDefinition.internalToolId },
          },
        });
        const artifact = mapCommittedArtifact(committed.artifact as Artifact);
        input.artifacts.push(artifact);
        const observation = createAgentObservation({
          observationId,
          projectId: input.project.id, source: "tool", status: "succeeded", actionKey: dispatch.result.toolId,
          inputHash: hashRunInput({ toolId: dispatch.result.toolId, artifactId: artifact.id }), reasonCodes: ["business_tool_succeeded"], reportRefs: [],
          targetLocators: [{ kind: "artifact", artifactKind: artifact.kind, artifactId: artifact.id }], responsibleStage: dispatch.result.capabilityId,
          minimalNextAction: "continue", teacherSafeSummary: dispatch.result.assistantSummary,
        });
        currentMetadata = appendAgentObservationMetadata(currentMetadata, observation);
        await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
        return {
          status: "succeeded",
          observation: observationForContinuation(observation, {
            artifactRefs: [{
              artifactId: artifact.id,
              kind: artifact.kind,
              version: artifact.version,
              digest: hashArtifactDraft({
                nodeKey: artifact.nodeKey,
                kind: artifact.kind,
                title: artifact.title,
                summary: artifact.summary,
                markdownContent: artifact.markdownContent,
                structuredContent: artifact.structuredContent,
              }),
            }],
          }),
        };
      }

      const latestProject = await input.service.getProject(input.project.id);
      if ((latestProject.intentEpoch ?? 0) !== (input.project.intentEpoch ?? 0)) {
        return {
          status: "inconclusive",
          observation: compactContinuationObservation("inconclusive", ["stale_result"], { nextAction: "replan" }),
        };
      }
      await input.service.renewProjectExecutionLease({ ...input.fence!, leaseMs: 10 * 60 * 1000 });

      const report = createPersistedAgentToolReport(dispatch.envelope, dispatch.result);
      let reviewArtifact: ArtifactRecord | undefined;
      let reviewArtifactInput: SaveArtifactInput | undefined;
      if (dispatch.result.status === "succeeded" &&
          dispatch.envelope.toolId === "delivery_critic.review" &&
          dispatch.envelope.arguments.domain === "ppt") {
        const target = dispatch.envelope.reviewTargetRef
          ? input.artifacts.find((artifact) => artifact.id === dispatch.envelope.reviewTargetRef?.artifactId)
          : undefined;
        try {
          if (!target) throw new Error("ppt_critic_target_missing");
          const adapted = adaptPptAgentCriticReview({
            projectId: input.project.id,
            intentEpoch: input.project.intentEpoch ?? 0,
            envelope: dispatch.envelope,
            artifact: target,
            structuredOutput: dispatch.result.structuredOutput,
          });
          reviewArtifactInput = adapted.kind === "sample"
            ? buildPptSampleReviewArtifact(target, adapted.submission)
            : buildPptFullDeckReviewArtifact(target, adapted.submission);
        } catch {
          const observation = createAgentObservation({
            projectId: input.project.id,
            source: "quality",
            status: "inconclusive",
            actionKey: dispatch.envelope.toolId,
            inputHash: dispatch.envelope.inputHash,
            reasonCodes: ["ppt_critic_review_persistence_failed"],
            reportRefs: [{ kind: "critic", id: report.reportId, digest: report.reportDigest }],
            targetLocators: [],
            responsibleStage: String(dispatch.envelope.arguments.stage ?? "ppt_review"),
            minimalNextAction: "repair_upstream",
            teacherSafeSummary: "课件审查证据不完整，暂时不能进入下一步。",
          });
          currentMetadata = appendAgentObservationMetadata(appendAgentToolReportMetadata(currentMetadata, report), observation);
          await persistAgentToolObservation({
            controlPlaneStore,
            invocationId,
            executionEnvelope,
            triggerMessageId: input.triggerMessage.id,
            observation,
          });
          await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
          return {
            status: "inconclusive",
            observation: observationForContinuation(observation, { nextAction: "repair_upstream" }),
          };
        }
      }
      if (dispatch.result.status === "succeeded" &&
          dispatch.envelope.toolId === "delivery_critic.review" &&
          dispatch.envelope.arguments.domain === "video") {
        const target = dispatch.envelope.reviewTargetRef
          ? input.artifacts.find((artifact) => artifact.id === dispatch.envelope.reviewTargetRef?.artifactId)
          : undefined;
        try {
          if (!target) throw new Error("video_critic_target_missing");
          const submission = adaptVideoAgentCriticReview({
            projectId: input.project.id,
            intentEpoch: input.project.intentEpoch ?? 0,
            envelope: dispatch.envelope,
            artifact: target,
            structuredOutput: dispatch.result.structuredOutput,
          });
          reviewArtifactInput = submission;
        } catch {
          const observation = createAgentObservation({
            projectId: input.project.id,
            source: "quality",
            status: "inconclusive",
            actionKey: dispatch.envelope.toolId,
            inputHash: dispatch.envelope.inputHash,
            reasonCodes: ["video_critic_review_persistence_failed"],
            reportRefs: [{ kind: "critic", id: report.reportId, digest: report.reportDigest }],
            targetLocators: [],
            responsibleStage: String(dispatch.envelope.arguments.stage ?? "video_review"),
            minimalNextAction: "repair_upstream",
            teacherSafeSummary: "视频审查证据不完整，暂时不能进入下一步。",
          });
          currentMetadata = appendAgentObservationMetadata(appendAgentToolReportMetadata(currentMetadata, report), observation);
          await persistAgentToolObservation({
            controlPlaneStore,
            invocationId,
            executionEnvelope,
            triggerMessageId: input.triggerMessage.id,
            observation,
          });
          await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
          return {
            status: "inconclusive",
            observation: observationForContinuation(observation, { nextAction: "repair_upstream" }),
          };
        }
      }
      const observation = observationFromReport(dispatch.envelope, dispatch.result, report);
      if (reviewArtifactInput) {
        if (!executionEnvelope) throw new Error("Agent Tool review result requires an ExecutionEnvelope.");
        const committed = await controlPlaneStore.commitToolResult({
          invocationId,
          artifact: reviewArtifactInput,
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
            kind: "artifact_committed",
            visibility: "internal",
            occurredAt: new Date().toISOString(),
            payload: { observationId: observation.observationId, status: observation.status, toolName: dispatch.envelope.toolId },
          },
        });
        reviewArtifact = mapCommittedArtifact(committed.artifact as Artifact);
        input.artifacts.push(reviewArtifact);
      } else {
        await persistAgentToolObservation({
          controlPlaneStore,
          invocationId,
          executionEnvelope,
          triggerMessageId: input.triggerMessage.id,
          observation,
        });
      }
      currentMetadata = appendAgentObservationMetadata(
        appendAgentToolReportMetadata(currentMetadata, report),
        observation,
      );
      await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
      return {
        status: observationStatusForModel(observation),
        observation: observationForContinuation(observation, {
          ...(reviewArtifact ? { artifactRefs: [{ artifactId: reviewArtifact.id, kind: reviewArtifact.kind, version: reviewArtifact.version }] } : {}),
          advisoryNextToolIntents: nextToolIntentsFromStructuredOutput(dispatch.result.status === "succeeded" ? dispatch.result.structuredOutput : null),
        }),
      };
    },
  };
}

type MainAgentToolExposureEvent = {
  sequence: number;
  event: "tools_exposed" | "tool_selected" | "tool_rejected" | "run_paused";
  intentEpoch: number;
  allowedToolNames: string[];
  selectedToolName?: string;
  rejectionReason?: "adapter_failed" | "repeated_tool_call" | "repeated_tool_failure" | "tool_round_limit_reached";
};

function appendMainAgentToolExposureTrace(
  metadata: Record<string, unknown>,
  event: MainAgentToolExposureEvent,
) {
  return {
    ...metadata,
    mainAgentToolExposureTrace: [...readMainAgentToolExposureTrace(metadata), event].slice(-32),
  };
}

function readMainAgentToolExposureTrace(metadata: unknown): MainAgentToolExposureEvent[] {
  if (!isRecord(metadata) || !Array.isArray(metadata.mainAgentToolExposureTrace)) return [];
  return metadata.mainAgentToolExposureTrace.filter(isMainAgentToolExposureEvent);
}

function isMainAgentToolExposureEvent(value: unknown): value is MainAgentToolExposureEvent {
  return isRecord(value) &&
    typeof value.sequence === "number" &&
    (value.event === "tools_exposed" || value.event === "tool_selected" || value.event === "tool_rejected" || value.event === "run_paused") &&
    typeof value.intentEpoch === "number" &&
    Array.isArray(value.allowedToolNames) &&
    value.allowedToolNames.every((name) => typeof name === "string") &&
    (value.selectedToolName === undefined || typeof value.selectedToolName === "string") &&
    (value.rejectionReason === undefined || value.rejectionReason === "adapter_failed" || value.rejectionReason === "repeated_tool_call" || value.rejectionReason === "repeated_tool_failure" || value.rejectionReason === "tool_round_limit_reached");
}

function appendMainAgentReActContextTelemetry(
  metadata: Record<string, unknown>,
  event: MainAgentReActContextTelemetry,
) {
  const existing = Array.isArray(metadata.mainAgentReActContextTelemetry)
    ? metadata.mainAgentReActContextTelemetry.filter(isMainAgentReActContextTelemetry)
    : [];
  return {
    ...metadata,
    mainAgentReActContextTelemetry: [...existing, structuredClone(event)].slice(-16),
  };
}

function isMainAgentReActContextTelemetry(value: unknown): value is MainAgentReActContextTelemetry {
  return isRecord(value) &&
    (value.phase === "initial" || value.phase === "continuation") &&
    typeof value.toolRound === "number" && Number.isInteger(value.toolRound) && value.toolRound >= 0 &&
    typeof value.requestCharacters === "number" && Number.isInteger(value.requestCharacters) && value.requestCharacters > 0 &&
    typeof value.estimatedInputTokens === "number" && Number.isInteger(value.estimatedInputTokens) && value.estimatedInputTokens > 0 &&
    typeof value.checkpointCharacters === "number" && Number.isInteger(value.checkpointCharacters) && value.checkpointCharacters >= 0 &&
    typeof value.checkpointObservationCount === "number" && Number.isInteger(value.checkpointObservationCount) && value.checkpointObservationCount >= 0 &&
    typeof value.toolCount === "number" && Number.isInteger(value.toolCount) && value.toolCount >= 0 &&
    typeof value.responseDurationMs === "number" && Number.isInteger(value.responseDurationMs) && value.responseDurationMs >= 0;
}

function isCurrentlyQualifiedMainAgentTool(
  tool: ReturnType<typeof listMainAgentToolDefinitions>[number],
  trustedKinds: Set<ArtifactRecord["kind"]>,
  presentKinds: Set<ArtifactRecord["kind"]>,
  taskBrief?: TaskBrief,
) {
  if (isMainAgentControlToolDefinition(tool)) return Boolean(taskBrief);
  if (typeof tool.internalToolId === "string") {
    if (!isCapabilityInTaskScope(tool.capabilityId ?? "", taskBrief)) return false;
    if (tool.internalToolId === "create_requirement_spec") {
      return Boolean(taskBrief?.requestedOutputs.length) && !trustedKinds.has("requirement_spec");
    }
    if (nonRepeatableFrontStageToolIds.has(tool.id) &&
        typeof tool.producedArtifactKind === "string" &&
        trustedKinds.has(tool.producedArtifactKind as ArtifactRecord["kind"])) {
      return false;
    }
    return tool.requiredArtifactKinds.every((kind) => trustedKinds.has(kind as ArtifactRecord["kind"]));
  }
  if (tool.id === "ppt_director.plan_or_repair") {
    if (!taskBriefAllowsAny(taskBrief, pptDesignAndDeliveryOutputs)) return false;
    return trustedKinds.has("ppt_draft") || trustedKinds.has("ppt_design_draft") || trustedKinds.has("pptx_artifact");
  }
  if (tool.id === "video_director.plan_or_repair") {
    if (!taskBriefAllowsAny(taskBrief, videoProductionOutputs)) return false;
    return [
      "creative_theme_generate",
      "video_script_generate",
      "storyboard_generate",
      "video_segment_plan",
      "video_segment_generate",
      "concat_only_assemble",
    ].some((kind) => trustedKinds.has(kind as ArtifactRecord["kind"]));
  }
  if (tool.id === "delivery_critic.review") {
    if (!taskBriefAllowsAny(taskBrief, reviewableOutputs)) return false;
    return [
      "ppt_design_draft",
      "image_prompts",
      "pptx_artifact",
      "creative_theme_generate",
      "video_script_generate",
      "storyboard_generate",
      "video_segment_generate",
      "concat_only_assemble",
      "final_delivery",
    ].some((kind) => presentKinds.has(kind as ArtifactRecord["kind"]));
  }
  return false;
}

const pptDesignAndDeliveryOutputs: readonly TaskRequestedOutput[] = [
  "ppt_design", "ppt_sample_assets", "ppt_key_samples", "ppt_full_assets", "ppt", "package",
];
const videoProductionOutputs: readonly TaskRequestedOutput[] = [
  "storyboard", "asset_brief", "video_assets", "video_segment_plan", "video_narration", "video_shot", "video", "package",
];
const reviewableOutputs: readonly TaskRequestedOutput[] = [
  ...pptDesignAndDeliveryOutputs, ...videoProductionOutputs, "image",
];

function taskBriefAllowsAny(taskBrief: TaskBrief | undefined, outputs: readonly TaskRequestedOutput[]): boolean {
  if (!taskBrief) return false;
  return outputs.some((output) => taskBrief.requestedOutputs.includes(output) && !taskBrief.excludedOutputs.includes(output));
}

function bindFailureValidationReportToInvocation(
  report: ValidationReport | undefined,
  invocationId: string,
  intentEpoch: number,
): ValidationReport | undefined {
  if (!report || report.overallStatus !== "failed" || !hasValidValidationReportDigest(report)) return undefined;
  return createValidationReport({
    authority: report.authority,
    domain: report.domain,
    stage: report.stage,
    contract: report.contract,
    ...(report.inputHash !== undefined ? { inputHash: report.inputHash } : {}),
    overallStatus: report.overallStatus,
    gates: report.gates,
    reportId: randomUUID(),
    createdAt: new Date().toISOString(),
    target: { kind: "tool_invocation", targetId: invocationId },
    intentEpoch,
  });
}

function toRuntimeProjectContext(project: ProjectRecord, taskBrief?: TaskBrief) {
  const teacherGoal = taskBrief?.goal ?? project.title;
  const scope = resolveProjectSemanticScope(project, teacherGoal);
  return {
    ...scope,
    textbookVersion: project.textbookVersion ?? undefined,
    teacherGoal,
    requestedOutputs: taskBrief?.requestedOutputs ?? [],
  };
}

function describeTeacherVisibleToolCall(input: {
  toolName: string;
  definitions: MainAgentToolDefinition[];
  taskBrief?: TaskBrief;
  artifacts: ArtifactRecord[];
}) {
  const definition = input.definitions.find((tool) => tool.transportName === input.toolName);
  if (!definition) return {};
  const trustedTitles = input.artifacts.filter(isArtifactTrustedForDownstream).map((artifact) => artifact.title).slice(-3);
  const inputSummary = [
    ...(input.taskBrief?.goal ? [`任务：${input.taskBrief.goal}`] : []),
    trustedTitles.length ? `依据：${trustedTitles.join("、")}` : "依据：当前任务说明和教师要求",
  ];
  if (isMainAgentControlToolDefinition(definition)) {
    return {
      purpose: "校准一个会实质影响结果的理解边界",
      inputSummary,
      expectedOutput: "教师对当前方向的判断",
    };
  }
  return {
    purpose: definition.teacherDescription ?? definition.description,
    inputSummary,
    expectedOutput: definition.producedArtifactKind ? `可继续使用的${definition.label}` : definition.label,
  };
}

function toApprovedRuntimeArtifact(artifact: ArtifactRecord) {
  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    version: artifact.version,
    digest: hashArtifactDraft({
      nodeKey: artifact.nodeKey,
      kind: artifact.kind,
      title: artifact.title,
      summary: artifact.summary,
      markdownContent: artifact.markdownContent,
      structuredContent: artifact.structuredContent,
    }),
    nodeKey: artifact.nodeKey,
    title: artifact.title,
    summary: artifact.summary,
    markdown: artifact.markdownContent,
  };
}

function observationFromReport(
  envelope: AgentToolInvocationEnvelope,
  result: AgentToolRouterResult,
  report: ReturnType<typeof createPersistedAgentToolReport>,
): AgentObservation {
  const successful = result.status === "succeeded";
  const failureDetails = successful ? [] : safeFailureDetails(result.observation.internalReasonSanitized);
  const explicitFailureDetails = successful ? [] : [
    ...(result.observation.reasonCode ? [result.observation.reasonCode] : []),
    ...(result.observation.reasonDetails ?? []),
  ];
  const policy = successful && "policyOutcome" in result ? result.policyOutcome : undefined;
  const structured = successful ? result.structuredOutput : null;
  const status = resolveObservationStatus(result, policy, structured);
  const targetLocators = successful && Array.isArray(structured?.targetLocators)
    ? structured.targetLocators.filter(isTargetLocator)
    : [];
  const responsibleStage = successful && typeof structured?.responsibleStage === "string"
    ? structured.responsibleStage
    : envelope.arguments.stage as string | undefined;
  return createAgentObservation({
    projectId: envelope.projectId,
    source: envelope.toolId === "delivery_critic.review" ? "quality" : "tool",
    status,
    actionKey: envelope.toolId,
    inputHash: envelope.inputHash,
    reasonCodes: policy?.reasonCodes?.length
      ? policy.reasonCodes
      : successful ? [`agent_tool_${status}`] : [...new Set([result.errorCategory ?? result.observation.kind, ...explicitFailureDetails, ...failureDetails])],
    reportRefs: envelope.toolId === "delivery_critic.review"
      ? [{ kind: "critic", id: report.reportId, digest: report.reportDigest }]
      : [],
    targetLocators,
    responsibleStage,
    minimalNextAction: resolveAgentToolNextAction(result, status, targetLocators),
    teacherSafeSummary: report.assistantSummary,
  });
}

function resolveAgentToolNextAction(
  result: AgentToolRouterResult,
  status: AgentObservation["status"],
  targetLocators: AgentObservation["targetLocators"],
): AgentObservation["minimalNextAction"] {
  if (status === "succeeded") return "continue";
  if (status === "repair") return targetLocators.length ? "repair_unit" : "repair_upstream";
  if (result.status !== "succeeded") {
    if (result.observation.kind === "blocked_by_policy" && result.observation.retryPolicy.nextAction === "ask_teacher") {
      return "ask_teacher";
    }
    if (result.observation.retryPolicy.nextAction === "retry_later") return "pause";
  }
  return "repair_upstream";
}

function resolveObservationStatus(
  result: AgentToolRouterResult,
  policy: AgentToolPolicyOutcome | undefined,
  structured: Record<string, unknown> | null,
): AgentObservation["status"] {
  if (result.status !== "succeeded") {
    if (result.status === "needs_input") return "needs_input";
    if (result.status === "inconclusive") return "inconclusive";
    return "failed";
  }
  if (policy) {
    if (policy.passed) return "succeeded";
    if (policy.reviewOutcome === "blocked") return "blocked";
    if (policy.reviewOutcome === "inconclusive") return "inconclusive";
    return "repair";
  }
  if (structured?.decision === "repair") return "repair";
  if (structured?.decision === "blocked") return "blocked";
  if (structured?.decision === "needs_input") return "needs_input";
  return "succeeded";
}

function safeFailureDetails(value: string | undefined): string[] {
  const normalized = String(value ?? "")
    .replace(/^Agent Tool output failed contract validation:\s*/i, "")
    .trim();
  if (!normalized) return [];
  return [...new Set(normalized
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 160 && /^[A-Za-z0-9_.$:[\]-]+$/.test(part))
    .slice(0, 40))];
}

function validationFailureDetails(report: { gates: Array<{ status: string; reasonCode?: string; gateId: string }> } | undefined): string[] {
  if (!report) return [];
  return [...new Set(report.gates
    .filter((gate) => gate.status === "failed" || gate.status === "inconclusive")
    .map((gate) => gate.reasonCode ?? gate.gateId)
    .filter((code) => code.length > 0 && code.length <= 160 && /^[A-Za-z0-9_.$:[\]-]+$/.test(code))
    .slice(0, 40))];
}

function compactContinuationObservation(
  status: MainAgentReActDispatchResult["observation"]["status"],
  reasonCodes: string[],
  extras: Partial<MainAgentReActDispatchResult["observation"]> = {},
): MainAgentReActDispatchResult["observation"] {
  return {
    status,
    reasonCodes: [...new Set(reasonCodes)],
    ...extras,
  };
}

function observationForContinuation(
  observation: AgentObservation,
  extras: Partial<MainAgentReActDispatchResult["observation"]> = {},
): MainAgentReActDispatchResult["observation"] {
  return compactContinuationObservation(observation.status, observation.reasonCodes, {
    observationId: observation.observationId,
    summary: observation.teacherSafeSummary,
    reportRefs: observation.reportRefs,
    targetLocators: observation.targetLocators,
    nextAction: observation.minimalNextAction,
    ...extras,
  });
}

function nextToolIntentsFromStructuredOutput(structuredOutput: Record<string, unknown> | null) {
  if (!structuredOutput || !Array.isArray(structuredOutput.nextToolIntents)) return [];
  return structuredOutput.nextToolIntents
    .filter((value): value is string => typeof value === "string" && /^[a-z0-9_.-]+$/i.test(value))
    .slice(0, 12);
}

function resolveReviewTarget(argumentsValue: Record<string, unknown>, artifacts: ArtifactRecord[]): AgentToolArtifactRef | null {
  const direct = isRecord(argumentsValue.courseAnchorRef) && typeof argumentsValue.courseAnchorRef.artifactId === "string"
    ? argumentsValue.courseAnchorRef.artifactId
    : null;
  const locator = Array.isArray(argumentsValue.targetLocators)
    ? argumentsValue.targetLocators.find((item) => isRecord(item) && item.kind === "artifact" && typeof item.artifactId === "string")
    : null;
  const artifactId = direct ?? (isRecord(locator) ? locator.artifactId as string : null);
  const artifact = artifactId ? artifacts.find((item) => item.id === artifactId) : undefined;
  return artifact ? toArtifactRef(artifact) : null;
}

function toArtifactRef(artifact: ArtifactRecord): AgentToolArtifactRef {
  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    version: artifact.version,
    digest: hashArtifactDraft({
      nodeKey: artifact.nodeKey,
      kind: artifact.kind,
      title: artifact.title,
      summary: artifact.summary,
      markdownContent: artifact.markdownContent,
      structuredContent: artifact.structuredContent,
    }),
  };
}

function observationStatusForModel(observation: AgentObservation): "succeeded" | "failed" | "blocked" | "inconclusive" {
  if (observation.status === "succeeded") return "succeeded";
  if (observation.status === "blocked" || observation.status === "needs_input") return "blocked";
  if (observation.status === "inconclusive") return "inconclusive";
  return "failed";
}

function isTargetLocator(value: unknown): value is AgentObservation["targetLocators"][number] {
  return isRecord(value) && typeof value.kind === "string";
}

function toolInvocationReplayResult(
  claim: Exclude<ToolInvocationClaim, { kind: "claimed" }>,
): MainAgentReActDispatchResult {
  if (claim.kind === "in_progress") {
    return {
      status: "inconclusive",
      observation: compactContinuationObservation("inconclusive", ["tool_invocation_in_progress"], {
        summary: "这一步仍在执行中，系统不会重复提交。",
        nextAction: "pause",
      }),
    };
  }
  const status = persistedObservationStatusForModel(claim.observation.status);
  const summary = typeof claim.observation.payload.teacherSafeSummary === "string"
    ? claim.observation.payload.teacherSafeSummary
    : typeof claim.observation.payload.summary === "string"
      ? claim.observation.payload.summary
      : status === "succeeded"
        ? "已读取这一步先前保存的结果。"
        : "已读取这一步先前保存的失败结果。";
  return {
    status,
    observation: compactContinuationObservation(status, claim.observation.reasonCodes, {
      observationId: claim.observation.observationId,
      summary,
      nextAction: status === "succeeded" ? "continue" : "replan",
      ...(claim.observation.artifactId ? {
        artifactRefs: [{ artifactId: claim.observation.artifactId }],
      } : {}),
    }),
  };
}

function persistedObservationStatusForModel(
  status: string,
): MainAgentReActDispatchResult["status"] {
  if (status === "succeeded") return "succeeded";
  if (status === "blocked" || status === "needs_input") return "blocked";
  if (status === "inconclusive") return "inconclusive";
  return "failed";
}

function resolveBusinessToolInstruction(argumentsValue: Record<string, unknown>, fallback: string) {
  const toolInstruction = typeof argumentsValue.userInstruction === "string"
    ? argumentsValue.userInstruction.trim()
    : "";
  return toolInstruction || fallback;
}

async function prepareNativeProviderGeneration(input: {
  service: WorkbenchService;
  projectId: string;
  definition: MainAgentToolDefinition;
  artifacts: ArtifactRecord[];
  arguments: Record<string, unknown>;
  idempotencyKey: string;
  taskBriefDigest: string;
  intentEpoch: number;
  pptAssetBatchLifecycle?: PptAssetBatchLifecycle;
}) {
  if (input.definition.adapterKind !== "provider" || typeof input.definition.internalToolId !== "string") return null;
  const definition = input.definition;
  const requiredKinds = new Set(definition.requiredArtifactKinds);
  const trustedSources = input.artifacts.filter((artifact) =>
    requiredKinds.has(artifact.kind) && isArtifactTrustedForDownstream(artifact),
  );
  const sourceArtifact = trustedSources.at(-1);
  if (!sourceArtifact) {
    throw new Error("Native Provider Tool requires a trusted source Artifact for GenerationJob recovery.");
  }
  const queued = await input.service.createGenerationJob(input.projectId, {
    kind: generationJobKindFor(definition),
    sourceArtifactId: sourceArtifact.id,
    ...(generationUnitId(input.arguments) ? { unitId: generationUnitId(input.arguments) } : {}),
    capabilityId: definition.capabilityId,
    idempotencyKey: input.idempotencyKey,
    sourceArtifactIds: trustedSources.map((artifact) => artifact.id),
    inputSnapshot: {
      toolName: definition.internalToolId,
      arguments: structuredClone(input.arguments),
      taskBriefDigest: input.taskBriefDigest,
      intentEpoch: input.intentEpoch,
      sourceArtifacts: trustedSources.map((artifact) => ({
        artifactId: artifact.id,
        kind: artifact.kind,
        version: artifact.version,
      })),
    },
    ...(input.pptAssetBatchLifecycle ? { countsAsProviderSubmission: false } : {}),
  });
  const active = await input.service.startGenerationJobForExecution(input.projectId, queued.id);
  return {
    active,
    pptAssetBatchLifecycle: input.pptAssetBatchLifecycle,
    lifecycle: {
      providerTaskId: active.providerTaskId,
      onTaskAccepted: async (providerTaskId: string) => {
        await input.service.recordGenerationProviderTask(input.projectId, active.job.id, { providerTaskId });
      },
      onPoll: async () => {
        await input.service.recordGenerationPoll(input.projectId, active.job.id);
      },
    },
  };
}

type PptAssetBatchExecutionPlan = {
  pendingUnitCount: number;
  authoritativeProviderCallsUsed: number;
  lifecycle: PptAssetBatchLifecycle;
};

async function preparePptAssetBatchExecution(input: {
  service: WorkbenchService;
  projectId: string;
  definition: MainAgentToolDefinition;
  artifacts: ArtifactRecord[];
  taskBrief: TaskBrief;
}): Promise<PptAssetBatchExecutionPlan | null> {
  if (input.definition.internalToolId !== "generate_ppt_sample_assets" &&
      input.definition.internalToolId !== "generate_ppt_full_assets") return null;
  const sourceArtifact = input.artifacts
    .filter((artifact) => artifact.kind === "ppt_design_draft" && isArtifactTrustedForDownstream(artifact))
    .at(-1);
  const packageValue = sourceArtifact?.structuredContent.pptDesignPackage;
  if (!sourceArtifact || !packageValue || typeof packageValue !== "object" || Array.isArray(packageValue)) return null;
  let requestBatch: ReturnType<typeof buildPptAssetRequestBatch>;
  try {
    requestBatch = buildPptAssetRequestBatch(
      packageValue as PptDesignPackage,
      input.definition.internalToolId === "generate_ppt_full_assets" ? "full_production" : "key_samples",
    );
  } catch {
    return null;
  }
  const jobs = await input.service.getGenerationJobs(input.projectId);
  const jobsByUnit = new Map<string, GenerationJobRecord>();
  for (const job of jobs) {
    if (job.kind !== "image" || job.sourceArtifactId !== sourceArtifact.id || job.intentEpoch !== input.taskBrief.intentEpoch || !job.unitId) continue;
    jobsByUnit.set(job.unitId, job);
  }
  const completed = new Map<string, PptGeneratedAsset>();
  for (const request of requestBatch.requests) {
    const result = readVerifiedPptAssetUnitResult(jobsByUnit.get(request.assetId), request, requestBatch.batchDigest);
    if (result) completed.set(request.assetId, result);
  }
  const activeJobIds = new Map<string, string>();
  const capabilityId = input.definition.capabilityId ?? "ppt_sample_assets";
  const lifecycle: PptAssetBatchLifecycle = {
    loadSucceededUnit: async (request) => completed.get(request.assetId) ?? null,
    onSubmissionStarted: async (request) => {
      const idempotencyKey = hashRunInput({
        taskId: input.taskBrief.taskId,
        capabilityId,
        batchDigest: requestBatch.batchDigest,
        assetId: request.assetId,
      });
      const queued = await input.service.createGenerationJob(input.projectId, {
        kind: "image",
        sourceArtifactId: sourceArtifact.id,
        unitId: request.assetId,
        capabilityId,
        idempotencyKey,
        sourceArtifactIds: [sourceArtifact.id],
        createStagedArtifactCommit: false,
        inputSnapshot: {
          taskId: input.taskBrief.taskId,
          taskBriefDigest: input.taskBrief.digest,
          intentEpoch: input.taskBrief.intentEpoch,
          batchDigest: requestBatch.batchDigest,
          request: structuredClone(request),
        },
      });
      if (queued.status === "succeeded") throw new Error("ppt_asset_unit_result_unverifiable");
      const active = await input.service.startGenerationJobForExecution(input.projectId, queued.id);
      if (active.job.status === "submission_unknown") throw new Error("submission_unknown");
      if (active.job.status !== "running") throw new Error(`ppt_asset_unit_not_runnable:${active.job.status}`);
      activeJobIds.set(request.assetId, active.job.id);
    },
    onSubmissionSucceeded: async (request, result) => {
      const jobId = activeJobIds.get(request.assetId);
      if (!jobId) throw new Error("ppt_asset_unit_job_missing");
      await input.service.completeGenerationUnit(input.projectId, jobId, {
        providerResultJson: JSON.stringify({
          schemaVersion: "ppt-asset-unit-result.v1",
          taskId: input.taskBrief.taskId,
          batchDigest: requestBatch.batchDigest,
          assetId: request.assetId,
          requestInputHash: request.inputHash,
          result: structuredClone(result),
        }),
      });
    },
    onSubmissionFailed: async (request, error) => {
      const jobId = activeJobIds.get(request.assetId);
      if (!jobId) return;
      await input.service.failGenerationJob(input.projectId, jobId, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    },
  };
  return {
    pendingUnitCount: requestBatch.requests.length - completed.size,
    authoritativeProviderCallsUsed: jobs
      .filter((job) => job.intentEpoch === input.taskBrief.intentEpoch && job.countsAsProviderSubmission !== false)
      .reduce((count, job) => count + job.attempts, 0),
    lifecycle,
  };
}

function readVerifiedPptAssetUnitResult(
  job: GenerationJobRecord | undefined,
  request: PptAssetRequest,
  batchDigest: string,
): PptGeneratedAsset | null {
  if (!job || job.status !== "succeeded" || !job.providerResultJson) return null;
  try {
    const value = JSON.parse(job.providerResultJson) as Record<string, unknown>;
    if (value.schemaVersion !== "ppt-asset-unit-result.v1" ||
        value.batchDigest !== batchDigest ||
        value.assetId !== request.assetId ||
        value.requestInputHash !== request.inputHash ||
        !isPptGeneratedAsset(value.result, request)) return null;
    return structuredClone(value.result);
  } catch {
    return null;
  }
}

function isPptGeneratedAsset(value: unknown, request: PptAssetRequest): value is PptGeneratedAsset {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return typeof result.provider === "string" && result.provider.length > 0 &&
    typeof result.model === "string" && result.model.length > 0 &&
    typeof result.clientRequestId === "string" && result.clientRequestId.length > 0 &&
    typeof result.fileName === "string" && result.fileName.length > 0 &&
    typeof result.storageRef === "string" && result.storageRef.length > 0 &&
    typeof result.sha256 === "string" && /^[a-f0-9]{64}$/i.test(result.sha256) &&
    typeof result.bytes === "number" && result.bytes > 0 &&
    typeof result.width === "number" && result.width > 0 &&
    typeof result.height === "number" && result.height > 0 &&
    typeof result.mime === "string" && result.mime.startsWith("image/") &&
    result.transparentBackgroundVerified === request.transparentBackground &&
    Array.isArray(result.sentReferenceAssetIds) &&
    isPptAssetFileEvidence(result.rawAsset) &&
    isPptAssetFileEvidence(result.normalizedAsset);
}

function isPptAssetFileEvidence(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const file = value as Record<string, unknown>;
  return typeof file.fileName === "string" && file.fileName.length > 0 &&
    typeof file.storageRef === "string" && file.storageRef.length > 0 &&
    typeof file.sha256 === "string" && /^[a-f0-9]{64}$/i.test(file.sha256) &&
    typeof file.bytes === "number" && file.bytes > 0 &&
    typeof file.width === "number" && file.width > 0 &&
    typeof file.height === "number" && file.height > 0 &&
    typeof file.mime === "string" && file.mime.startsWith("image/");
}

function generationJobKindFor(definition: ToolDefinition): GenerationJobRecord["kind"] {
  if (definition.producedArtifactKind === "pptx_artifact") return "pptx";
  if (definition.producedArtifactKind === "video_narration_generate") return "audio";
  if (definition.producedArtifactKind === "video_segment_generate") return "video";
  return "image";
}

function generationUnitId(argumentsValue: Record<string, unknown>) {
  for (const key of ["shotId", "unitId", "pageId"]) {
    const value = argumentsValue[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

async function persistBusinessSkillRuntimeFailure(input: {
  controlPlaneStore: ReturnType<typeof createControlPlaneStore>;
  invocationId: string;
  executionEnvelope: ReturnType<typeof createExecutionEnvelope>;
  triggerMessageId: string;
  toolName: string;
  reasonCode: string;
  nextAction: AgentObservation["minimalNextAction"];
}) {
  const observation = createAgentObservation({
    projectId: input.executionEnvelope.projectId,
    source: "validation",
    status: "failed",
    actionKey: input.toolName,
    inputHash: input.executionEnvelope.idempotencyKey,
    reasonCodes: [input.reasonCode],
    reportRefs: [],
    targetLocators: [{ kind: "tool", toolId: input.toolName }],
    responsibleStage: "business_skill_runtime",
    minimalNextAction: input.nextAction,
    teacherSafeSummary: "这一步的业务能力没有完成加载，系统已保存恢复信息且没有执行生成。",
  });
  const validationReport = createValidationReport({
    reportId: randomUUID(),
    createdAt: new Date().toISOString(),
    domain: "generic",
    stage: "business_skill_load",
    target: { kind: "tool_invocation", targetId: input.invocationId },
    contract: { id: "business-skill-runtime", version: "v1" },
    inputHash: input.executionEnvelope.idempotencyKey,
    intentEpoch: input.executionEnvelope.intentEpoch,
    overallStatus: "failed",
    gates: [{
      gateId: "business_skill_load",
      validatorId: "business_skill_runtime",
      validatorVersion: "v1",
      status: "failed",
      evidenceRefs: [],
      locators: [{ kind: "tool", toolId: input.toolName }],
      responsibleStage: "business_skill_runtime",
      reasonCode: input.reasonCode,
    }],
  });
  await input.controlPlaneStore.commitToolFailure({
    invocationId: input.invocationId,
    advancePlanRevision: false,
    validationReport,
    observation: {
      observationId: observation.observationId,
      status: observation.status,
      reasonCodes: observation.reasonCodes,
      payload: structuredClone(observation) as unknown as Record<string, unknown>,
    },
    event: {
      eventId: randomUUID(),
      projectId: input.executionEnvelope.projectId,
      taskId: input.executionEnvelope.taskId,
      runId: `turn:${input.triggerMessageId}`,
      intentEpoch: input.executionEnvelope.intentEpoch,
      kind: "tool_observed",
      visibility: "internal",
      occurredAt: new Date().toISOString(),
      payload: {
        observationId: observation.observationId,
        validationReportId: validationReport.reportId,
        status: "failed",
      },
    },
  });
  return { observation, validationReport };
}

async function persistBusinessSkillOutputFailure(input: {
  controlPlaneStore: ReturnType<typeof createControlPlaneStore>;
  invocationId: string;
  executionEnvelope: ReturnType<typeof createExecutionEnvelope>;
  triggerMessageId: string;
  toolName: string;
  businessSkillContext: BusinessToolSkillContext;
  error: unknown;
  generationJobId?: string;
}) {
  const reasonCode = input.error instanceof BusinessToolSkillOutputContractError
    ? input.error.reasonCode
    : "formal_skill_output_validation_failed";
  const validationErrors = input.error instanceof BusinessToolSkillOutputContractError
    ? sanitizeFormalSkillValidationErrors(input.error.validationErrors)
    : [];
  const formalContract = input.businessSkillContext.semanticSlice.contracts.skill?.produces[0];
  const observation = createAgentObservation({
    projectId: input.executionEnvelope.projectId,
    source: "validation",
    status: "failed",
    actionKey: input.toolName,
    inputHash: input.executionEnvelope.idempotencyKey,
    reasonCodes: [reasonCode],
    reportRefs: [],
    targetLocators: [{ kind: "tool", toolId: input.toolName }],
    responsibleStage: "business_skill_output",
    minimalNextAction: "repair_upstream",
    teacherSafeSummary: "生成结果没有通过当前业务交付合同，我没有保存这份结果，并已把具体问题交回智能体调整。",
  });
  const validationReport = createValidationReport({
    reportId: randomUUID(),
    createdAt: new Date().toISOString(),
    domain: "generic",
    stage: "business_skill_output",
    target: { kind: "tool_invocation", targetId: input.invocationId },
    contract: {
      id: formalContract?.artifactType ?? input.businessSkillContext.skillName,
      version: formalContract?.contractVersion ?? input.businessSkillContext.skillVersion,
    },
    inputHash: input.executionEnvelope.idempotencyKey,
    intentEpoch: input.executionEnvelope.intentEpoch,
    overallStatus: "failed",
    gates: [{
      gateId: "formal_skill_output_contract",
      validatorId: "business_skill_runtime",
      validatorVersion: "v2",
      status: "failed",
      evidenceRefs: [
        input.businessSkillContext.provenance.entrypointSha256,
        input.businessSkillContext.provenance.bindingPolicyDigest,
        ...input.businessSkillContext.provenance.references.map((reference) => reference.sha256),
      ],
      locators: [{ kind: "tool", toolId: input.toolName }],
      responsibleStage: "business_skill_output",
      reasonCode,
    }],
  });
  await input.controlPlaneStore.commitToolFailure({
    invocationId: input.invocationId,
    ...(input.generationJobId ? {
      generationJob: {
        jobId: input.generationJobId,
        status: "failed" as const,
        errorMessage: observation.teacherSafeSummary,
      },
    } : {}),
    validationReport,
    observation: {
      observationId: observation.observationId,
      status: observation.status,
      reasonCodes: observation.reasonCodes,
      payload: {
        ...structuredClone(observation),
        validationErrors,
        skillName: input.businessSkillContext.skillName,
        skillVersion: input.businessSkillContext.skillVersion,
        ...(formalContract ? { formalContract: structuredClone(formalContract) } : {}),
      } as unknown as Record<string, unknown>,
    },
    event: {
      eventId: randomUUID(),
      projectId: input.executionEnvelope.projectId,
      taskId: input.executionEnvelope.taskId,
      runId: `turn:${input.triggerMessageId}`,
      intentEpoch: input.executionEnvelope.intentEpoch,
      kind: "tool_observed",
      visibility: "internal",
      occurredAt: new Date().toISOString(),
      payload: {
        observationId: observation.observationId,
        validationReportId: validationReport.reportId,
        reasonCode,
        status: "failed",
      },
    },
  });
  return { observation, validationReport };
}

function sanitizeFormalSkillValidationErrors(errors: string[]) {
  return [...new Set(errors
    .map((error) => String(error).replace(/\s+/g, " ").trim())
    .filter((error) => error.length > 0 && error.length <= 200)
    .filter((error) => !/[A-Z]:\\|\/Users\/|https?:\/\/|api[_-]?key|token|secret|credential/i.test(error))
    .slice(0, 20))];
}

async function persistAgentToolObservation(input: {
  controlPlaneStore: ReturnType<typeof createControlPlaneStore>;
  invocationId: string;
  executionEnvelope: ReturnType<typeof createExecutionEnvelope> | undefined;
  triggerMessageId: string;
  observation: AgentObservation;
}) {
  if (!input.executionEnvelope) throw new Error("Agent Tool result requires an ExecutionEnvelope.");
  await input.controlPlaneStore.commitToolObservation({
    invocationId: input.invocationId,
    invocationStatus: input.observation.status === "succeeded"
      ? "succeeded"
      : input.observation.status === "blocked" || input.observation.status === "needs_input" ? "blocked" : "failed",
    observation: {
      observationId: input.observation.observationId,
      status: input.observation.status,
      reasonCodes: input.observation.reasonCodes,
      payload: structuredClone(input.observation) as unknown as Record<string, unknown>,
    },
    event: {
      eventId: randomUUID(),
      projectId: input.executionEnvelope.projectId,
      taskId: input.executionEnvelope.taskId,
      runId: `turn:${input.triggerMessageId}`,
      intentEpoch: input.executionEnvelope.intentEpoch,
      kind: "tool_observed",
      visibility: "internal",
      occurredAt: new Date().toISOString(),
      payload: {
        observationId: input.observation.observationId,
        status: input.observation.status,
      },
    },
  });
}

function mapCommittedArtifact(artifact: Artifact): ArtifactRecord {
  return {
    id: artifact.id,
    projectId: artifact.projectId,
    taskId: artifact.taskId,
    taskBriefDigest: artifact.taskBriefDigest,
    intentEpoch: artifact.intentEpoch,
    planRevision: artifact.planRevision,
    origin: artifact.origin as ArtifactRecord["origin"],
    nodeKey: artifact.nodeKey as ArtifactRecord["nodeKey"],
    title: artifact.title,
    kind: artifact.kind as ArtifactRecord["kind"],
    status: artifact.status as ArtifactRecord["status"],
    summary: artifact.summary,
    markdownContent: artifact.markdownContent,
    structuredContent: JSON.parse(artifact.structuredContentJson) as Record<string, unknown>,
    version: artifact.version,
    isApproved: artifact.isApproved,
    createdAt: artifact.createdAt.toISOString(),
    updatedAt: artifact.updatedAt.toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createDialogueCheckpointFromArguments(input: {
  argumentsValue: Record<string, unknown>;
  projectId: string;
  taskId: string;
  intentEpoch: number;
  planRevision: number;
  sourceMessageId: string;
}) {
  const options = Array.isArray(input.argumentsValue.options)
    ? input.argumentsValue.options.flatMap((value): DialogueCheckpointOption[] => {
        if (!isRecord(value) || typeof value.id !== "string" || typeof value.label !== "string" ||
            typeof value.description !== "string" || typeof value.recommended !== "boolean") return [];
        return [{ id: value.id, label: value.label, description: value.description, recommended: value.recommended }];
      })
    : [];
  return createDialogueCheckpoint({
    projectId: input.projectId,
    taskId: input.taskId,
    intentEpoch: input.intentEpoch,
    planRevision: input.planRevision,
    sourceMessageId: input.sourceMessageId,
    question: typeof input.argumentsValue.question === "string" ? input.argumentsValue.question : "",
    understandingSummary: typeof input.argumentsValue.understandingSummary === "string" ? input.argumentsValue.understandingSummary : "",
    impactSummary: typeof input.argumentsValue.impactSummary === "string" ? input.argumentsValue.impactSummary : "",
    options,
    allowFreeText: input.argumentsValue.allowFreeText === true,
  });
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
