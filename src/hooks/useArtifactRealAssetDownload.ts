"use client";

import { useEffect, useRef, useState } from "react";
import type { RealAssetKind } from "@/lib/artifact-real-assets";
import type { ArtifactItem } from "@/lib/types";

type DownloadState = "idle" | "done" | "failed";
type DownloadableRealAssetKind = Extract<RealAssetKind, "image" | "video">;

const routeSegmentByKind: Record<DownloadableRealAssetKind, string> = {
  image: "image",
  video: "video",
};

const labelByKind: Record<DownloadableRealAssetKind, string> = {
  image: "下载图片",
  video: "下载视频",
};

const fallbackExtensionByKind: Record<DownloadableRealAssetKind, string> = {
  image: "png",
  video: "mp4",
};

export function useArtifactRealAssetDownload(projectId: string, item: ArtifactItem, assetKind: DownloadableRealAssetKind) {
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  const timerRef = useRef<number | null>(null);
  const canDownloadRealAsset = Boolean(projectId && item.artifactId && item.realAssetDownloads?.includes(assetKind));

  useEffect(() => {
    setDownloadState("idle");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [assetKind, item.key, projectId]);

  async function downloadRealAsset() {
    if (!canDownloadRealAsset || !item.artifactId) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);

    try {
      const response = await fetch(`/api/workbench/projects/${projectId}/artifacts/${item.artifactId}/${routeSegmentByKind[assetKind]}`);
      if (!response.ok) throw new Error("Real asset download failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        filenameFromHeader(response.headers.get("content-disposition")) ?? `shanhai-${item.artifactId}.${fallbackExtensionByKind[assetKind]}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setDownloadState("done");
    } catch {
      setDownloadState("failed");
    }

    timerRef.current = window.setTimeout(() => setDownloadState("idle"), 1400);
  }

  const downloadRealAssetLabel = downloadState === "done" ? "已下载" : downloadState === "failed" ? "下载失败" : labelByKind[assetKind];
  return { canDownloadRealAsset, downloadRealAsset, downloadRealAssetLabel };
}

function filenameFromHeader(value: string | null) {
  const match = value?.match(/filename="([^"]+)"/);
  return match?.[1];
}
