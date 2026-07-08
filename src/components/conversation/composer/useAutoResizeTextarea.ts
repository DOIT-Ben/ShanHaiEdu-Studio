"use client";

import { useLayoutEffect, type RefObject } from "react";
import { getTextareaHeightPlan } from "./composer-contracts";

export function useAutoResizeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  options: { minRows?: number; maxRows?: number; lineHeightPx?: number } = {},
) {
  const lineHeightPx = options.lineHeightPx ?? 24;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const plan = getTextareaHeightPlan(value, options);
    element.style.height = "auto";
    const minHeight = plan.minRows * lineHeightPx + 12;
    const maxHeight = plan.maxRows * lineHeightPx + 12;
    const measuredHeight = Math.max(minHeight, element.scrollHeight);
    element.style.height = `${Math.min(maxHeight, measuredHeight)}px`;
    element.style.overflowY = measuredHeight > maxHeight ? "auto" : "hidden";
  }, [lineHeightPx, options, ref, value]);
}
