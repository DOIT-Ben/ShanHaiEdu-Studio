import { createHash } from "node:crypto";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import { evaluateTaskCompletionContract } from "@/server/conversation/task-completion-contract";
import { createTaskBrief, type TaskBrief } from "@/server/conversation/task-contract";
import { createFinalPackageManifestDigest } from "@/server/package/versioned-final-package";
import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import {
  attachVerifiedArtifactApprovalEvidence,
  isArtifactAvailableAsTaskInput,
  isArtifactBoundToRequestedOutput,
} from "@/server/quality/artifact-truth-boundary";
import { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactKind, ArtifactRecord } from "@/server/workbench/types";

describe("Artifact task and truth boundary", () => {
  it.each(["teacher_input", "tool_result"] as const)(
    "keeps an unbound same-epoch %s artifact available as input without letting it satisfy an output",
    (origin) => {
      const taskBrief = task({ taskId: `task-input-${origin}` });
      const legacy = trustedToolArtifact({
        kind: "requirement_spec",
        origin,
        intentEpoch: taskBrief.intentEpoch,
        taskId: null,
        taskBriefDigest: null,
      });

      expect(isArtifactAvailableAsTaskInput(legacy, taskBrief)).toBe(true);
      expect(isArtifactBoundToRequestedOutput(legacy, taskBrief)).toBe(false);
      expect(evaluateTaskCompletionContract(taskBrief, [legacy])).toEqual({
        status: "unsatisfied",
        remainingRequestedOutputs: ["requirement_spec"],
      });
    },
  );

  it.each([
    ["missing taskId", null, "digest"],
    ["missing TaskBrief digest", "task", null],
  ] as const)("rejects a same-epoch artifact with %s from requested-output completion", (_label, taskIdMode, digestMode) => {
    const taskBrief = task({ taskId: "task-partial-binding" });
    const artifact = trustedToolArtifact({
      kind: "requirement_spec",
      intentEpoch: taskBrief.intentEpoch,
      taskId: taskIdMode === "task" ? taskBrief.taskId : null,
      taskBriefDigest: digestMode === "digest" ? taskBrief.digest : null,
    });

    expect(isArtifactAvailableAsTaskInput(artifact, taskBrief)).toBe(false);
    expect(isArtifactBoundToRequestedOutput(artifact, taskBrief)).toBe(false);
    expect(evaluateTaskCompletionContract(taskBrief, [artifact]).status).toBe("unsatisfied");
  });

  it("does not let a trusted artifact from an old IntentEpoch satisfy a new TaskBrief by kind alone", () => {
    const firstTask = task({ taskId: "task-artifact-scope-v1", intentEpoch: 0 });
    const approved = trustedToolArtifact({
      kind: "requirement_spec",
      intentEpoch: firstTask.intentEpoch,
      taskId: firstTask.taskId,
      taskBriefDigest: firstTask.digest,
    });

    expect(evaluateTaskCompletionContract(firstTask, [approved])).toMatchObject({ status: "satisfied" });

    const redirectedTask = task({ taskId: "task-artifact-scope-v2", intentEpoch: 1 });
    expect(evaluateTaskCompletionContract(redirectedTask, [approved])).toEqual({
      status: "unsatisfied",
      remainingRequestedOutputs: ["requirement_spec"],
    });
  });

  it.each([
    ["ppt", "pptx_artifact"],
    ["image", "image_prompts"],
    ["video", "concat_only_assemble"],
    ["package", "final_delivery"],
  ] as const)("satisfies %s only when the task-bound Tool result has a real verified delivery", async (requestedOutput, kind) => {
    const taskBrief = task({ taskId: `task-real-delivery-${requestedOutput}`, requestedOutputs: [requestedOutput] });
    const artifact = await realDeliveryArtifact(requestedOutput, kind, taskBrief);

    expect(evaluateTaskCompletionContract(taskBrief, [artifact])).toEqual({
      status: "satisfied",
      remainingRequestedOutputs: [],
    });
  });

  it.each([
    ["ppt", "pptx_artifact"],
    ["image", "image_prompts"],
    ["video", "concat_only_assemble"],
    ["package", "final_delivery"],
  ] as const)("does not let task-bound approved teacher Markdown satisfy %s", (requestedOutput, kind) => {
    const taskBrief = task({ taskId: `task-teacher-markdown-${requestedOutput}`, requestedOutputs: [requestedOutput] });
    const artifact = approvedTeacherMarkdown(kind, taskBrief);

    expect(isArtifactTrustedForDownstream(artifact)).toBe(true);
    expect(isArtifactBoundToRequestedOutput(artifact, taskBrief)).toBe(true);
    expect(evaluateTaskCompletionContract(taskBrief, [artifact])).toEqual({
      status: "unsatisfied",
      remainingRequestedOutputs: [requestedOutput],
    });
  });

  it.each([
    ["ppt", "pptx_artifact", { storage: { cozePptx: { localOutput: "artifact-storage/coze-ppt-artifacts/missing.pptx", fileName: "missing.pptx", bytes: 128, sha256: "a".repeat(64), slideCount: 1, generationMode: "coze_generated", sourceArtifactId: "design-1" } } }],
    ["image", "image_prompts", { storage: { imageAsset: { localOutput: "artifact-storage/image-artifacts/missing.png", fileName: "missing.png", bytes: 128, sha256: "b".repeat(64), mime: "image/png", generationMode: "image_generated", sourceArtifactId: "outline-1" } } }],
    ["video", "concat_only_assemble", { storage: { videoAsset: { localOutput: "artifact-storage/video-artifacts/missing.mp4", fileName: "missing.mp4", bytes: 2048, sha256: "c".repeat(64), mime: "video/mp4", generationMode: "ffmpeg_timeline_assembled", sourceArtifactIds: ["shot-1"] } }, videoFinalReviewEvidence: { finalVideo: {}, timeline: {}, transcript: {}, audioTrack: {}, sampledFrames: [{}] }, videoFinalReview: { schemaVersion: "video-final-review.v1", overallStatus: "passed", evidenceDigest: "d".repeat(64) } }],
    ["package", "final_delivery", { storage: { packageAsset: { localOutput: "artifact-storage/package-artifacts/missing.zip", fileName: "missing.zip", bytes: 256, sha256: "e".repeat(64), manifestSha256: "f".repeat(64), mime: "application/zip", generationMode: "versioned_final_package_generated", sourceArtifactIds: ["lesson-1"] } }, finalPackageManifest: {}, classroomRunSpec: {} }],
  ] as const)("does not satisfy %s when trusted Tool metadata points to no real file", (requestedOutput, kind, structuredContent) => {
    const taskBrief = task({ taskId: `task-missing-file-${requestedOutput}`, requestedOutputs: [requestedOutput] });
    const artifact = trustedToolArtifact({
      kind,
      intentEpoch: taskBrief.intentEpoch,
      taskId: taskBrief.taskId,
      taskBriefDigest: taskBrief.digest,
      structuredContent,
    });

    expect(evaluateTaskCompletionContract(taskBrief, [artifact])).toEqual({
      status: "unsatisfied",
      remainingRequestedOutputs: [requestedOutput],
    });
  });

  it("does not trust a teacher artifact merely because it self-declares an eligible quality state", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "artifact-fake-quality" });
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "lesson_plan",
      kind: "lesson_plan",
      title: "伪造质量状态的教案",
      status: "needs_review",
      summary: "尚未经过系统验证。",
      markdownContent: "# 教案",
      structuredContent: {
        artifactQualityState: {
          validationStatus: "passed",
          reviewStatus: "passed",
          downstreamEligibility: "eligible",
        },
      },
    });

    expect(isArtifactTrustedForDownstream(artifact)).toBe(false);
  });

  it.each([
    ["deterministic", { generationMode: "deterministic_draft" }],
    ["placeholder", { placeholder: true }],
    ["degraded", { degraded: true }],
  ])("rejects approval of %s output without promoting it downstream", async (_label, structuredContent) => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: `artifact-reject-${_label}` });
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "不可提升的候选",
      status: "needs_review",
      summary: "这是明确标识的非正式结果。",
      markdownContent: "# 非正式结果",
      structuredContent,
    });

    await expect(service.approveArtifact(project.id, artifact.id)).rejects.toThrow(/artifact_truth_not_approvable/);
    expect(isArtifactTrustedForDownstream(await service.getArtifact(project.id, artifact.id))).toBe(false);
  });

  it("rejects approval of a failed artifact", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "artifact-reject-failed" });
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "失败候选",
      status: "failed",
      summary: "生成失败。",
      markdownContent: "# 失败",
    });

    await expect(service.approveArtifact(project.id, artifact.id)).rejects.toThrow(/artifact_truth_not_approvable/);
  });
});

function task(input: {
  taskId: string;
  intentEpoch?: number;
  requestedOutputs?: string[];
}): TaskBrief {
  return createTaskBrief({
    taskId: input.taskId,
    projectId: "project-artifact-truth",
    intentEpoch: input.intentEpoch ?? 0,
    goal: "完成当前明确交付任务",
    requestedOutputs: input.requestedOutputs ?? ["requirement_spec"],
    constraints: [],
    excludedOutputs: [],
    generationIntensity: "standard",
    sourceMessageId: `message-${input.taskId}`,
  });
}

function trustedToolArtifact(input: {
  kind: ArtifactKind;
  origin?: ArtifactRecord["origin"];
  intentEpoch: number;
  taskId: string | null;
  taskBriefDigest: string | null;
  structuredContent?: Record<string, unknown>;
}): ArtifactRecord {
  return {
    id: `artifact-${input.kind}-${input.taskId ?? "legacy"}`,
    projectId: "project-artifact-truth",
    taskId: input.taskId,
    taskBriefDigest: input.taskBriefDigest,
    intentEpoch: input.intentEpoch,
    planRevision: 0,
    origin: input.origin ?? "tool_result",
    nodeKey: input.kind,
    kind: input.kind,
    title: `可信 ${input.kind}`,
    status: "needs_review",
    summary: "可信 Tool 结果。",
    markdownContent: `# ${input.kind}`,
    structuredContent: {
      ...input.structuredContent,
      artifactQualityState: {
        validationStatus: "passed",
        reviewStatus: "passed",
        downstreamEligibility: "eligible",
      },
    },
    version: 1,
    isApproved: false,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
  };
}

function approvedTeacherMarkdown(kind: ArtifactKind, taskBrief: TaskBrief): ArtifactRecord {
  const draft = {
    ...trustedToolArtifact({
      kind,
      origin: "teacher_input",
      intentEpoch: taskBrief.intentEpoch,
      taskId: taskBrief.taskId,
      taskBriefDigest: taskBrief.digest,
      structuredContent: {},
    }),
    status: "needs_review" as const,
    isApproved: false,
    structuredContent: {},
  };
  const structuredContent = attachVerifiedArtifactApprovalEvidence(draft);
  return { ...draft, status: "approved", isApproved: true, structuredContent };
}

async function realDeliveryArtifact(requestedOutput: string, kind: ArtifactKind, taskBrief: TaskBrief): Promise<ArtifactRecord> {
  const common = {
    artifactTruth: { created: true, persisted: true, placeholder: false, producedArtifactKind: kind },
    qualityGate: { passed: true, gates: ["fixture_file_verified"] },
  };
  let structuredContent: Record<string, unknown>;

  if (requestedOutput === "ppt") {
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", "<p:presentation />");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const stored = writeLocalArtifact({ category: "coze-ppt-artifacts", fileName: "completion-real.pptx", buffer });
    structuredContent = { ...common, storage: { cozePptx: {
      localOutput: stored.localOutput, fileName: "completion-real.pptx", bytes: buffer.length,
      sha256: sha256(buffer), slideCount: 1, generationMode: "coze_generated", sourceArtifactId: "design-real",
    } } };
  } else if (requestedOutput === "image") {
    const buffer = validPngBuffer();
    const stored = writeLocalArtifact({ category: "image-artifacts", fileName: "completion-real.png", buffer });
    structuredContent = { ...common, storage: { imageAsset: {
      localOutput: stored.localOutput, fileName: "completion-real.png", bytes: buffer.length,
      sha256: sha256(buffer), mime: "image/png", generationMode: "image_generated", sourceArtifactId: "outline-real",
    } } };
  } else if (requestedOutput === "video") {
    const buffer = validMp4Buffer();
    const stored = writeLocalArtifact({ category: "video-artifacts", fileName: "completion-real.mp4", buffer });
    structuredContent = {
      ...common,
      storage: { videoAsset: {
        localOutput: stored.localOutput, fileName: "completion-real.mp4", bytes: buffer.length,
        sha256: sha256(buffer), mime: "video/mp4", generationMode: "ffmpeg_timeline_assembled", sourceArtifactIds: ["shot-real"],
      } },
      videoFinalReviewEvidence: { finalVideo: {}, timeline: {}, transcript: {}, audioTrack: {}, sampledFrames: [{}] },
      videoFinalReview: { schemaVersion: "video-final-review.v1", overallStatus: "passed", evidenceDigest: "d".repeat(64) },
    };
  } else {
    const courseVersionId = "course-version-real";
    const reviewBatchId = "review-batch-real";
    const courseAnchor = "独立创意短片结束后以一个问题回到当前任务";
    const roles = ["lesson_plan", "pptx", "pdf", "image", "video"] as const;
    const sourceArtifactIds = roles.map((role) => `source-${role}`);
    const files = Object.fromEntries(roles.map((role, index) => [role, {
      fileName: `${role}.${role === "lesson_plan" ? "md" : role}`,
      bytes: 8,
      sha256: String(index + 1).repeat(64),
      deliveryStatus: "final_eligible",
      sourceArtifactId: sourceArtifactIds[index],
      sourceArtifactVersion: 1,
      sourceArtifactDigest: (index + 6).toString(16).padStart(2, "0").repeat(32),
    }]));
    const manifest = {
      schemaVersion: "final-package-manifest.v1", courseVersionId, courseAnchor, reviewBatchId, pptSlideCount: 1,
      packageStatus: "integration_review_passed", teacherSignoff: false, requiredRoles: [...roles], files,
    };
    const classroomRunSpec = {
      schemaVersion: "classroom-run-spec.v1", courseVersionId, courseAnchor, reviewBatchId, pptSlideCount: 1,
      sequence: [{ ordinal: 1, action: "play_intro_video", artifactRole: "video", instruction: "播放后以唯一问题回到当前任务。" }],
    };
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify(manifest));
    zip.file("classroom-run-spec.json", JSON.stringify(classroomRunSpec));
    for (const file of Object.values(files)) zip.file(file.fileName, "evidence");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const stored = writeLocalArtifact({ category: "package-artifacts", fileName: "completion-real.zip", buffer });
    structuredContent = {
      ...common, finalPackageManifest: manifest, classroomRunSpec, courseVersionId, reviewBatchId,
      storage: { packageAsset: {
        localOutput: stored.localOutput, fileName: "completion-real.zip", bytes: buffer.length, sha256: sha256(buffer),
        manifestSha256: createFinalPackageManifestDigest(manifest), mime: "application/zip",
        generationMode: "versioned_final_package_generated", sourceArtifactIds,
      } },
    };
  }

  return trustedToolArtifact({
    kind,
    intentEpoch: taskBrief.intentEpoch,
    taskId: taskBrief.taskId,
    taskBriefDigest: taskBrief.digest,
    structuredContent,
  });
}

function validPngBuffer(): Buffer {
  const buffer = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(1, 16);
  buffer.writeUInt32BE(1, 20);
  return buffer;
}

function validMp4Buffer(): Buffer {
  const buffer = Buffer.alloc(2048);
  buffer.write("ftyp", 4, "ascii");
  buffer.write("moov", 128, "ascii");
  return buffer;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
