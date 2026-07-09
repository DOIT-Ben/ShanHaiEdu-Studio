"use client";

import type { ReactNode } from "react";
import { getGeneratingLabel, type GeneratingState } from "@/components/conversation/composer/composer-contracts";

type GeneratingIndicatorProps = {
  state?: GeneratingState;
  label?: string;
  mark: ReactNode;
};

export function GeneratingIndicator({ state = "generating", label, mark }: GeneratingIndicatorProps) {
  return (
    <article data-ai-thinking className="scroll-mt-24 flex justify-start" aria-live="polite" aria-label="正在准备回复">
      <div className="flex max-w-[88%] items-start gap-3 sm:max-w-[620px]">
        {mark}
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">ShanHaiEdu AI</span>
          </div>
          <div className="inline-flex items-center gap-3 rounded-2xl border border-[#d7ebe5] bg-[#fbfefd] px-4 py-3 text-sm text-muted-foreground shadow-[0_12px_30px_rgba(29,74,66,0.05)]">
            <span>{label ?? getGeneratingLabel(state)}</span>
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
