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
    <div className="border-t bg-card/90 p-4">
      {reference && (
        <div className="mb-2 flex items-start justify-between gap-3 rounded-lg border border-bronze/25 bg-bronze/5 px-3 py-2">
          <div className="min-w-0 text-xs leading-5 text-foreground">
            <span className="font-medium text-bronze">已引用上游产物：</span>
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
      <div className="rounded-xl border bg-background p-2 shadow-sm">
        <Textarea
          id="lesson-workbench-prompt"
          name="lesson-workbench-prompt"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="告诉我下一步想怎么改，例如：导入视频更有故事感，但不要提前讲三角形定义。"
          className="min-h-20 border-0 bg-transparent shadow-none focus:ring-0"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm">
              <Paperclip className="h-4 w-4" />
              粘贴资料
            </Button>
            <Button variant="ghost" size="sm">
              <RotateCcw className="h-4 w-4" />
              重新生成
            </Button>
          </div>
          <Button variant="bronze" onClick={onSend}>
            <CornerDownLeft className="h-4 w-4" />
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}
