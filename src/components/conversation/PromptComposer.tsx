"use client";

import type { KeyboardEvent } from "react";
import { CornerDownLeft, Paperclip, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type PromptComposerProps = {
  value: string;
  reference: string | null;
  notice: string | null;
  onChange: (value: string) => void;
  onClearReference: () => void;
  onSend: () => void;
};

export function PromptComposer({ value, reference, notice, onChange, onClearReference, onSend }: PromptComposerProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onSend();
  }

  return (
    <div className="bg-card px-4 pb-4 pt-3 sm:px-8">
      <div className="mx-auto w-full max-w-[980px]">
        {reference && (
          <div className="mb-2 inline-flex max-w-full items-start justify-between gap-3 rounded-lg bg-muted px-3 py-2">
            <div className="min-w-0 text-xs leading-5 text-foreground">
              <span className="font-medium text-muted-foreground">引用：</span>
              <span>{reference}</span>
            </div>
            <button
              type="button"
              onClick={onClearReference}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="移除引用"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="rounded-xl border bg-card p-3 shadow-[0_14px_38px_rgba(0,0,0,0.065)] transition duration-150 ease-out hover:border-input hover:shadow-[0_18px_46px_rgba(0,0,0,0.08)] focus-within:border-input focus-within:shadow-[0_18px_50px_rgba(0,0,0,0.09)]">
          <Textarea
            id="lesson-workbench-prompt"
            name="lesson-workbench-prompt"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="继续描述备课目标，或引用右侧产物继续生成"
            className="min-h-20 border-0 bg-transparent px-2 py-1 text-sm leading-6 shadow-none focus:ring-0"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2">
            <div className="flex min-w-0 items-center gap-2">
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" aria-label="粘贴资料">
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" aria-label="重新生成">
                <RotateCcw className="h-4 w-4" />
              </Button>
              <span className="min-w-0 truncate text-xs text-muted-foreground" aria-live="polite">
                {notice}
              </span>
            </div>
            <Button type="button" variant="default" className="h-9 rounded-lg px-3.5" onClick={onSend}>
              <CornerDownLeft className="h-4 w-4" />
              发送
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
