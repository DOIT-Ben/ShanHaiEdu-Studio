import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertV1_9FinalPackageDownloadPath,
  selectLatestV1_9FinalPackage,
} from "../scripts/lib/v1-9-final-package-selection.mjs";

const sha = (value) => value.repeat(64);

test("selects only the latest formal final_delivery bound to the frozen task and intent", () => {
  const current = formalPackage({ id: "package-current-v5", version: 5, packageVersion: "course-v5" });
  const selected = selectLatestV1_9FinalPackage([
    formalPackage({ id: "package-other-task-v9", version: 9, taskId: "task-other", packageVersion: "course-v9" }),
    formalPackage({ id: "package-old-epoch-v8", version: 8, intentEpoch: 6, packageVersion: "course-v8" }),
    formalPackage({ id: "package-gate-failed-v7", version: 7, packageVersion: "course-v7", qualityPassed: false }),
    formalPackage({ id: "package-unpersisted-v6", version: 6, packageVersion: "course-v6", persisted: false }),
    formalPackage({ id: "package-old-v3", version: 3, packageVersion: "course-v3" }),
    current,
  ], binding());

  assert.equal(selected?.id, current.id);
  assert.equal(selected?.version, 5);
});

test("does not reselect an already-bound package or accept a same-task package with a stale digest", () => {
  const selected = selectLatestV1_9FinalPackage([
    formalPackage({ id: "package-bound-v5", version: 5, packageVersion: "course-v5" }),
    formalPackage({ id: "package-stale-digest-v6", version: 6, packageVersion: "course-v6", taskBriefDigest: sha("b") }),
  ], binding({ previousPackageArtifactVersion: 5, previousPackageVersion: "course-v5" }));

  assert.equal(selected, null);
});

test("fails closed for non-final, degraded, unapproved-state, or incomplete package candidates", () => {
  const candidates = [
    formalPackage({ id: "wrong-kind", version: 10, kind: "pptx_artifact" }),
    formalPackage({ id: "degraded", version: 9, degraded: true }),
    formalPackage({ id: "bad-status", version: 8, status: "blocked" }),
    formalPackage({ id: "missing-package-asset", version: 7, omitPackageAsset: true }),
  ];

  assert.equal(selectLatestV1_9FinalPackage(candidates, binding()), null);
});

test("download path assertion binds the browser request to the selected artifact", () => {
  assert.doesNotThrow(() => assertV1_9FinalPackageDownloadPath(
    "/api/workbench/projects/project-1/artifacts/package-current-v5/package",
    { projectId: "project-1", artifactId: "package-current-v5" },
  ));
  assert.throws(() => assertV1_9FinalPackageDownloadPath(
    "/api/workbench/projects/project-1/artifacts/package-old-v3/package",
    { projectId: "project-1", artifactId: "package-current-v5" },
  ), /v1_9_final_package_download_artifact_mismatch/);
});

function binding(overrides = {}) {
  return {
    projectId: "project-1",
    taskId: "task-current",
    taskBriefDigest: sha("a"),
    intentEpoch: 7,
    currentPlanRevision: 3,
    previousPackageArtifactVersion: null,
    previousPackageVersion: null,
    ...overrides,
  };
}

function formalPackage(overrides = {}) {
  const packageVersion = overrides.packageVersion ?? `course-v${overrides.version ?? 1}`;
  const sourceArtifactIds = ["lesson-1", "pptx-1", "pdf-1", "image-1", "video-1"];
  const roles = ["lesson_plan", "pptx", "pdf", "image", "video"];
  const files = Object.fromEntries(roles.map((role, index) => [role, {
    fileName: `${role}.bin`,
    bytes: 32,
    sha256: sha(String(index + 1)),
    deliveryStatus: "final_eligible",
    sourceArtifactId: sourceArtifactIds[index],
    sourceArtifactVersion: 1,
    sourceArtifactDigest: sha(String(index + 5)),
  }]));
  const structuredContent = {
    courseVersionId: packageVersion,
    reviewBatchId: "review-current",
    artifactTruth: {
      created: true,
      persisted: overrides.persisted ?? true,
      placeholder: false,
      producedArtifactKind: "final_delivery",
    },
    qualityGate: {
      passed: overrides.qualityPassed ?? true,
      gates: ["version_binding_verified", "manifest_reverse_verified"],
    },
    finalPackageManifest: {
      schemaVersion: "final-package-manifest.v1",
      courseVersionId: packageVersion,
      courseAnchor: "独立创意短片后以一个问题回接课程任务",
      reviewBatchId: "review-current",
      pptSlideCount: 12,
      packageStatus: "integration_review_passed",
      teacherSignoff: false,
      requiredRoles: roles,
      files,
    },
    classroomRunSpec: {
      schemaVersion: "classroom-run-spec.v1",
      courseVersionId: packageVersion,
      courseAnchor: "独立创意短片后以一个问题回接课程任务",
      reviewBatchId: "review-current",
      pptSlideCount: 12,
      sequence: [{ ordinal: 1, action: "play_intro_video", instruction: "播放导入视频。" }],
    },
    storage: overrides.omitPackageAsset ? {} : {
      packageAsset: {
        fileName: `${packageVersion}.zip`,
        localOutput: `artifact-storage/package-artifacts/${packageVersion}.zip`,
        bytes: 1024,
        sha256: sha("c"),
        manifestSha256: sha("d"),
        mime: "application/zip",
        generationMode: "versioned_final_package_generated",
        sourceArtifactIds,
      },
    },
  };
  if (overrides.degraded) structuredContent.providerStatus = "degraded";

  return {
    id: overrides.id ?? "package-v1",
    projectId: "project-1",
    taskId: overrides.taskId ?? "task-current",
    taskBriefDigest: overrides.taskBriefDigest ?? sha("a"),
    intentEpoch: overrides.intentEpoch ?? 7,
    planRevision: overrides.planRevision ?? 3,
    origin: "tool_result",
    nodeKey: overrides.kind ?? "final_delivery",
    kind: overrides.kind ?? "final_delivery",
    status: overrides.status ?? "needs_review",
    version: overrides.version ?? 1,
    isApproved: false,
    updatedAt: "2026-07-16T01:00:00.000Z",
    structuredContent,
  };
}
