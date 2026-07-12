import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const DEFAULT_FILES_BASE_URL = "https://files-api.evolink.ai";

export type LocalVideoReferenceAsset = {
  assetId: string;
  assetDomain: "video";
  sha256: string;
  applicableShotIds: string[];
  purpose: string;
  localPath: string;
};

export type EvolinkReferenceUploadEvidence = {
  shotId: string;
  assetId: string;
  assetDomain: "video";
  purpose: string;
  localSha256: string;
  uploadFileId: string;
  uploadedUrl: string;
  downloadUrl: string | null;
  expiresAt: string | null;
};

export async function resolveEvolinkShotReferences(input: {
  shotId: string;
  references: LocalVideoReferenceAsset[];
  apiKey: string;
  filesBaseUrl?: string;
  uploadPath?: string;
}): Promise<EvolinkReferenceUploadEvidence[]> {
  if (!/^shot_[a-z0-9_-]+$/i.test(input.shotId)) throw new Error("video_reference_shot_id_invalid");
  if (!input.apiKey.trim()) throw new Error("video_reference_upload_api_key_missing");
  if (input.references.length > 7) throw new Error("video_reference_image_limit_exceeded");

  const resolved: EvolinkReferenceUploadEvidence[] = [];
  for (const reference of input.references) {
    resolved.push(await uploadReference({ ...input, reference }));
  }
  return resolved;
}

async function uploadReference(input: {
  shotId: string;
  reference: LocalVideoReferenceAsset;
  apiKey: string;
  filesBaseUrl?: string;
  uploadPath?: string;
}): Promise<EvolinkReferenceUploadEvidence> {
  const { reference } = input;
  if (reference.assetDomain !== "video") throw new Error("video_reference_asset_domain_invalid");
  if (!reference.applicableShotIds.includes(input.shotId)) throw new Error("video_reference_shot_binding_invalid");
  if (!reference.assetId.trim() || !reference.purpose.trim()) throw new Error("video_reference_asset_metadata_invalid");

  const mime = referenceMimeType(reference.localPath);
  const bytes = await readFile(reference.localPath);
  if (bytes.length === 0 || bytes.length > MAX_REFERENCE_BYTES) throw new Error("video_reference_file_size_invalid");
  const localSha256 = createHash("sha256").update(bytes).digest("hex");
  if (localSha256 !== reference.sha256.toLowerCase()) throw new Error("video_reference_sha256_mismatch");

  const fileName = path.basename(reference.localPath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), fileName);
  form.append("upload_path", input.uploadPath?.trim() || "shanhai-video-inputs");
  form.append("file_name", fileName);

  const response = await fetch(buildEvolinkReferenceUploadUrl(input.filesBaseUrl), {
    method: "POST",
    headers: { Authorization: `Bearer ${input.apiKey}` },
    body: form,
  });
  if (!response.ok) throw new Error(`video_reference_upload_failed:${response.status}`);
  const upload = readUploadResponse(await response.json());

  return {
    shotId: input.shotId,
    assetId: reference.assetId,
    assetDomain: "video",
    purpose: reference.purpose,
    localSha256,
    uploadFileId: upload.fileId,
    uploadedUrl: upload.fileUrl,
    downloadUrl: upload.downloadUrl,
    expiresAt: upload.expiresAt,
  };
}

export function buildEvolinkReferenceUploadUrl(filesBaseUrl = DEFAULT_FILES_BASE_URL): string {
  const normalized = filesBaseUrl.trim().replace(/\/+$/, "");
  if (!normalized) throw new Error("video_reference_files_base_url_missing");
  return /\/api\/v1\/files\/upload\/stream$/i.test(normalized)
    ? normalized
    : `${normalized}/api/v1/files/upload/stream`;
}

function referenceMimeType(localPath: string): string {
  const extension = path.extname(localPath).toLowerCase();
  const mime = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  }[extension];
  if (!mime) throw new Error("video_reference_file_type_invalid");
  return mime;
}

function readUploadResponse(payload: unknown): {
  fileId: string;
  fileUrl: string;
  downloadUrl: string | null;
  expiresAt: string | null;
} {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const data = root.data && typeof root.data === "object" ? root.data as Record<string, unknown> : {};
  const fileId = readRequiredString(data.file_id, "video_reference_upload_file_id_missing");
  const fileUrl = readRequiredString(data.file_url, "video_reference_upload_url_missing");
  if (!/^https:\/\//i.test(fileUrl)) throw new Error("video_reference_upload_url_untrusted");
  return {
    fileId,
    fileUrl,
    downloadUrl: readOptionalString(data.download_url),
    expiresAt: readOptionalString(data.expires_at),
  };
}

function readRequiredString(value: unknown, errorCode: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
