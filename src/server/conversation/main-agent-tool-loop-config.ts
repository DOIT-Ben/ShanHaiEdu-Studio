import { randomUUID } from "node:crypto";

import type { AgentRuntime } from "@/server/agent-runtime/types";
import {
  appendAgentObservationMetadata,
  appendRunCheckpointMetadata,
  createAgentObservation,
  createRunCheckpoint,
  readAgentObservationsFromMetadata,
  type AgentObservation,
} from "@/server/conversation/react-control";
import { actionRiskForTool, evaluateActionPolicy } from "@/server/guards/action-policy";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { adaptPptAgentCriticReview } from "@/server/ppt-quality/ppt-agent-critic-review-adapter";
import { adaptVideoAgentCriticReview } from "@/server/video-quality/video-agent-critic-review-adapter";
import { appendAgentToolReportMetadata, createPersistedAgentToolReport } from "@/server/tools/agent-tool-report";
import type { AgentToolArtifactRef, AgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import { listMainAgentToolDefinitions } from "@/server/tools/main-agent-tool-registry";
import { routeToolCall } from "@/server/tools/tool-router";
import type { AgentToolRouterResult } from "@/server/tools/agent-tool-router";
import type { AgentToolPolicyOutcome } from "@/server/tools/agent-tool-types";
import type { AgentToolExecutor } from "@/server/tools/agent-tool-types";
import type { PptDirectorPlanBinding } from "@/server/ppt-quality/ppt-director-design-adapter";
import { dispatchMainAgentToolCall } from "@/server/tools/main-agent-tool-dispatcher";
import { toolDefinitionToOpenAiFunctionTool } from "@/server/tools/openai-tool-schema";
import type { ToolRouterInput } from "@/server/tools/tool-router";
import type { ToolExecutionResult } from "@/server/tools/tool-types";
import type { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactRecord, ConversationMessageRecord, ExecutionIdentitySnapshot, ProjectExecutionFence, ProjectRecord } from "@/server/workbench/types";
import type { MainConversationAgentInput } from "./main-conversation-agent";
import type { MainAgentReActContextTelemetry, MainAgentReActDispatchResult } from "./main-agent-controlled-react-loop";
import { createMainAgentRoundBudgetPause } from "./main-agent-run-pause";
import { createExecutionEnvelope, type IntentGrant, type TaskBrief } from "./task-contract";

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
};

export function createMainAgentToolLoopOptions(
  input: CreateMainAgentToolLoopOptionsInput,
): MainConversationAgentInput["agentToolLoop"] | undefined {
  if (!input.identity || !input.fence || !input.executor) return undefined;
  const qualifiedDefinitions = () => {
    const approvedArtifactKinds = new Set(input.artifacts.filter(isArtifactTrustedForDownstream).map((artifact) => artifact.kind));
    const presentArtifactKinds = new Set(input.artifacts.map((artifact) => artifact.kind));
    return listMainAgentToolDefinitions().filter((tool) =>
      tool.mainAgentExecutable && isCurrentlyQualifiedMainAgentTool(tool, approvedArtifactKinds, presentArtifactKinds, input.taskBrief) && (
        tool.internalToolId !== "create_ppt_design_draft" || Boolean(input.runtime)
      ),
    );
  };
  let definitions = qualifiedDefinitions();
  if (definitions.length === 0) return undefined;
  let currentMetadata = structuredClone(input.triggerMessage.metadata);
  let externalProviderCallsUsed = input.externalProviderCallsUsed ?? 0;
  let currentPlanRevision = input.planRevision ?? 0;
  let latestPptDirectorPlan: PptDirectorPlanBinding | undefined;
  const actionFailureCounts = actionFailureCountsFromMetadata(currentMetadata);
  let toolExposureSequence = readMainAgentToolExposureTrace(currentMetadata).length;

  return {
    tools: definitions.map(toolDefinitionToOpenAiFunctionTool),
    allowedToolNames: definitions.map((tool) => tool.transportName),
    refreshTools: async () => {
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
    },
    maxToolRounds: 8,
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
      const requestedActionKey = requestedDefinition.internalToolId ?? requestedDefinition.id;
      if ((actionFailureCounts.get(requestedActionKey) ?? 0) >= 2) {
        const checkpoint = createRepeatedFailureCheckpoint(
          input.project.id,
          input.project.intentEpoch ?? 0,
          requestedActionKey,
          currentMetadata,
        );
        currentMetadata = appendRunCheckpointMetadata(currentMetadata, checkpoint);
        await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
        return {
          status: "blocked",
          observation: compactContinuationObservation("blocked", ["repeated_tool_failure", "retry_budget_exhausted"], {
            nextAction: "pause",
            summary: `recovery:${requestedActionKey}:${checkpoint.checkpointId}`,
          }),
        };
      }
      const currentProject = await input.service.getProject(input.project.id);
      if ((currentProject.intentEpoch ?? 0) !== (input.project.intentEpoch ?? 0)) {
        return {
          status: "inconclusive",
          observation: compactContinuationObservation("inconclusive", ["intent_changed"], { nextAction: "replan" }),
        };
      }
      await input.service.renewProjectExecutionLease({ ...input.fence!, leaseMs: 10 * 60 * 1000 });
      if (typeof requestedDefinition.internalToolId === "string") {
        const actionRisk = actionRiskForTool(requestedDefinition);
        const policy = evaluateActionPolicy({
          risk: actionRisk,
          intentGrant: input.intentGrant,
          externalProviderCallsUsed,
          expectedScope: {
            projectId: input.project.id,
            intentEpoch: input.project.intentEpoch ?? 0,
            intensity: input.project.generationIntensity ?? "standard",
          },
        });
        if (policy.kind === "human_gate") {
          return { status: "blocked", observation: compactContinuationObservation("blocked", [policy.reason], { nextAction: "ask_teacher" }) };
        }
      }
      const reviewTargetRef = resolveReviewTarget(call.arguments, input.artifacts);
      const executionEnvelope = input.taskBrief && input.intentGrant
        ? createExecutionEnvelope({
            actorUserId: input.identity!.actorUserId,
            taskBrief: input.taskBrief,
            planRevision: currentPlanRevision,
            intensity: input.project.generationIntensity ?? "standard",
            intentGrant: input.intentGrant,
            action: { toolName: requestedDefinition.internalToolId ?? requestedDefinition.id, arguments: call.arguments },
          })
        : undefined;
      currentPlanRevision += 1;
      const dispatch = await dispatchMainAgentToolCall({
        invocationId: randomUUID(),
        toolName: call.toolName,
        arguments: call.arguments,
        serverContext: {
          identity: input.identity!,
          projectId: input.project.id,
          intentEpoch: input.project.intentEpoch ?? 0,
          sourceMessageId: input.triggerMessage.id,
          generationIntensity: input.project.generationIntensity,
          approvedArtifactRefs: input.artifacts.filter(isArtifactTrustedForDownstream).map(toArtifactRef),
          reviewTargetRef,
          executionEnvelope,
        },
      }, { agentToolExecutor: input.executor, businessToolRouter: input.businessToolRouter ?? routeToolCall, allowBusinessExecution: true, buildBusinessToolInput: (request, internalToolId) => ({
        toolName: internalToolId,
        projectId: input.project.id,
        project: input.project,
        runtime: input.runtime,
        projectContext: toRuntimeProjectContext(input.project, input.taskBrief),
        approvedArtifacts: input.artifacts.filter(isArtifactTrustedForDownstream).map(toApprovedRuntimeArtifact),
        userInstruction: input.triggerMessage.content,
        toolInput: {
          ...structuredClone(request.arguments),
          taskBrief: structuredClone(input.taskBrief ?? null),
          intentGrant: structuredClone(input.intentGrant ?? null),
          generationIntensity: input.project.generationIntensity ?? "standard",
          intentEpoch: input.project.intentEpoch ?? 0,
        },
        artifactRefs: input.artifacts.map((artifact) => ({ kind: artifact.kind, artifactId: artifact.id, title: artifact.title, summary: artifact.summary })),
        resolvedArtifacts: input.artifacts,
        sourceMessageId: input.triggerMessage.id,
        executionIntentEpoch: input.project.intentEpoch ?? 0,
        executionEnvelope,
        executionInputHash: executionEnvelope?.idempotencyKey ?? hashRunInput({ projectId: input.project.id, toolName: internalToolId, arguments: request.arguments, intentEpoch: input.project.intentEpoch ?? 0 }),
        pptDirectorPlan: internalToolId === "create_ppt_design_draft" ? latestPptDirectorPlan : undefined,
      }) });
      if (typeof requestedDefinition.internalToolId === "string" &&
          actionRiskForTool(requestedDefinition) === "external_generation") {
        externalProviderCallsUsed += 1;
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
            digest: ref.digest,
          })),
        };
      }

      if (dispatch.kind === "blocked") {
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
            ...safeFailureDetails(dispatch.result.observation.internalReasonSanitized),
            ...validationFailureDetails(dispatch.result.validationReport),
          ])];
          const reasonCodes = [...new Set([primaryReason, ...failureDetails])];
          const observation = createAgentObservation({
            projectId: input.project.id, source: "tool", status: dispatch.result.status === "needs_input" ? "inconclusive" : "failed",
            actionKey: dispatch.result.toolId, inputHash: hashRunInput({ toolId: dispatch.result.toolId, call: call.arguments }),
            reasonCodes, reportRefs: [], targetLocators: [],
            responsibleStage: dispatch.result.capabilityId, minimalNextAction: "repair_upstream",
            teacherSafeSummary: dispatch.result.status === "needs_input" ? dispatch.result.assistantPrompt : dispatch.result.observation.teacherSafeSummary,
          });
          currentMetadata = appendAgentObservationMetadata(currentMetadata, observation);
          recordActionOutcome(actionFailureCounts, requestedActionKey, observation.status);
          currentMetadata = appendRepeatedFailureCheckpointIfNeeded({
            metadata: currentMetadata,
            counts: actionFailureCounts,
            projectId: input.project.id,
            intentEpoch: input.project.intentEpoch ?? 0,
            actionKey: requestedActionKey,
          });
          await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
          return {
            status: observationStatusForModel(observation),
            observation: observationForContinuation(observation, {
              reportRefs: dispatch.result.validationReport ? [{
                id: dispatch.result.validationReport.reportId,
                kind: "validation",
                digest: dispatch.result.validationReport.reportDigest,
              }] : [],
              nextAction: "replan",
              reasonCodes,
              summary: dispatch.result.status === "needs_input"
                ? `${observation.teacherSafeSummary} missing:${dispatch.result.missingInputs.join(",")}`
                : observation.teacherSafeSummary,
            }),
          };
        }
        const artifact = await input.service.saveArtifact(input.project.id, {
          nodeKey: dispatch.result.artifactDraft.nodeKey as ArtifactRecord["nodeKey"], kind: dispatch.result.artifactDraft.kind as ArtifactRecord["kind"],
          title: dispatch.result.artifactDraft.title, status: "needs_review", summary: dispatch.result.artifactDraft.summary,
          markdownContent: dispatch.result.artifactDraft.markdownContent ?? "", structuredContent: dispatch.result.artifactDraft.structuredContent,
        });
        input.artifacts.push(artifact);
        const observation = createAgentObservation({
          projectId: input.project.id, source: "tool", status: "succeeded", actionKey: dispatch.result.toolId,
          inputHash: hashRunInput({ toolId: dispatch.result.toolId, artifactId: artifact.id }), reasonCodes: ["business_tool_succeeded"], reportRefs: [],
          targetLocators: [{ kind: "artifact", artifactKind: artifact.kind, artifactId: artifact.id }], responsibleStage: dispatch.result.capabilityId,
          minimalNextAction: "continue", teacherSafeSummary: dispatch.result.assistantSummary,
        });
        currentMetadata = appendAgentObservationMetadata(currentMetadata, observation);
        await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
        recordActionOutcome(actionFailureCounts, requestedActionKey, observation.status);
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
          reviewArtifact = adapted.kind === "sample"
            ? await input.service.submitPptSampleReview(input.project.id, target.id, adapted.submission)
            : await input.service.submitPptFullDeckReview(input.project.id, target.id, adapted.submission);
          input.artifacts.push(reviewArtifact);
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
          reviewArtifact = await input.service.saveArtifact(input.project.id, submission);
          input.artifacts.push(reviewArtifact);
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
          await input.service.updateMessageMetadata(input.project.id, input.triggerMessage.id, currentMetadata);
          return {
            status: "inconclusive",
            observation: observationForContinuation(observation, { nextAction: "repair_upstream" }),
          };
        }
      }
      const observation = observationFromReport(dispatch.envelope, dispatch.result, report);
      currentMetadata = appendAgentObservationMetadata(
        appendAgentToolReportMetadata(currentMetadata, report),
        observation,
      );
      recordActionOutcome(actionFailureCounts, requestedActionKey, observation.status);
      currentMetadata = appendRepeatedFailureCheckpointIfNeeded({
        metadata: currentMetadata,
        counts: actionFailureCounts,
        projectId: input.project.id,
        intentEpoch: input.project.intentEpoch ?? 0,
        actionKey: requestedActionKey,
      });
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
  rejectionReason?: "repeated_tool_call" | "tool_round_limit_reached";
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
    (value.rejectionReason === undefined || value.rejectionReason === "repeated_tool_call" || value.rejectionReason === "tool_round_limit_reached");
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
  if (typeof tool.internalToolId === "string") {
    if (!isBusinessToolInTaskScope(tool.id, taskBrief)) return false;
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
    return trustedKinds.has("ppt_draft") || trustedKinds.has("ppt_design_draft") || trustedKinds.has("pptx_artifact");
  }
  if (tool.id === "video_director.plan_or_repair") {
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

function isBusinessToolInTaskScope(toolId: string, taskBrief?: TaskBrief) {
  if (!taskBrief) return true;
  const outputs = new Set(taskBrief.requestedOutputs);
  if (toolId === "create_requirement_spec") return true;
  if (toolId === "create_lesson_plan") return outputs.has("lesson_plan") || outputs.has("package");
  if (toolId === "create_ppt_outline" || toolId.startsWith("create_ppt_") ||
      toolId.startsWith("generate_ppt_") || toolId.startsWith("assemble_ppt_") || toolId.startsWith("repair_ppt_")) {
    return outputs.has("ppt") || outputs.has("package");
  }
  if (["create_video_course_anchor", "generate_intro_creative_themes", "generate_intro_video_script"].includes(toolId)) {
    return outputs.has("video_script") || outputs.has("video") || outputs.has("package");
  }
  if (["generate_video_storyboard", "generate_video_asset_brief", "plan_video_segments", "generate_video_assets", "generate_video_shot", "assemble_video"].includes(toolId)) {
    return outputs.has("video") || outputs.has("package");
  }
  if (toolId === "create_final_package") return outputs.has("package");
  return true;
}

function toRuntimeProjectContext(project: ProjectRecord, taskBrief?: TaskBrief) {
  return {
    grade: project.grade ?? "五年级",
    subject: project.subject ?? "数学",
    topic: project.lessonTopic ?? project.title,
    textbookVersion: project.textbookVersion ?? undefined,
    teacherGoal: taskBrief?.goal ?? project.title,
    requestedOutputs: taskBrief?.requestedOutputs ?? [],
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
      : successful ? [`agent_tool_${status}`] : [...new Set([result.errorCategory ?? result.observation.kind, ...failureDetails])],
    reportRefs: envelope.toolId === "delivery_critic.review"
      ? [{ kind: "critic", id: report.reportId, digest: report.reportDigest }]
      : [],
    targetLocators,
    responsibleStage,
    minimalNextAction: status === "succeeded"
      ? "continue"
      : status === "repair" ? (targetLocators.length ? "repair_unit" : "repair_upstream")
        : status === "needs_input" || status === "blocked" ? "ask_teacher" : "repair_upstream",
    teacherSafeSummary: report.assistantSummary,
  });
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

function actionFailureCountsFromMetadata(metadata: Record<string, unknown>): Map<string, number> {
  const counts = new Map<string, number>();
  const observations = Array.isArray(metadata.agentObservations) ? metadata.agentObservations : [];
  for (const value of observations) {
    if (!isRecord(value) || typeof value.actionKey !== "string") continue;
    if (value.status !== "failed" && value.status !== "inconclusive") continue;
    counts.set(value.actionKey, (counts.get(value.actionKey) ?? 0) + 1);
  }
  return counts;
}

function recordActionOutcome(
  counts: Map<string, number>,
  actionKey: string,
  status: AgentObservation["status"],
): void {
  if (status === "failed" || status === "inconclusive") {
    counts.set(actionKey, (counts.get(actionKey) ?? 0) + 1);
  } else if (status === "succeeded") {
    counts.delete(actionKey);
  }
}

function appendRepeatedFailureCheckpointIfNeeded(input: {
  metadata: Record<string, unknown>;
  counts: Map<string, number>;
  projectId: string;
  intentEpoch: number;
  actionKey: string;
}) {
  if ((input.counts.get(input.actionKey) ?? 0) < 2) return input.metadata;
  return appendRunCheckpointMetadata(
    input.metadata,
    createRepeatedFailureCheckpoint(input.projectId, input.intentEpoch, input.actionKey, input.metadata),
  );
}

function createRepeatedFailureCheckpoint(
  projectId: string,
  intentEpoch: number,
  actionKey: string,
  metadata: Record<string, unknown>,
) {
  const observations = readAgentObservationsFromMetadata(metadata);
  const latest = [...observations].reverse().find((observation) => observation.actionKey === actionKey);
  return createRunCheckpoint({
    projectId,
    planVersion: intentEpoch,
    reason: "repeated_failure",
    actionKey,
    inputHash: latest?.inputHash,
    observationRefs: observations
      .filter((observation) => observation.actionKey === actionKey)
      .map((observation) => observation.observationId),
  });
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

function isApprovedArtifact(artifact: ArtifactRecord) {
  return artifact.status === "approved" && artifact.isApproved;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
