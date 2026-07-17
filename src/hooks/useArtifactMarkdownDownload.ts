"use client";

import { useEffect, useRef, useState } from "react";
import type { ArtifactItem } from "@/lib/types";
import { buildArtifactMarkdownDownload } from "@/lib/artifact-markdown-download";

type DownloadState = "idle" | "done" | "failed";
type ScopedDownloadState = {
  scopeKey: string;
  state: DownloadState;
};

export function useArtifactMarkdownDownload(item: ArtifactItem) {
  const scopeKey = item.key;
  const [downloadFeedback, setDownloadFeedback] = useState<ScopedDownloadState>({ scopeKey, state: "idle" });
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

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
      setDownloadFeedback({ scopeKey, state: "done" });
    } catch {
      setDownloadFeedback({ scopeKey, state: "failed" });
    }

    timerRef.current = window.setTimeout(() => setDownloadFeedback({ scopeKey, state: "idle" }), 1400);
  }

  const downloadState = downloadFeedback.scopeKey === scopeKey ? downloadFeedback.state : "idle";
  const downloadLabel = downloadState === "done" ? "已下载" : downloadState === "failed" ? "下载失败" : "下载 Markdown";

  return { downloadMarkdown, downloadLabel };
}
