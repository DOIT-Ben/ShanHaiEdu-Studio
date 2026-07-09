"use client";

import { cn } from "@/lib/utils";
import { normalizeQuickReplies, type ComposerQuickReply } from "@/components/conversation/composer/composer-contracts";

type QuickReplySuggestionsProps = {
  choices: ComposerQuickReply[];
  onSelect?: (value: string, actionId?: string) => void;
};

export function QuickReplySuggestions({ choices, onSelect }: QuickReplySuggestionsProps) {
  const normalizedChoices = normalizeQuickReplies(choices);
  if (normalizedChoices.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2" aria-label="可选回复">
      {normalizedChoices.map((choice) => (
        <button
          key={choice.prompt}
          type="button"
          data-quick-reply-choice
          data-recommended-choice={choice.recommended ? "true" : undefined}
          onClick={() => onSelect?.(choice.prompt, choice.actionId)}
          className={cn(
            "inline-flex min-h-8 items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-xs leading-5 text-foreground transition hover:border-[#b9ddd2] hover:bg-[#f7fbfa] focus:outline-none focus:ring-2 focus:ring-[#8fcbbb]/35",
            choice.recommended && "border-[#b9ddd2] bg-[#f7fbfa] text-[#32685d]",
          )}
        >
          {choice.recommended && <span className="text-[11px] font-medium text-[#32685d]">推荐</span>}
          <span>{choice.label}</span>
        </button>
      ))}
    </div>
  );
}
