"use client";

import { useEffect, useRef, useState } from "react";
import type { ArtifactItem } from "@/lib/types";

type DownloadState = "idle" | "done" | "failed";
type ScopedDownloadState = {
  operationId: number;
  scopeKey: string;
  state: DownloadState;
};

export function useArtifactPptxDownload(projectId: string, item: ArtifactItem) {
  const scopeKey = `${projectId}:${item.key}`;
  const [downloadFeedback, setDownloadFeedback] = useState<ScopedDownloadState>({ operationId: 0, scopeKey, state: "idle" });
  const timerRef = useRef<number | null>(null);
  const operationRef = useRef(0);
  const canDownloadPptx = Boolean(projectId && item.artifactId && item.nodeKey === "pptx_artifact");

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  async function downloadPptx() {
    if (!canDownloadPptx || !item.artifactId) return;
    operationRef.current += 1;
    const operationId = operationRef.current;
    const operationScopeKey = scopeKey;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setDownloadFeedback({ operationId, scopeKey: operationScopeKey, state: "idle" });

    try {
      const response = await fetch(`/api/workbench/projects/${projectId}/artifacts/${item.artifactId}/pptx`);
      if (!response.ok) throw new Error("PPTX download failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFromHeader(response.headers.get("content-disposition")) ?? `shanhai-${item.artifactId}.pptx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      if (operationRef.current !== operationId) return;
      setDownloadFeedback({ operationId, scopeKey: operationScopeKey, state: "done" });
    } catch {
      if (operationRef.current !== operationId) return;
      setDownloadFeedback({ operationId, scopeKey: operationScopeKey, state: "failed" });
    }

    timerRef.current = window.setTimeout(() => {
      if (operationRef.current === operationId) {
        setDownloadFeedback({ operationId, scopeKey: operationScopeKey, state: "idle" });
      }
    }, 1400);
  }

  const downloadState = downloadFeedback.scopeKey === scopeKey ? downloadFeedback.state : "idle";
  const downloadPptxLabel = downloadState === "done" ? "已下载" : downloadState === "failed" ? "下载失败" : "下载 PPTX";
  return { canDownloadPptx, downloadPptx, downloadPptxLabel };
}

function filenameFromHeader(value: string | null) {
  const match = value?.match(/filename="([^"]+)"/);
  return match?.[1];
}
