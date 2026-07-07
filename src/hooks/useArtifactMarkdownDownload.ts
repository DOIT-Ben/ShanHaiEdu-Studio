"use client";

import { useEffect, useRef, useState } from "react";
import type { ArtifactItem } from "@/lib/types";
import { buildArtifactMarkdownDownload } from "@/lib/artifact-markdown-download";

type DownloadState = "idle" | "done" | "failed";

export function useArtifactMarkdownDownload(item: ArtifactItem) {
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setDownloadState("idle");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [item.key]);

  function downloadMarkdown() {
    if (timerRef.current) window.clearTimeout(timerRef.current);

    try {
      const download = buildArtifactMarkdownDownload(item);
      const blob = new Blob([download.markdown], { type: "text/markdown;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = download.filename;
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

  const downloadLabel = downloadState === "done" ? "已下载" : downloadState === "failed" ? "下载失败" : "下载 Markdown";

  return { downloadMarkdown, downloadLabel };
}
