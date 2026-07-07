import { existsSync, readFileSync } from "node:fs";
import { resolveLocalArtifactOutput } from "@/server/artifact-storage/local-artifact-storage";
import type { ArtifactRecord } from "@/server/workbench/types";

type VideoAsset = {
  localOutput?: unknown;
  fileName?: unknown;
  mime?: unknown;
};

type VideoDownload = {
  filename: string;
  buffer: Buffer;
};

const videoMimeType = "video/mp4";

export function buildStoredVideoDownload(artifact: ArtifactRecord): VideoDownload {
  const videoAsset = readVideoAsset(artifact);
  const localOutput = typeof videoAsset.localOutput === "string" ? videoAsset.localOutput : "";
  if (!localOutput.trim()) {
    throw new Error("stored_video_asset_not_found");
  }

  const absolutePath = resolveLocalArtifactOutput(localOutput);
  if (!absolutePath) {
    throw new Error("stored_video_path_outside_storage");
  }
  if (!existsSync(absolutePath)) {
    throw new Error("stored_video_file_not_found");
  }

  const buffer = readFileSync(absolutePath);
  if (!validateMp4Buffer(buffer)) {
    throw new Error("invalid_stored_video_file");
  }

  const fallbackName = `${safeFileSegment(artifact.id)}.mp4`;
  return {
    filename: safeMp4FileName(videoAsset.fileName, fallbackName),
    buffer,
  };
}

export function videoDownloadHeaders(filename: string) {
  return {
    "content-type": videoMimeType,
    "content-disposition": `attachment; filename="${filename}"`,
  };
}

function readVideoAsset(artifact: ArtifactRecord): VideoAsset {
  const storage = artifact.structuredContent.storage;
  const videoAsset = storage && typeof storage === "object" ? (storage as Record<string, unknown>).videoAsset : null;
  if (!videoAsset || typeof videoAsset !== "object") {
    throw new Error("stored_video_asset_not_found");
  }
  return videoAsset as VideoAsset;
}

function validateMp4Buffer(buffer: Buffer) {
  if (buffer.length < 12) {
    return false;
  }

  const searchLimit = Math.min(buffer.length - 4, 64);
  for (let index = 0; index <= searchLimit; index += 1) {
    if (buffer.subarray(index, index + 4).toString("ascii") === "ftyp") {
      return true;
    }
  }
  return false;
}

function safeMp4FileName(fileName: unknown, fallback: string) {
  const raw = typeof fileName === "string" && fileName.trim() ? fileName : fallback;
  const cleaned = raw.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, "-").trim();
  const withExtension = cleaned.toLowerCase().endsWith(".mp4") ? cleaned : `${cleaned}.mp4`;
  return withExtension || fallback;
}

function safeFileSegment(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "video"
  );
}
