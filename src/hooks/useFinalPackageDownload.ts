"use client";

import { useEffect, useRef, useState } from "react";
import type { ArtifactItem } from "@/lib/types";

type DownloadState = "idle" | "done" | "failed";

export function useFinalPackageDownload(projectId: string, item: ArtifactItem) {
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  const timerRef = useRef<number | null>(null);
  const canDownloadPackage = Boolean(projectId && item.artifactId && item.nodeKey === "final_delivery");

  useEffect(() => {
    setDownloadState("idle");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [item.key, projectId]);

  async function downloadPackage() {
    if (!canDownloadPackage || !item.artifactId) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);

    try {
      const response = await fetch(`/api/workbench/projects/${projectId}/artifacts/${item.artifactId}/package`);
      if (!response.ok) throw new Error("Material package download failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFromHeader(response.headers.get("content-disposition")) ?? `shanhai-${item.artifactId}.zip`;
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

  const downloadPackageLabel = downloadState === "done" ? "已下载" : downloadState === "failed" ? "下载失败" : "下载材料包";
  return { canDownloadPackage, downloadPackage, downloadPackageLabel };
}

function filenameFromHeader(value: string | null) {
  const match = value?.match(/filename="([^"]+)"/);
  return match?.[1];
}
