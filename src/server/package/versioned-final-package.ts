import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import JSZip from "jszip";

export type FinalPackageRole = "lesson_plan" | "pptx" | "pdf" | "image" | "video";

export type FinalPackageFile = {
  role: FinalPackageRole;
  filePath: string;
  packageFileName: string;
  sha256: string;
  courseVersionId: string;
  courseAnchor: string;
  reviewBatchId: string;
  deliveryStatus: "final_eligible";
  sourceArtifactId: string;
  sourceArtifactVersion: number;
  sourceArtifactDigest: string;
};

export type ClassroomRunSpec = {
  schemaVersion: "classroom-run-spec.v1";
  courseVersionId: string;
  courseAnchor: string;
  reviewBatchId: string;
  sequence: Array<{
    ordinal: number;
    action: "play_intro_video" | "ask_return_question" | "open_ppt" | "teacher_explain" | "reveal_answer";
    artifactRole?: FinalPackageRole;
    pptPage?: number;
    instruction: string;
  }>;
};

export type FinalPackageMediaEvidence = {
  pptx: { slideCount: number };
  pdf: { pageCount: number };
  video: { durationSeconds: number; width: number; height: number; fps: number; videoCodec: string; audioCodec: string };
};

export type FinalPackageInspectors = {
  pptx: (buffer: Buffer) => Promise<FinalPackageMediaEvidence["pptx"]>;
  pdf: (filePath: string) => FinalPackageMediaEvidence["pdf"];
  video: (filePath: string) => FinalPackageMediaEvidence["video"];
};

export async function buildVersionedFinalPackage(input: {
  files: FinalPackageFile[];
  classroomRunSpec: ClassroomRunSpec;
  teacherSignoff: boolean;
  inspectors?: Partial<FinalPackageInspectors>;
}): Promise<{ buffer: Buffer; manifest: Record<string, unknown>; sha256: string }> {
  const files = validateFileSet(input.files, input.classroomRunSpec);
  validateClassroomRunSpec(input.classroomRunSpec);
  const inspectors: FinalPackageInspectors = {
    pptx: input.inspectors?.pptx ?? inspectPptx,
    pdf: input.inspectors?.pdf ?? inspectPdf,
    video: input.inspectors?.video ?? inspectVideo,
  };
  const buffers = new Map<FinalPackageRole, Buffer>();
  for (const file of files) {
    const buffer = await readFile(file.filePath);
    if (buffer.length === 0) throw new Error(`final_package_file_empty:${file.role}`);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    if (sha256 !== file.sha256.toLowerCase()) throw new Error(`final_package_sha256_mismatch:${file.role}`);
    buffers.set(file.role, buffer);
  }

  const mediaEvidence: FinalPackageMediaEvidence = {
    pptx: await inspectors.pptx(buffers.get("pptx")!),
    pdf: inspectors.pdf(fileByRole(files, "pdf").filePath),
    video: inspectors.video(fileByRole(files, "video").filePath),
  };
  validateMediaEvidence(mediaEvidence);

  const manifest = {
    schemaVersion: "final-package-manifest.v1",
    courseVersionId: files[0].courseVersionId,
    courseAnchor: files[0].courseAnchor,
    reviewBatchId: files[0].reviewBatchId,
    packageStatus: input.teacherSignoff ? "teacher_signed_off" : "integration_review_passed",
    teacherSignoff: input.teacherSignoff,
    requiredRoles: ["lesson_plan", "pptx", "pdf", "image", "video"],
    mediaEvidence,
    files: Object.fromEntries(files.map((file) => [file.role, {
      fileName: file.packageFileName,
      bytes: buffers.get(file.role)!.length,
      sha256: file.sha256.toLowerCase(),
      deliveryStatus: file.deliveryStatus,
      sourceArtifactId: file.sourceArtifactId,
      sourceArtifactVersion: file.sourceArtifactVersion,
      sourceArtifactDigest: file.sourceArtifactDigest,
    }])),
  };

  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("classroom-run-spec.json", JSON.stringify(input.classroomRunSpec, null, 2));
  for (const file of files) zip.file(file.packageFileName, buffers.get(file.role)!);
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output);
  await verifyFinalPackageBuffer(buffer, manifest);
  return { buffer, manifest, sha256: createHash("sha256").update(buffer).digest("hex") };
}

export async function verifyFinalPackageBuffer(buffer: Buffer, expectedManifest?: Record<string, unknown>): Promise<void> {
  const zip = await JSZip.loadAsync(buffer);
  const manifestEntry = zip.file("manifest.json");
  const runSpecEntry = zip.file("classroom-run-spec.json");
  if (!manifestEntry || !runSpecEntry) throw new Error("final_package_required_metadata_missing");
  const manifest = JSON.parse(await manifestEntry.async("string")) as {
    courseVersionId?: string;
    courseAnchor?: string;
    reviewBatchId?: string;
    requiredRoles?: string[];
    files?: Record<string, { fileName?: string; bytes?: number; sha256?: string }>;
  };
  if (expectedManifest && JSON.stringify(manifest) !== JSON.stringify(expectedManifest)) throw new Error("final_package_manifest_changed");
  const requiredRoles: FinalPackageRole[] = ["lesson_plan", "pptx", "pdf", "image", "video"];
  if (manifest.requiredRoles?.length !== requiredRoles.length || Object.keys(manifest.files ?? {}).length !== requiredRoles.length ||
      requiredRoles.some((role) => !manifest.requiredRoles?.includes(role) || !manifest.files?.[role])) {
    throw new Error("final_package_manifest_roles_invalid");
  }
  const runSpec = JSON.parse(await runSpecEntry.async("string")) as Partial<ClassroomRunSpec>;
  if (runSpec.courseVersionId !== manifest.courseVersionId || runSpec.courseAnchor !== manifest.courseAnchor || runSpec.reviewBatchId !== manifest.reviewBatchId) {
    throw new Error("final_package_run_spec_binding_invalid");
  }
  validateClassroomRunSpec(runSpec as ClassroomRunSpec);
  for (const [role, evidence] of Object.entries(manifest.files ?? {})) {
    if (!evidence.fileName || !evidence.sha256) throw new Error(`final_package_manifest_file_invalid:${role}`);
    const entry = zip.file(evidence.fileName);
    if (!entry) throw new Error(`final_package_entry_missing:${role}`);
    const bytes = Buffer.from(await entry.async("uint8array"));
    if (bytes.length !== evidence.bytes) throw new Error(`final_package_entry_size_mismatch:${role}`);
    if (createHash("sha256").update(bytes).digest("hex") !== evidence.sha256) throw new Error(`final_package_entry_hash_mismatch:${role}`);
  }
}

function validateFileSet(files: FinalPackageFile[], runSpec: ClassroomRunSpec): FinalPackageFile[] {
  const required: FinalPackageRole[] = ["lesson_plan", "pptx", "pdf", "image", "video"];
  const byRole = new Map(files.map((file) => [file.role, file]));
  if (files.length !== required.length || required.some((role) => !byRole.has(role))) throw new Error("final_package_required_file_missing");
  if (new Set(files.map((file) => file.role)).size !== files.length) throw new Error("final_package_duplicate_role");
  if (new Set(files.map((file) => file.packageFileName.toLowerCase())).size !== files.length) throw new Error("final_package_duplicate_file_name");
  if (files.some((file) => file.deliveryStatus !== "final_eligible")) throw new Error("final_package_artifact_not_eligible");
  const binding = files.map((file) => `${file.courseVersionId}\u0000${file.courseAnchor}\u0000${file.reviewBatchId}`);
  if (new Set(binding).size !== 1) throw new Error("final_package_version_binding_mismatch");
  if (runSpec.courseVersionId !== files[0].courseVersionId || runSpec.courseAnchor !== files[0].courseAnchor || runSpec.reviewBatchId !== files[0].reviewBatchId) {
    throw new Error("classroom_run_spec_version_mismatch");
  }
  for (const file of files) {
    if (!file.packageFileName.trim() || path.basename(file.packageFileName) !== file.packageFileName ||
        !file.sourceArtifactId.trim() || !Number.isInteger(file.sourceArtifactVersion) || file.sourceArtifactVersion < 1 ||
        !/^[a-f0-9]{64}$/i.test(file.sha256) || !/^[a-f0-9]{64}$/i.test(file.sourceArtifactDigest)) {
      throw new Error(`final_package_file_contract_invalid:${file.role}`);
    }
  }
  return required.map((role) => byRole.get(role)!);
}

function validateClassroomRunSpec(spec: ClassroomRunSpec): void {
  if (spec.schemaVersion !== "classroom-run-spec.v1" || spec.sequence.length < 5) throw new Error("classroom_run_spec_incomplete");
  const allowedActions = new Set(["play_intro_video", "ask_return_question", "open_ppt", "teacher_explain", "reveal_answer"]);
  if (spec.sequence.some((step, index) => step.ordinal !== index + 1 || !allowedActions.has(step.action) || !step.instruction.trim())) throw new Error("classroom_run_spec_sequence_invalid");
  const actions = spec.sequence.map((step) => step.action);
  const videoIndex = actions.indexOf("play_intro_video");
  const questionIndex = actions.indexOf("ask_return_question");
  const pptIndex = actions.indexOf("open_ppt");
  const revealIndex = actions.indexOf("reveal_answer");
  if ([videoIndex, questionIndex, pptIndex, revealIndex].some((index) => index < 0) || !(videoIndex < questionIndex && questionIndex < pptIndex && pptIndex < revealIndex)) {
    throw new Error("classroom_run_spec_pedagogy_order_invalid");
  }
  for (const action of ["play_intro_video", "ask_return_question", "open_ppt", "reveal_answer"] as const) {
    if (actions.filter((candidate) => candidate === action).length !== 1) throw new Error("classroom_run_spec_action_count_invalid");
  }
  const videoStep = spec.sequence[videoIndex];
  const questionStep = spec.sequence[questionIndex];
  const pptSteps = spec.sequence.filter((step) => step.action === "open_ppt" || step.action === "teacher_explain" || step.action === "reveal_answer");
  if (videoStep.artifactRole !== "video" || questionStep.artifactRole !== undefined || questionStep.pptPage !== undefined ||
      pptSteps.some((step) => step.artifactRole !== "pptx" || !Number.isInteger(step.pptPage) || step.pptPage! < 1 || step.pptPage! > 12)) {
    throw new Error("classroom_run_spec_artifact_binding_invalid");
  }
}

async function inspectPptx(buffer: Buffer): Promise<FinalPackageMediaEvidence["pptx"]> {
  const zip = await JSZip.loadAsync(buffer);
  if (!zip.file("ppt/presentation.xml")) throw new Error("final_package_pptx_structure_invalid");
  const slideCount = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).length;
  return { slideCount };
}

function inspectPdf(filePath: string): FinalPackageMediaEvidence["pdf"] {
  const result = spawnSync("pdfinfo", [filePath], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error("final_package_pdf_probe_failed");
  const pageCount = Number.parseInt(result.stdout.match(/^Pages:\s+(\d+)/m)?.[1] ?? "0", 10);
  return { pageCount };
}

function inspectVideo(filePath: string): FinalPackageMediaEvidence["video"] {
  const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,codec_type,width,height,r_frame_rate", "-of", "json", filePath], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error("final_package_video_probe_failed");
  const payload = JSON.parse(result.stdout) as { format?: { duration?: string }; streams?: Array<{ codec_name?: string; codec_type?: string; width?: number; height?: number; r_frame_rate?: string }> };
  const video = payload.streams?.find((stream) => stream.codec_type === "video");
  const audio = payload.streams?.find((stream) => stream.codec_type === "audio");
  const [numerator, denominator] = (video?.r_frame_rate ?? "0/1").split("/").map(Number);
  return { durationSeconds: Number(payload.format?.duration ?? 0), width: video?.width ?? 0, height: video?.height ?? 0, fps: denominator ? numerator / denominator : 0, videoCodec: video?.codec_name ?? "", audioCodec: audio?.codec_name ?? "" };
}

function validateMediaEvidence(evidence: FinalPackageMediaEvidence): void {
  if (evidence.pptx.slideCount !== 12) throw new Error("final_package_pptx_slide_count_invalid");
  if (evidence.pdf.pageCount !== 12) throw new Error("final_package_pdf_page_count_invalid");
  if (evidence.video.durationSeconds < 15 || evidence.video.durationSeconds > 90 || evidence.video.videoCodec !== "h264" || evidence.video.audioCodec !== "aac" || evidence.video.fps !== 24) {
    throw new Error("final_package_video_evidence_invalid");
  }
}

function fileByRole(files: FinalPackageFile[], role: FinalPackageRole): FinalPackageFile {
  return files.find((file) => file.role === role)!;
}
