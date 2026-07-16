"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getGeneratingLabel, type GeneratingState } from "@/components/conversation/composer/composer-contracts";

type GeneratingIndicatorProps = {
  state?: GeneratingState | "queued" | "running";
  label?: string;
  mark: ReactNode;
};

function getTeacherGeneratingLabel(state: GeneratingIndicatorProps["state"]) {
  if (state === "queued") return "排队中";
  if (state === "running") return "正在生成";
  return getGeneratingLabel(state ?? "generating");
}

export function GeneratingIndicator({ state = "generating", label, mark }: GeneratingIndicatorProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <article data-ai-thinking className="scroll-mt-24 flex justify-start" aria-live="polite" aria-label="小酷正在回复">
      <div className="flex max-w-[760px] items-start gap-3">
        {mark}
        <div className="min-w-0 flex-1 pt-2">
          <div className="inline-flex items-center gap-3 text-sm text-muted-foreground">
            <span>{label ?? (state === "generating" ? "小酷正在回复" : getTeacherGeneratingLabel(state))}</span>
            <span className="text-xs text-muted-foreground">已运行 {elapsedSeconds} 秒</span>
            <span className="flex items-center gap-1.5" aria-hidden="true">
              <span className="typing-dot" />
              <span className="typing-dot [animation-delay:140ms]" />
              <span className="typing-dot [animation-delay:280ms]" />
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
