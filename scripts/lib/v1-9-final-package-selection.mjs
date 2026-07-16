const finalPackageRoles = ["lesson_plan", "pptx", "pdf", "image", "video"];
const selectableStatuses = new Set(["needs_review", "approved"]);

export function selectLatestV1_9FinalPackage(artifacts, bindingValue) {
  const binding = normalizeBinding(bindingValue);
  return artifacts
    .filter((artifact) => isSelectableFinalPackage(artifact, binding))
    .sort(compareNewestFirst)[0] ?? null;
}

export function assertV1_9FinalPackageDownloadPath(pathnameValue, bindingValue) {
  const pathname = requiredText(pathnameValue, "download.pathname");
  const binding = requiredRecord(bindingValue, "download.binding");
  const projectId = requiredText(binding.projectId, "download.projectId");
  const artifactId = requiredText(binding.artifactId, "download.artifactId");
  const expected = `/api/workbench/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/package`;
  if (pathname !== expected) throw new Error("v1_9_final_package_download_artifact_mismatch");
}

function normalizeBinding(value) {
  const binding = requiredRecord(value, "selection.binding");
  const previousPackageArtifactVersion = binding.previousPackageArtifactVersion === null
    ? null
    : requiredPositiveInteger(binding.previousPackageArtifactVersion, "previousPackageArtifactVersion");
  const previousPackageVersion = binding.previousPackageVersion === null
    ? null
    : requiredText(binding.previousPackageVersion, "previousPackageVersion");
  if ((previousPackageArtifactVersion === null) !== (previousPackageVersion === null)) {
    throw new Error("v1_9_final_package_previous_binding_partial");
  }
  return {
    projectId: requiredText(binding.projectId, "projectId"),
    taskId: requiredText(binding.taskId, "taskId"),
    taskBriefDigest: requiredDigest(binding.taskBriefDigest, "taskBriefDigest"),
    intentEpoch: requiredNonNegativeInteger(binding.intentEpoch, "intentEpoch"),
    currentPlanRevision: requiredNonNegativeInteger(binding.currentPlanRevision, "currentPlanRevision"),
    previousPackageArtifactVersion,
    previousPackageVersion,
  };
}

function isSelectableFinalPackage(value, binding) {
  const artifact = record(value);
  if (!artifact || artifact.projectId !== binding.projectId || artifact.taskId !== binding.taskId ||
      artifact.taskBriefDigest !== binding.taskBriefDigest || artifact.intentEpoch !== binding.intentEpoch ||
      artifact.origin !== "tool_result" || artifact.nodeKey !== "final_delivery" || artifact.kind !== "final_delivery" ||
      !selectableStatuses.has(artifact.status) || !Number.isInteger(artifact.version) || artifact.version < 1 ||
      !Number.isInteger(artifact.planRevision) || artifact.planRevision < 0 ||
      artifact.planRevision > binding.currentPlanRevision || hasForbiddenProductionMarker(artifact.structuredContent)) {
    return false;
  }
  if ((artifact.status === "approved") !== (artifact.isApproved === true)) return false;
  if (binding.previousPackageArtifactVersion !== null && artifact.version <= binding.previousPackageArtifactVersion) return false;

  const content = record(artifact.structuredContent);
  const truth = record(content?.artifactTruth);
  const qualityGate = record(content?.qualityGate);
  const storage = record(content?.storage);
  const packageAsset = record(storage?.packageAsset);
  const manifest = record(content?.finalPackageManifest);
  const runSpec = record(content?.classroomRunSpec);
  const packageVersion = text(content?.courseVersionId);
  const reviewBatchId = text(content?.reviewBatchId);
  if (!content || !truth || !qualityGate || !packageAsset || !manifest || !runSpec || !packageVersion || !reviewBatchId) {
    return false;
  }
  if (binding.previousPackageVersion !== null && packageVersion === binding.previousPackageVersion) return false;
  if (truth.created !== true || truth.persisted !== true || truth.placeholder !== false ||
      truth.producedArtifactKind !== "final_delivery") return false;
  if (qualityGate.passed !== true || !nonEmptyUniqueText(qualityGate.gates)) return false;
  if (!hasFormalPackageAsset(packageAsset) || !hasFormalManifest(manifest, packageAsset.sourceArtifactIds) ||
      !hasBoundRunSpec(runSpec, manifest) || packageVersion !== manifest.courseVersionId ||
      reviewBatchId !== manifest.reviewBatchId) return false;
  return true;
}

function hasFormalPackageAsset(asset) {
  return asset.generationMode === "versioned_final_package_generated" &&
    asset.mime === "application/zip" && text(asset.fileName)?.toLowerCase().endsWith(".zip") === true &&
    Boolean(text(asset.localOutput)) && Number.isInteger(asset.bytes) && asset.bytes > 0 &&
    isDigest(asset.sha256) && isDigest(asset.manifestSha256) && nonEmptyUniqueText(asset.sourceArtifactIds);
}

function hasFormalManifest(manifest, sourceArtifactIds) {
  if (manifest.schemaVersion !== "final-package-manifest.v1" ||
      !["integration_review_passed", "teacher_signed_off"].includes(manifest.packageStatus) ||
      (manifest.packageStatus === "teacher_signed_off") !== (manifest.teacherSignoff === true) ||
      !text(manifest.courseVersionId) || !text(manifest.courseAnchor) || !text(manifest.reviewBatchId) ||
      !Number.isInteger(manifest.pptSlideCount) || manifest.pptSlideCount < 1 ||
      !Array.isArray(manifest.requiredRoles) || manifest.requiredRoles.length !== finalPackageRoles.length ||
      !finalPackageRoles.every((role) => manifest.requiredRoles.includes(role))) return false;
  const files = record(manifest.files);
  if (!files || Object.keys(files).length !== finalPackageRoles.length) return false;
  const sourceIds = new Set(sourceArtifactIds);
  return finalPackageRoles.every((role) => {
    const file = record(files[role]);
    return Boolean(file) && Boolean(text(file.fileName)) && Number.isInteger(file.bytes) && file.bytes > 0 &&
      isDigest(file.sha256) && file.deliveryStatus === "final_eligible" &&
      Boolean(text(file.sourceArtifactId)) && sourceIds.has(file.sourceArtifactId) &&
      Number.isInteger(file.sourceArtifactVersion) && file.sourceArtifactVersion > 0 &&
      isDigest(file.sourceArtifactDigest);
  });
}

function hasBoundRunSpec(runSpec, manifest) {
  return runSpec.schemaVersion === "classroom-run-spec.v1" && runSpec.courseVersionId === manifest.courseVersionId &&
    runSpec.courseAnchor === manifest.courseAnchor && runSpec.reviewBatchId === manifest.reviewBatchId &&
    runSpec.pptSlideCount === manifest.pptSlideCount && Array.isArray(runSpec.sequence) && runSpec.sequence.length > 0;
}

function hasForbiddenProductionMarker(value) {
  if (Array.isArray(value)) return value.some(hasForbiddenProductionMarker);
  const candidate = record(value);
  if (!candidate) return false;
  return Object.entries(candidate).some(([key, entry]) => {
    const normalized = key.toLowerCase();
    if ((normalized === "placeholder" || normalized === "isplaceholder") && entry === true) return true;
    if ((normalized === "degraded" || normalized === "isdegraded") && entry === true) return true;
    if ((normalized === "generationmode" || normalized === "providerstatus" || normalized === "runtimekind") &&
        typeof entry === "string" && /deterministic|placeholder|degraded|fallback/i.test(entry)) return true;
    return hasForbiddenProductionMarker(entry);
  });
}

function compareNewestFirst(left, right) {
  return right.version - left.version || right.planRevision - left.planRevision ||
    timestamp(right.updatedAt) - timestamp(left.updatedAt) || String(right.id).localeCompare(String(left.id));
}

function nonEmptyUniqueText(value) {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => Boolean(text(entry))) &&
    new Set(value).size === value.length;
}

function requiredRecord(value, field) {
  const candidate = record(value);
  if (!candidate) throw new Error(`v1_9_${field}_invalid`);
  return candidate;
}

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredText(value, field) {
  const normalized = text(value);
  if (!normalized) throw new Error(`v1_9_${field}_required`);
  return normalized;
}

function requiredDigest(value, field) {
  const normalized = requiredText(value, field).toLowerCase();
  if (!isDigest(normalized)) throw new Error(`v1_9_${field}_invalid`);
  return normalized;
}

function isDigest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function requiredNonNegativeInteger(value, field) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`v1_9_${field}_invalid`);
  return value;
}

function requiredPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`v1_9_${field}_invalid`);
  return value;
}

function timestamp(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
