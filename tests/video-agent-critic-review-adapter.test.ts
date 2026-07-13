import { describe, expect, it } from "vitest";
import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import { createAgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import { videoCourseAnchorHardGateIds } from "@/server/tools/video-course-anchor-gate";
import { videoFinalReviewHardGateIds } from "@/server/tools/video-final-review-gate";
import { enforceVideoFinalReviewGate } from "@/server/tools/video-final-review-gate";
import { adaptVideoAgentCriticReview } from "@/server/video-quality/video-agent-critic-review-adapter";
import { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactRecord } from "@/server/workbench/types";

describe("V1-7 video Agent Critic review adapter", () => {
  it("persists a six-gate course-anchor pass without granting teacher approval", async () => {
    const artifact = creativeArtifact();
    const submission = adaptVideoAgentCriticReview({
      projectId: artifact.projectId, intentEpoch: 2, artifact,
      envelope: envelope(artifact, "course_anchor"),
      structuredOutput: output("course_anchor"),
    });
    expect(submission).toMatchObject({
      nodeKey: "creative_theme_generate", status: "needs_review",
      structuredContent: { videoCourseAnchorReview: { overallStatus: "passed", hardGateResults: expect.any(Array) } },
    });
    expect(submission.structuredContent).not.toHaveProperty("videoCourseAnchorApproval");

    const service = createWorkbenchService();
    const project = await service.createProject({ title: "课程锚点 HumanGate" });
    const candidate = await service.saveArtifact(project.id, { ...artifactInput(artifact), structuredContent: artifact.structuredContent });
    await expect(service.approveArtifact(project.id, candidate.id)).rejects.toThrow(/course_anchor_review_required/);
    const structuredContent = submission.structuredContent ?? {};
    const reviewed = await service.saveArtifact(project.id, { ...submission, structuredContent: { ...structuredContent, videoCourseAnchorReview: { ...(structuredContent.videoCourseAnchorReview as object), targetArtifactId: candidate.id } } });
    const approved = await service.approveArtifact(project.id, reviewed.id);
    expect(approved).toMatchObject({ status: "approved", isApproved: true, structuredContent: { videoCourseAnchorApproval: { decision: "approved" } } });
  });

  it("accepts a complete final-video review and keeps the approval separate", async () => {
    const artifact = finalVideoArtifact();
    const submission = adaptVideoAgentCriticReview({
      projectId: artifact.projectId, intentEpoch: 2, artifact,
      envelope: envelope(artifact, "video_final_review"),
      structuredOutput: output("video_final_review"),
    });
    expect(submission.structuredContent).toMatchObject({
      videoFinalReview: { schemaVersion: "video-final-review.v1", overallStatus: "passed" },
    });
    expect(submission.structuredContent).not.toHaveProperty("videoFinalApproval");

    const service = createWorkbenchService();
    const project = await service.createProject({ title: "成片 HumanGate" });
    const candidate = await service.saveArtifact(project.id, { ...artifactInput(artifact), structuredContent: artifact.structuredContent });
    await expect(service.approveArtifact(project.id, candidate.id)).rejects.toThrow(/video_final_review_required/);
    const reviewed = await service.saveArtifact(project.id, { ...submission, structuredContent: submission.structuredContent ?? {} });
    await expect(service.approveArtifact(project.id, reviewed.id)).resolves.toMatchObject({
      status: "approved", structuredContent: { videoFinalApproval: { decision: "approved" } },
    });
  });

  it("rejects missing real-media evidence and findings outside the reviewed video", () => {
    const incomplete = finalVideoArtifact();
    delete incomplete.structuredContent.videoFinalReviewEvidence;
    expect(() => adaptVideoAgentCriticReview({
      projectId: incomplete.projectId, intentEpoch: 2, artifact: incomplete,
      envelope: envelope(incomplete, "video_final_review"), structuredOutput: output("video_final_review"),
    })).toThrow(/evidence_incomplete/);

    const artifact = finalVideoArtifact();
    expect(() => adaptVideoAgentCriticReview({
      projectId: artifact.projectId, intentEpoch: 2, artifact,
      envelope: envelope(artifact, "video_final_review"),
      structuredOutput: output("video_final_review", {
        recommendation: "rework_required",
        findings: [{
          findingId: "finding-shot", severity: "major",
          locator: { kind: "shot", parentArtifactId: "other-video", shotId: "shot_02" },
          evidenceRefs: ["frame:02"], responsibleStage: "video_shot_generation",
          minimalFix: "只重做第二镜头。", invalidatesDownstream: true,
        }],
      }),
    })).toThrow(/finding_locator_invalid/);

    expect(() => adaptVideoAgentCriticReview({
      projectId: artifact.projectId, intentEpoch: 2, artifact,
      envelope: envelope(artifact, "video_final_review"),
      structuredOutput: output("video_final_review", {
        recommendation: "rework_required",
        findings: [{
          findingId: "finding-unknown-shot", severity: "major",
          locator: { kind: "shot", parentArtifactId: artifact.id, shotId: "shot_99" },
          evidenceRefs: ["frame:99"], responsibleStage: "video_shot_generation",
          minimalFix: "只重做问题镜头。", invalidatesDownstream: true,
        }],
      }),
    })).toThrow(/finding_locator_invalid/);
  });

  it("rejects stale digest and project bindings", () => {
    const artifact = creativeArtifact();
    expect(() => adaptVideoAgentCriticReview({
      projectId: "project-other", intentEpoch: 2, artifact,
      envelope: envelope(artifact, "course_anchor"), structuredOutput: output("course_anchor"),
    })).toThrow(/project_binding/);
    expect(() => adaptVideoAgentCriticReview({
      projectId: artifact.projectId, intentEpoch: 2, artifact,
      envelope: envelope(artifact, "course_anchor", "f".repeat(64)), structuredOutput: output("course_anchor"),
    })).toThrow(/digest_binding/);
  });

  it("blocks final delivery when a final-video gate fails and preserves the shot repair locator", () => {
    const artifact = finalVideoArtifact();
    const base = output("video_final_review");
    const finding = {
      findingId: "finding-anchor-drift", severity: "blocker" as const,
      locator: { kind: "shot" as const, parentArtifactId: artifact.id, shotId: "shot_02" },
      evidenceRefs: ["frame:shot_02"], responsibleStage: "video_shot_generation",
      minimalFix: "只重做第二镜头，恢复唯一课程回接。", invalidatesDownstream: true,
    };
    const result = enforceVideoFinalReviewGate({
      ...(base as Parameters<typeof enforceVideoFinalReviewGate>[0]),
      recommendation: "rework_required", findings: [finding],
      hardGateResults: (base.hardGateResults as Array<Record<string, unknown>>).map((gate) =>
        gate.gateId === "exactly_one_minimal_course_anchor" ? { ...gate, status: "failed", findingIds: [finding.findingId] } : gate,
      ) as Parameters<typeof enforceVideoFinalReviewGate>[0]["hardGateResults"],
    });
    expect(result).toMatchObject({
      reviewPassed: false, eligibleForDownstreamGuard: false, recommendation: "rework_required",
      forbiddenNextToolIntents: expect.arrayContaining(["create_final_package"]),
      findings: [{ locator: { kind: "shot", shotId: "shot_02" } }],
    });
  });
});

function creativeArtifact(): ArtifactRecord {
  return artifact("creative_theme_generate", { conceptSelection: { selectedConceptId: "concept-a" } });
}

function finalVideoArtifact(): ArtifactRecord {
  return artifact("concat_only_assemble", {
    videoFinalReviewEvidence: {
      storyboard: { artifactId: "storyboard-a", artifactVersion: 1, manifestDigest: "e".repeat(64), targetDurationRange: { minSeconds: 30, maxSeconds: 60 }, shotIds: ["shot_01", "shot_02", "shot_03"] },
      finalVideo: { storageRef: "video/final.mp4", sha256: "a".repeat(64), durationMs: 42000 },
      timeline: { timelineId: "timeline-a", shotIds: ["shot_01", "shot_02", "shot_03"], durationMs: 42000 },
      sampledFrames: [{ shotId: "shot_01", storageRef: "frames/shot_01.png", sha256: "b".repeat(64) }],
      transcript: { trackId: "caption-main", storageRef: "video/transcript.txt", sha256: "c".repeat(64) },
      audioTrack: { trackId: "audio-main", storageRef: "video/audio.wav", sha256: "d".repeat(64) },
    },
  });
}

function artifact(kind: ArtifactRecord["kind"], structuredContent: Record<string, unknown>): ArtifactRecord {
  return {
    id: `${kind}-a`, projectId: "project-a", nodeKey: kind, kind,
    title: "待审查视频产物", status: "needs_review", summary: "等待独立审查。",
    markdownContent: "# 待审查视频产物", structuredContent, version: 1, isApproved: false,
    createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z",
  };
}

function artifactInput(artifact: ArtifactRecord) {
  return { nodeKey: artifact.nodeKey, kind: artifact.kind, title: artifact.title, status: artifact.status, summary: artifact.summary, markdownContent: artifact.markdownContent };
}

function envelope(artifact: ArtifactRecord, stage: "course_anchor" | "video_final_review", digestOverride?: string) {
  const digest = digestOverride ?? hashArtifactDraft({
    nodeKey: artifact.nodeKey, kind: artifact.kind, title: artifact.title, summary: artifact.summary,
    markdownContent: artifact.markdownContent, structuredContent: artifact.structuredContent,
  });
  const target = { artifactId: artifact.id, kind: artifact.kind, version: artifact.version, digest };
  return createAgentToolInvocationEnvelope({
    invocationId: `critic-${stage}`, toolId: "delivery_critic.review",
    identity: { actorUserId: "user-a", actorAuthMode: "local", authSessionId: null },
    projectId: artifact.projectId, intentEpoch: 2, sourceMessageId: "message-a",
    reviewTargetRef: target, approvedArtifactRefs: [],
    arguments: {
      domain: "video", stage,
      targetLocators: [{ kind: "artifact", artifactKind: artifact.kind, artifactId: artifact.id }],
      reviewFocus: null,
      courseAnchorRef: stage === "course_anchor" ? { artifactId: artifact.id, version: artifact.version, digest } : null,
      rubricRef: { id: stage === "course_anchor" ? "video-course-anchor" : "video-final", version: "v1", digest: "e".repeat(64) },
      generatorInvocationId: "generator-a",
    },
  });
}

function output(stage: "course_anchor" | "video_final_review", overrides: Record<string, unknown> = {}) {
  const ids = stage === "course_anchor" ? videoCourseAnchorHardGateIds : videoFinalReviewHardGateIds;
  return {
    recommendation: "pass", summary: "独立审查通过。", findings: [],
    targetLocators: [], responsibleStage: stage === "course_anchor" ? "video_concept_selection" : "video_timeline_assembly",
    minimalFix: "无需返修。", inconclusiveReasons: [],
    hardGateResults: ids.map((gateId) => ({ gateId, status: "passed", evidenceRefs: [`evidence:${gateId}`], rationale: "证据满足。", findingIds: [] })),
    ...overrides,
  };
}
