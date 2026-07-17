"use client";

import { useEffect, useRef, useState } from "react";
import type { ArtifactItem } from "@/lib/types";

type CopyFeedbackState = "idle" | "pending" | "done" | "unknown";
type ScopedCopyFeedback = {
  operationId: number;
  scopeKey: string;
  state: CopyFeedbackState;
};

export function useArtifactCopyFeedback(
  item: ArtifactItem,
  onCopy: (item: ArtifactItem) => boolean | void | Promise<boolean | void>,
) {
  const scopeKey = item.key;
  const [copyFeedback, setCopyFeedback] = useState<ScopedCopyFeedback>({ operationId: 0, scopeKey, state: "idle" });
  const timerRef = useRef<number | null>(null);
  const operationRef = useRef(0);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  async function copyItem() {
    operationRef.current += 1;
    const operationId = operationRef.current;
    const operationScopeKey = scopeKey;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setCopyFeedback({ operationId, scopeKey: operationScopeKey, state: "pending" });
    timerRef.current = window.setTimeout(() => {
      if (operationRef.current === operationId) {
        setCopyFeedback({ operationId, scopeKey: operationScopeKey, state: "unknown" });
      }
    }, 1200);

    const copiedOk = await onCopy(item);
    if (operationRef.current !== operationId) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setCopyFeedback({ operationId, scopeKey: operationScopeKey, state: copiedOk === false ? "unknown" : "done" });
    timerRef.current = window.setTimeout(() => {
      if (operationRef.current === operationId) {
        setCopyFeedback({ operationId, scopeKey: operationScopeKey, state: "idle" });
      }
    }, 1400);
  }

  const copyState = copyFeedback.scopeKey === scopeKey ? copyFeedback.state : "idle";
  const copyLabel = copyState === "pending" ? "正在复制" : copyState === "done" ? "已复制" : copyState === "unknown" ? "复制未确认" : "复制";

  return { copyItem, copyLabel };
}
