"use client";

import { CornerDownLeft, Paperclip, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type PromptComposerProps = {
  value: string;
  reference: string | null;
  onChange: (value: string) => void;
  onClearReference: () => void;
  onSend: () => void;
};

export function PromptComposer({ value, reference, onChange, onClearReference, onSend }: PromptComposerProps) {
  return (
    <div className="border-t bg-background px-8 py-5">
      <div className="mx-auto w-full max-w-5xl">
        {reference && (
          <div className="mb-2 inline-flex max-w-full items-start justify-between gap-3 rounded-lg border bg-card px-3 py-2">
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
        <div className="rounded-xl border bg-card p-2 shadow-sm">
          <Textarea
            id="lesson-workbench-prompt"
            name="lesson-workbench-prompt"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="继续描述备课目标，或引用右侧产物继续生成"
            className="min-h-20 border-0 bg-transparent shadow-none focus:ring-0"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1">
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="icon" aria-label="粘贴资料">
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button variant="secondary" size="icon" aria-label="重新生成">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="default" onClick={onSend}>
              <CornerDownLeft className="h-4 w-4" />
              发送
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
