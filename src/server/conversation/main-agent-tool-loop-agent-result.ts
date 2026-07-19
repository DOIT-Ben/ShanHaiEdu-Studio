import { randomUUID } from "node:crypto";

import type { Artifact } from "@/generated/prisma/client";
import { adaptPptAgentCriticReview } from "@/server/ppt-quality/ppt-agent-critic-review-adapter";
import { buildPptFullDeckReviewArtifact, buildPptSampleReviewArtifact } from "@/server/ppt-quality/ppt-review-artifact";
import { appendAgentToolReportMetadata, createPersistedAgentToolReport } from "@/server/tools/agent-tool-report";
import type { MainAgentToolDispatchResult } from "@/server/tools/main-agent-tool-dispatcher";
import { adaptVideoAgentCriticReview } from "@/server/video-quality/video-agent-critic-review-adapter";
import type { ArtifactRecord, SaveArtifactInput } from "@/server/workbench/types";

import type { MainAgentReActDispatchResult } from "./main-agent-controlled-react-loop";
import type { MainAgentToolLoopContext } from "./main-agent-tool-loop-types";
import {
  compactContinuationObservation,
  mapCommittedArtifact,
  nextToolIntentsFromStructuredOutput,
  observationForContinuation,
  observationFromReport,
  observationStatusForModel,
  persistAgentToolObservation,
} from "./main-agent-tool-loop-observations";
import { appendAgentObservationMetadata, createAgentObservation } from "./react-control";
import type { ExecutionEnvelope } from "./task-contract";

type AgentDispatch = Extract<MainAgentToolDispatchResult, { kind: "agent_tool" }>;

export async function handleAgentToolResult(input: {
  context: MainAgentToolLoopContext;
  executionEnvelope: ExecutionEnvelope | undefined;
  invocationId: string;
  dispatch: AgentDispatch;
}): Promise<MainAgentReActDispatchResult> {
  const { context, executionEnvelope, invocationId, dispatch } = input;
  const { input: loopInput, state, controlPlaneStore } = context;
  const latestProject = await loopInput.service.getProject(loopInput.project.id);
  if ((latestProject.intentEpoch ?? 0) !== (loopInput.project.intentEpoch ?? 0)) {
    return {
      status: "inconclusive",
      observation: compactContinuationObservation("inconclusive", ["stale_result"], { nextAction: "replan" }),
    };
  }
  await loopInput.service.renewProjectExecutionLease({ ...loopInput.fence!, leaseMs: 10 * 60 * 1000 });
  const report = createPersistedAgentToolReport(dispatch.envelope, dispatch.result);
  const review = await prepareReviewArtifactInput(context, dispatch, report, executionEnvelope, invocationId);
  if (review.kind === "handled") return review.result;
  const observation = observationFromReport(dispatch.envelope, dispatch.result, report);
  let reviewArtifact: ArtifactRecord | undefined;
  if (review.artifactInput) {
    if (!executionEnvelope) throw new Error("Agent Tool review result requires an ExecutionEnvelope.");
    const committed = await controlPlaneStore.commitToolResult({
      invocationId,
      artifact: review.artifactInput,
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
        runId: `turn:${loopInput.triggerMessage.id}`,
        intentEpoch: executionEnvelope.intentEpoch,
        kind: "artifact_committed",
        visibility: "internal",
        occurredAt: new Date().toISOString(),
        payload: {
          observationId: observation.observationId,
          status: observation.status,
          toolName: dispatch.envelope.toolId,
        },
      },
    });
    reviewArtifact = mapCommittedArtifact(committed.artifact as Artifact);
    loopInput.artifacts.push(reviewArtifact);
  } else {
    await persistAgentToolObservation({
      controlPlaneStore,
      invocationId,
      executionEnvelope,
      triggerMessageId: loopInput.triggerMessage.id,
      observation,
    });
  }
  state.currentMetadata = appendAgentObservationMetadata(
    appendAgentToolReportMetadata(state.currentMetadata, report),
    observation,
  );
  await persistMessageMetadata(context);
  return {
    status: observationStatusForModel(observation),
    observation: observationForContinuation(observation, {
      ...(reviewArtifact ? {
        artifactRefs: [{
          artifactId: reviewArtifact.id,
          kind: reviewArtifact.kind,
          version: reviewArtifact.version,
        }],
      } : {}),
      advisoryNextToolIntents: nextToolIntentsFromStructuredOutput(
        dispatch.result.status === "succeeded" ? dispatch.result.structuredOutput : null,
      ),
    }),
  };
}

async function prepareReviewArtifactInput(
  context: MainAgentToolLoopContext,
  dispatch: AgentDispatch,
  report: ReturnType<typeof createPersistedAgentToolReport>,
  executionEnvelope: ExecutionEnvelope | undefined,
  invocationId: string,
): Promise<
  | { kind: "ready"; artifactInput: SaveArtifactInput | undefined }
  | { kind: "handled"; result: MainAgentReActDispatchResult }
> {
  if (dispatch.result.status !== "succeeded" || dispatch.envelope.toolId !== "delivery_critic.review") {
    return { kind: "ready", artifactInput: undefined };
  }
  const domain = dispatch.envelope.arguments.domain;
  if (domain !== "ppt" && domain !== "video") return { kind: "ready", artifactInput: undefined };
  const target = dispatch.envelope.reviewTargetRef
    ? context.input.artifacts.find((artifact) => artifact.id === dispatch.envelope.reviewTargetRef?.artifactId)
    : undefined;
  try {
    if (!target) throw new Error(`${domain}_critic_target_missing`);
    if (domain === "ppt") {
      const adapted = adaptPptAgentCriticReview({
        projectId: context.input.project.id,
        intentEpoch: context.input.project.intentEpoch ?? 0,
        envelope: dispatch.envelope,
        artifact: target,
        structuredOutput: dispatch.result.structuredOutput,
      });
      return {
        kind: "ready",
        artifactInput: adapted.kind === "sample"
          ? buildPptSampleReviewArtifact(target, adapted.submission)
          : buildPptFullDeckReviewArtifact(target, adapted.submission),
      };
    }
    return {
      kind: "ready",
      artifactInput: adaptVideoAgentCriticReview({
        projectId: context.input.project.id,
        intentEpoch: context.input.project.intentEpoch ?? 0,
        envelope: dispatch.envelope,
        artifact: target,
        structuredOutput: dispatch.result.structuredOutput,
      }),
    };
  } catch {
    return {
      kind: "handled",
      result: await persistReviewAdaptationFailure({
        context,
        dispatch,
        report,
        executionEnvelope,
        invocationId,
        domain,
      }),
    };
  }
}

async function persistReviewAdaptationFailure(input: {
  context: MainAgentToolLoopContext;
  dispatch: AgentDispatch;
  report: ReturnType<typeof createPersistedAgentToolReport>;
  executionEnvelope: ExecutionEnvelope | undefined;
  invocationId: string;
  domain: "ppt" | "video";
}): Promise<MainAgentReActDispatchResult> {
  const { context, dispatch, report, executionEnvelope, invocationId, domain } = input;
  const { input: loopInput, state, controlPlaneStore } = context;
  const observation = createAgentObservation({
    projectId: loopInput.project.id,
    source: "quality",
    status: "inconclusive",
    actionKey: dispatch.envelope.toolId,
    inputHash: dispatch.envelope.inputHash,
    reasonCodes: [`${domain}_critic_review_persistence_failed`],
    reportRefs: [{ kind: "critic", id: report.reportId, digest: report.reportDigest }],
    targetLocators: [],
    responsibleStage: String(dispatch.envelope.arguments.stage ?? `${domain}_review`),
    minimalNextAction: "repair_upstream",
    teacherSafeSummary: domain === "ppt"
      ? "课件审查证据不完整，暂时不能进入下一步。"
      : "视频审查证据不完整，暂时不能进入下一步。",
  });
  state.currentMetadata = appendAgentObservationMetadata(
    appendAgentToolReportMetadata(state.currentMetadata, report),
    observation,
  );
  await persistAgentToolObservation({
    controlPlaneStore,
    invocationId,
    executionEnvelope,
    triggerMessageId: loopInput.triggerMessage.id,
    observation,
  });
  await persistMessageMetadata(context);
  return {
    status: "inconclusive",
    observation: observationForContinuation(observation, { nextAction: "repair_upstream" }),
  };
}

async function persistMessageMetadata(context: MainAgentToolLoopContext) {
  await context.input.service.updateMessageMetadata(
    context.input.project.id,
    context.input.triggerMessage.id,
    context.state.currentMetadata,
  );
}
