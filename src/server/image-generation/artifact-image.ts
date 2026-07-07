import { existsSync, readFileSync } from "node:fs";
import { resolveLocalArtifactOutput } from "@/server/artifact-storage/local-artifact-storage";
import type { ArtifactRecord } from "@/server/workbench/types";

type ImageAsset = {
  localOutput?: unknown;
  fileName?: unknown;
  mime?: unknown;
};

type ImageDownload = {
  filename: string;
  buffer: Buffer;
  mime: "image/png" | "image/jpeg";
};

export function buildStoredImageDownload(artifact: ArtifactRecord): ImageDownload {
  const imageAsset = readImageAsset(artifact);
  const localOutput = typeof imageAsset.localOutput === "string" ? imageAsset.localOutput : "";
  if (!localOutput.trim()) {
    throw new Error("stored_image_asset_not_found");
  }

  const absolutePath = resolveLocalArtifactOutput(localOutput);
  if (!absolutePath) {
    throw new Error("stored_image_path_outside_storage");
  }
  if (!existsSync(absolutePath)) {
    throw new Error("stored_image_file_not_found");
  }

  const buffer = readFileSync(absolutePath);
  const validation = validateImageBuffer(buffer);
  if (!validation.valid) {
    throw new Error("invalid_stored_image_file");
  }

  const fallbackName = `${safeFileSegment(artifact.id)}${validation.extension}`;
  return {
    filename: safeImageFileName(imageAsset.fileName, fallbackName, validation.extension),
    buffer,
    mime: validation.mime,
  };
}

export function imageDownloadHeaders(input: { filename: string; mime: "image/png" | "image/jpeg" }) {
  return {
    "content-type": input.mime,
    "content-disposition": `attachment; filename="${input.filename}"`,
  };
}

function readImageAsset(artifact: ArtifactRecord): ImageAsset {
  const storage = artifact.structuredContent.storage;
  const imageAsset = storage && typeof storage === "object" ? (storage as Record<string, unknown>).imageAsset : null;
  if (!imageAsset || typeof imageAsset !== "object") {
    throw new Error("stored_image_asset_not_found");
  }
  return imageAsset as ImageAsset;
}

function validateImageBuffer(
  buffer: Buffer,
): { valid: true; mime: "image/png"; extension: ".png" } | { valid: true; mime: "image/jpeg"; extension: ".jpg" } | { valid: false } {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { valid: true, mime: "image/png", extension: ".png" };
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { valid: true, mime: "image/jpeg", extension: ".jpg" };
  }

  return { valid: false };
}

function safeImageFileName(fileName: unknown, fallback: string, extension: ".png" | ".jpg") {
  const raw = typeof fileName === "string" && fileName.trim() ? fileName : fallback;
  const cleaned = raw.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, "-").trim();
  const lower = cleaned.toLowerCase();
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return cleaned;
  }
  return `${cleaned || safeFileSegment(fallback)}${extension}`;
}

function safeFileSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "image"
  );
}
