import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { videoCourseAnchorHardGateIds } from "@/server/tools/video-course-anchor-gate";
import { videoFinalReviewHardGateIds } from "@/server/tools/video-final-review-gate";
import type { AgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import type { ArtifactRecord, SaveArtifactInput } from "@/server/workbench/types";
import { withArtifactQualityState } from "@/server/quality/artifact-quality-state";

export function adaptVideoAgentCriticReview(input: {
  projectId: string;
  intentEpoch: number;
  envelope: AgentToolInvocationEnvelope;
  artifact: ArtifactRecord;
  structuredOutput: Record<string, unknown>;
}): SaveArtifactInput {
  assertBinding(input);
  const stage = input.envelope.arguments.stage;
  if (stage !== "course_anchor" && stage !== "video_final_review") throw new Error("video_critic_stage_invalid");
  const recommendation = input.structuredOutput.recommendation;
  if (!isRecommendation(recommendation)) throw new Error("video_critic_recommendation_invalid");
  const hardGateResults = parseHardGates(input.structuredOutput.hardGateResults, stage);
  const findings = parseFindings(input.structuredOutput.findings, input.artifact, stage);
  if (recommendation === "pass" && findings.length > 0) throw new Error("video_critic_pass_has_findings");
  if ((recommendation === "rework_required" || recommendation === "blocked") && findings.length === 0) throw new Error("video_critic_repair_missing_findings");

  const review = {
    schemaVersion: stage === "course_anchor" ? "video-course-anchor-review.v1" : "video-final-review.v1",
    targetArtifactId: input.artifact.id,
    targetVersion: input.artifact.version,
    targetDigest: input.envelope.reviewTargetRef!.digest,
    intentEpoch: input.intentEpoch,
    recommendation,
    overallStatus: recommendation === "pass" ? "passed" : recommendation,
    rubricRef: structuredClone(input.envelope.arguments.rubricRef),
    generatorInvocationId: input.envelope.arguments.generatorInvocationId,
    criticInvocationId: input.envelope.invocationId,
    reviewerMessageId: input.envelope.sourceMessageId,
    hardGateResults,
    findings,
    evidenceDigest: hashRunInput({ hardGateResults, findings }),
    reviewedAt: new Date().toISOString(),
  };

  if (stage === "video_final_review") assertFinalEvidence(input.artifact);
  const passed = recommendation === "pass";
  return {
    nodeKey: input.artifact.nodeKey,
    kind: input.artifact.kind,
    title: stage === "course_anchor"
      ? passed ? "视频创意与课程锚点已通过内审" : "视频创意与课程锚点待返修"
      : passed ? "完整导入视频已通过内审" : "完整导入视频待局部返修",
    status: "needs_review",
    summary: passed ? "独立审查已通过，可继续内部下游；教师签收仍单独记录。" : "独立审查发现未关闭问题，尚不能进入下一步。",
    markdownContent: passed ? "# 视频审查通过\n\n独立审查证据已形成，可以继续内部制作；教师签收仍是独立状态。" : "# 视频需要返修\n\n请按定位结果执行最小范围返修后重新审查。",
    structuredContent: withArtifactQualityState({
      ...input.artifact.structuredContent,
      [stage === "course_anchor" ? "videoCourseAnchorReview" : "videoFinalReview"]: review,
    }, {
      validationStatus: "not_required",
      reviewStatus: passed ? "passed" : recommendation === "blocked" ? "blocked" : recommendation === "inconclusive" ? "inconclusive" : "repair",
      downstreamEligibility: passed ? "eligible" : "blocked",
    }),
  };
}

function assertBinding(input: Parameters<typeof adaptVideoAgentCriticReview>[0]) {
  if (input.envelope.toolId !== "delivery_critic.review" || input.envelope.arguments.domain !== "video") throw new Error("video_critic_tool_binding_invalid");
  if (input.envelope.projectId !== input.projectId || input.envelope.intentEpoch !== input.intentEpoch) throw new Error("video_critic_project_binding_invalid");
  const target = input.envelope.reviewTargetRef;
  if (!target || target.artifactId !== input.artifact.id || target.version !== input.artifact.version || target.kind !== input.artifact.kind) throw new Error("video_critic_artifact_binding_invalid");
  const digest = hashArtifactDraft({
    nodeKey: input.artifact.nodeKey, kind: input.artifact.kind, title: input.artifact.title,
    summary: input.artifact.summary, markdownContent: input.artifact.markdownContent,
    structuredContent: input.artifact.structuredContent,
  });
  if (target.digest !== digest) throw new Error("video_critic_digest_binding_invalid");
}

function parseHardGates(value: unknown, stage: "course_anchor" | "video_final_review") {
  if (!Array.isArray(value)) throw new Error("video_critic_hard_gates_invalid");
  const expected = new Set(stage === "course_anchor" ? videoCourseAnchorHardGateIds : videoFinalReviewHardGateIds);
  const ids = value.map((gate) => isRecord(gate) && typeof gate.gateId === "string" ? gate.gateId : "");
  if (ids.length !== expected.size || ids.some((id) => !expected.has(id as never)) || new Set(ids).size !== ids.length) throw new Error("video_critic_hard_gates_incomplete");
  return structuredClone(value);
}

function parseFindings(value: unknown, artifact: ArtifactRecord, stage: "course_anchor" | "video_final_review") {
  if (!Array.isArray(value)) throw new Error("video_critic_findings_invalid");
  return value.map((finding) => {
    if (!isRecord(finding) || !isRecord(finding.locator) || !isRecordLocatorForArtifact(finding.locator, artifact, stage)) throw new Error("video_critic_finding_locator_invalid");
    if (typeof finding.minimalFix !== "string" || !finding.minimalFix.trim()) throw new Error("video_critic_finding_invalid");
    return structuredClone(finding);
  });
}

function assertFinalEvidence(artifact: ArtifactRecord) {
  const evidence = artifact.structuredContent.videoFinalReviewEvidence;
  if (!isRecord(evidence) || !isRecord(evidence.storyboard) || !isRecord(evidence.finalVideo) || !isRecord(evidence.timeline) || !Array.isArray(evidence.sampledFrames) || evidence.sampledFrames.length === 0 || !isRecord(evidence.transcript) || !isRecord(evidence.audioTrack)) {
    throw new Error("video_final_review_evidence_incomplete");
  }
  const shotIds = Array.isArray(evidence.timeline.shotIds) ? evidence.timeline.shotIds : [];
  if (!shotIds.length || shotIds.some((shotId) => typeof shotId !== "string" || !/^shot_[a-z0-9_-]+$/i.test(shotId))) throw new Error("video_final_review_timeline_invalid");
  const storyboardShotIds = Array.isArray(evidence.storyboard.shotIds) ? evidence.storyboard.shotIds : [];
  const targetDuration = isRecord(evidence.storyboard.targetDurationRange) ? evidence.storyboard.targetDurationRange : null;
  if (storyboardShotIds.length !== shotIds.length || storyboardShotIds.some((shotId, index) => shotId !== shotIds[index]) ||
      typeof evidence.storyboard.manifestDigest !== "string" || !/^[a-f0-9]{64}$/i.test(evidence.storyboard.manifestDigest) ||
      !targetDuration || typeof targetDuration.minSeconds !== "number" || typeof targetDuration.maxSeconds !== "number" ||
      typeof evidence.finalVideo.durationMs !== "number" || evidence.finalVideo.durationMs < targetDuration.minSeconds * 1000 - Math.max(1000, shotIds.length * 250) ||
      evidence.finalVideo.durationMs > targetDuration.maxSeconds * 1000 + Math.max(1000, shotIds.length * 250)) {
    throw new Error("video_final_review_storyboard_binding_invalid");
  }
  for (const value of [evidence.finalVideo.sha256, evidence.transcript.sha256, evidence.audioTrack.sha256]) {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) throw new Error("video_final_review_evidence_digest_invalid");
  }
}

function isRecordLocatorForArtifact(locator: Record<string, unknown>, artifact: ArtifactRecord, stage: "course_anchor" | "video_final_review") {
  if (stage === "course_anchor") return locator.kind === "artifact" && locator.artifactId === artifact.id;
  if (locator.parentArtifactId !== artifact.id) return false;
  const evidence = artifact.structuredContent.videoFinalReviewEvidence;
  if (!isRecord(evidence) || !isRecord(evidence.timeline)) return false;
  const shotIds = new Set(Array.isArray(evidence.timeline.shotIds) ? evidence.timeline.shotIds.filter((value): value is string => typeof value === "string") : []);
  if (locator.kind === "shot") return typeof locator.shotId === "string" && shotIds.has(locator.shotId);
  if (locator.kind === "frame_range") return typeof locator.parentShotId === "string" && shotIds.has(locator.parentShotId) && isTimeRange(locator.timeRangeMs);
  if (locator.kind === "timeline") return locator.timelineId === evidence.timeline.timelineId && isTimeRange(locator.timeRangeMs);
  if (locator.kind === "track") {
    const trackIds = new Set([isRecord(evidence.transcript) ? evidence.transcript.trackId : null, isRecord(evidence.audioTrack) ? evidence.audioTrack.trackId : null].filter((value): value is string => typeof value === "string"));
    return typeof locator.trackId === "string" && trackIds.has(locator.trackId) && (!locator.timeRangeMs || isTimeRange(locator.timeRangeMs));
  }
  return false;
}

function isTimeRange(value: unknown) {
  return isRecord(value) && typeof value.start === "number" && typeof value.end === "number" && value.start >= 0 && value.end > value.start;
}

function isRecommendation(value: unknown): value is "pass" | "rework_required" | "blocked" | "inconclusive" {
  return value === "pass" || value === "rework_required" || value === "blocked" || value === "inconclusive";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
