"use client";

import { useEffect, useRef, useState } from "react";
import type { ArtifactItem } from "@/lib/types";

type CopyFeedbackState = "idle" | "pending" | "done" | "unknown";

export function useArtifactCopyFeedback(
  item: ArtifactItem,
  onCopy: (item: ArtifactItem) => boolean | void | Promise<boolean | void>,
) {
  const [copyState, setCopyState] = useState<CopyFeedbackState>("idle");
  const timerRef = useRef<number | null>(null);
  const operationRef = useRef(0);

  useEffect(() => {
    operationRef.current += 1;
    setCopyState("idle");
    if (timerRef.current) window.clearTimeout(timerRef.current);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [item.key]);

  async function copyItem() {
    operationRef.current += 1;
    const operationId = operationRef.current;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setCopyState("pending");
    timerRef.current = window.setTimeout(() => {
      if (operationRef.current === operationId) setCopyState("unknown");
    }, 1200);

    const copiedOk = await onCopy(item);
    if (operationRef.current !== operationId) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setCopyState(copiedOk === false ? "unknown" : "done");
    timerRef.current = window.setTimeout(() => {
      if (operationRef.current === operationId) setCopyState("idle");
    }, 1400);
  }

  const copyLabel = copyState === "pending" ? "正在复制" : copyState === "done" ? "已复制" : copyState === "unknown" ? "复制未确认" : "复制";

  return { copyItem, copyLabel };
}
