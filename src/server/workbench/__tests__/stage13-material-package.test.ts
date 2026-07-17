import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getPackageRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/package/route";
import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { createExecutionEnvelope, createTaskBrief, type IntentGrant, type TaskBrief } from "@/server/conversation/task-contract";
import { prisma } from "@/server/db/client";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { ClassroomRunSpec, FinalPackageRole } from "@/server/package/versioned-final-package";
import { createWorkbenchService } from "@/server/workbench/service";
import type { ArtifactRecord } from "@/server/workbench/types";

const projectIds: string[] = [];
const storageRoots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  if (projectIds.length > 0) {
    await prisma.project.deleteMany({ where: { id: { in: projectIds.splice(0) } } });
  }
  for (const root of storageRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Local Real MVP M13 final material package route", () => {
  it("downloads only a reverse-verified package bound to a succeeded create_final_package invocation", async () => {
    const fixture = await createPackageArtifact();
    await persistSuccessfulInvocation(fixture);

    const response = await download(fixture.artifact);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/zip");
    expect(Buffer.from(await response.arrayBuffer()).equals(fixture.buffer)).toBe(true);
  });

  it("fails closed when the stored ZIP is changed after its SHA-256 was persisted", async () => {
    const fixture = await createPackageArtifact();
    await persistSuccessfulInvocation(fixture);
    const tamperedZip = await JSZip.loadAsync(fixture.buffer);
    tamperedZip.file("untracked.txt", "changed after persistence");
    writeFileSync(fixture.absolutePath, await tamperedZip.generateAsync({ type: "nodebuffer" }));

    const response = await download(fixture.artifact);

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).not.toContain("application/zip");
  });

  it.each([
    ["has no Tool invocation lineage", async (_fixture: PackageArtifactFixture) => undefined],
    ["was persisted by another Tool", async (fixture: PackageArtifactFixture) => {
      await persistSuccessfulInvocation(fixture, { toolName: "legacy_package_builder" });
    }],
  ])("fails closed when the package %s", async (_label, arrange) => {
    const fixture = await createPackageArtifact();
    await arrange(fixture);

    const response = await download(fixture.artifact);

    expect(response.status).toBe(400);
  });

  it.each([
    ["is not a formal versioned package", (content: Record<string, unknown>) => {
      packageAsset(content).generationMode = "legacy_package_generated";
    }],
    ["claims a different course version", (content: Record<string, unknown>) => {
      content.courseVersionId = "different-course-version";
    }],
  ])("fails closed when the stored package %s", async (_label, mutate) => {
    const fixture = await createPackageArtifact(mutate);
    await persistSuccessfulInvocation(fixture);

    const response = await download(fixture.artifact);

    expect(response.status).toBe(400);
  });

  it.each([
    ["has an orphan observation reference", { observationMode: "missing" as const }],
    ["has an Observation bound to another artifact", { observationMode: "wrong_artifact" as const }],
    ["has an Observation bound to another task", { observationMode: "wrong_task" as const }],
    ["has an invocation bound to another task", { invocationTaskId: "task-other" }],
  ])("fails closed when the package %s", async (_label, options) => {
    const fixture = await createPackageArtifact();
    await persistSuccessfulInvocation(fixture, options);

    const response = await download(fixture.artifact);

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).not.toContain("application/zip");
  });

  it("fails closed when the requested final-delivery version has no persisted ZIP", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M13 missing package" });
    projectIds.push(project.id);
    const finalDelivery = await service.saveArtifact(project.id, {
      nodeKey: "final_delivery", kind: "final_delivery", title: "Final checklist only", status: "needs_review",
      summary: "No persisted ZIP.", markdownContent: "# Checklist", structuredContent: {},
    });

    const response = await download(finalDelivery);

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).not.toContain("application/zip");
  });
});

async function createPackageArtifact(
  mutate?: (structuredContent: Record<string, unknown>) => void,
): Promise<PackageArtifactFixture> {
  const storageRoot = mkdtempSync(path.join(os.tmpdir(), "shanhai-package-download-"));
  storageRoots.push(storageRoot);
  vi.stubEnv("ARTIFACT_STORAGE_ROOT", storageRoot);

  const service = createWorkbenchService();
  const project = await service.createProject({ title: `M13 package ${randomUUID()}` });
  projectIds.push(project.id);
  const taskBrief = createTaskBrief({
    taskId: `task:${project.id}`,
    projectId: project.id,
    intentEpoch: project.intentEpoch ?? 0,
    goal: "Build one version-bound final package.",
    requestedOutputs: ["package"],
    constraints: ["persisted_package_only"],
    excludedOutputs: [],
    generationIntensity: project.generationIntensity ?? "standard",
    sourceMessageId: `message:${project.id}`,
  });
  const intentGrant: IntentGrant = {
    schemaVersion: "intent-grant.v1",
    taskId: taskBrief.taskId,
    projectId: taskBrief.projectId,
    intentEpoch: taskBrief.intentEpoch,
    standardWorkAuthorized: true,
    intensity: taskBrief.generationIntensity,
    budgetPolicyVersion: "package-test.v1",
    maxCostCredits: 0,
    maxExternalProviderCalls: 0,
    requiredCheckpoints: [],
    expiresAt: null,
  };
  await createControlPlaneStore().upsertTaskAggregate({
    taskBrief,
    intentGrant,
    plan: { planId: `plan:${project.id}`, revision: 0, status: "active" },
    checkpoint: null,
  });
  const packageValue = await buildPackageBuffer();
  const fileName = `${project.id}-final.zip`;
  const stored = writeLocalArtifact({ category: "package-artifacts", fileName, buffer: packageValue.buffer });
  const structuredContent: Record<string, unknown> = {
    finalPackageManifest: packageValue.manifest,
    classroomRunSpec: packageValue.classroomRunSpec,
    courseVersionId: packageValue.manifest.courseVersionId,
    reviewBatchId: packageValue.manifest.reviewBatchId,
    storage: {
      packageAsset: {
        fileName,
        localOutput: stored.localOutput,
        bytes: packageValue.buffer.length,
        sha256: sha256(packageValue.buffer),
        manifestSha256: hashRunInput(packageValue.manifest),
        mime: "application/zip",
        generationMode: "versioned_final_package_generated",
        sourceArtifactIds: Object.values(packageValue.manifest.files).map((entry) => entry.sourceArtifactId),
      },
    },
  };
  mutate?.(structuredContent);
  const artifact = await service.saveArtifact(project.id, {
    nodeKey: "final_delivery", kind: "final_delivery", title: "Formal final package", status: "needs_review",
    summary: "Persisted version-bound ZIP.", markdownContent: "# Final package", structuredContent, origin: "tool_result",
  });
  return { artifact, buffer: packageValue.buffer, absolutePath: stored.absolutePath, taskBrief, intentGrant };
}

async function buildPackageBuffer() {
  const roles: FinalPackageRole[] = ["lesson_plan", "pptx", "pdf", "image", "video"];
  const fileNames: Record<FinalPackageRole, string> = {
    lesson_plan: "lesson-plan.md",
    pptx: "lesson-slides.pptx",
    pdf: "lesson-slides.pdf",
    image: "visual.png",
    video: "intro-video.mp4",
  };
  const contents = Object.fromEntries(roles.map((role) => [role, Buffer.from(`verified-${role}-bytes`)])) as Record<FinalPackageRole, Buffer>;
  const courseVersionId = "course-version-1";
  const courseAnchor = "single minimal course anchor";
  const reviewBatchId = "review-batch-1";
  const classroomRunSpec: ClassroomRunSpec = {
    schemaVersion: "classroom-run-spec.v1",
    courseVersionId,
    courseAnchor,
    reviewBatchId,
    pptSlideCount: 6,
    sequence: [
      { ordinal: 1, action: "play_intro_video", artifactRole: "video", instruction: "Play the intro video." },
      { ordinal: 2, action: "ask_return_question", instruction: "Ask the return question." },
      { ordinal: 3, action: "open_ppt", artifactRole: "pptx", pptPage: 1, instruction: "Open the slides." },
      { ordinal: 4, action: "teacher_explain", artifactRole: "pptx", pptPage: 2, instruction: "Guide observation." },
      { ordinal: 5, action: "reveal_answer", artifactRole: "pptx", pptPage: 6, instruction: "Reveal after discussion." },
    ],
  };
  const manifest = {
    schemaVersion: "final-package-manifest.v1",
    courseVersionId,
    courseAnchor,
    reviewBatchId,
    pptSlideCount: classroomRunSpec.pptSlideCount,
    packageStatus: "integration_review_passed",
    teacherSignoff: false,
    requiredRoles: roles,
    mediaEvidence: {
      pptx: { slideCount: 6 },
      pdf: { pageCount: 6 },
      video: { durationSeconds: 42, width: 1280, height: 720, fps: 24, videoCodec: "h264", audioCodec: "aac" },
    },
    files: Object.fromEntries(roles.map((role) => [role, {
      fileName: fileNames[role],
      bytes: contents[role].length,
      sha256: sha256(contents[role]),
      deliveryStatus: "final_eligible",
      sourceArtifactId: `source-${role}`,
      sourceArtifactVersion: 1,
      sourceArtifactDigest: sha256(Buffer.from(`source-${role}`)),
    }])) as Record<FinalPackageRole, {
      fileName: string;
      bytes: number;
      sha256: string;
      deliveryStatus: string;
      sourceArtifactId: string;
      sourceArtifactVersion: number;
      sourceArtifactDigest: string;
    }>,
  };
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("classroom-run-spec.json", JSON.stringify(classroomRunSpec, null, 2));
  for (const role of roles) zip.file(fileNames[role], contents[role]);
  const buffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return { buffer, manifest, classroomRunSpec };
}

type PackageArtifactFixture = {
  artifact: ArtifactRecord;
  buffer: Buffer;
  absolutePath: string;
  taskBrief: TaskBrief;
  intentGrant: IntentGrant;
};

type PersistInvocationOptions = {
  toolName?: string;
  observationMode?: "matching" | "missing" | "wrong_artifact" | "wrong_task";
  invocationTaskId?: string;
};

async function persistSuccessfulInvocation(
  fixture: PackageArtifactFixture,
  options: PersistInvocationOptions = {},
) {
  const { artifact, taskBrief, intentGrant } = fixture;
  const toolName = options.toolName ?? "create_final_package";
  const planRevision = artifact.planRevision ?? 0;
  const envelope = createExecutionEnvelope({
    actorUserId: "teacher-package-test",
    taskBrief,
    planRevision,
    intensity: taskBrief.generationIntensity,
    intentGrant,
    action: { toolName, arguments: { artifactId: artifact.id } },
  });
  const invocationId = randomUUID();
  const observationId = randomUUID();
  await prisma.toolInvocationRecord.create({
    data: {
      invocationId,
      projectId: artifact.projectId,
      taskId: options.invocationTaskId ?? taskBrief.taskId,
      intentEpoch: taskBrief.intentEpoch,
      planRevision,
      toolName,
      executionEnvelopeJson: JSON.stringify(envelope),
      requestJson: "{}",
      idempotencyKey: envelope.idempotencyKey,
      status: "succeeded",
      artifactId: artifact.id,
      observationId,
      finishedAt: new Date(),
    },
  });
  if (options.observationMode === "missing") return;
  await prisma.observationRecord.create({
    data: {
      observationId,
      projectId: artifact.projectId,
      taskId: options.observationMode === "wrong_task" ? "task-other" : taskBrief.taskId,
      invocationId,
      intentEpoch: taskBrief.intentEpoch,
      status: "succeeded",
      reasonCodesJson: JSON.stringify(["business_tool_succeeded"]),
      payloadJson: JSON.stringify({ artifactId: artifact.id }),
      artifactId: options.observationMode === "wrong_artifact" ? "artifact-other" : artifact.id,
    },
  });
}

async function download(artifact: ArtifactRecord) {
  return getPackageRoute(new Request("http://localhost"), {
    params: Promise.resolve({ projectId: artifact.projectId, artifactId: artifact.id }),
  });
}

function packageAsset(structuredContent: Record<string, unknown>) {
  return ((structuredContent.storage as Record<string, unknown>).packageAsset as Record<string, unknown>);
}

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
