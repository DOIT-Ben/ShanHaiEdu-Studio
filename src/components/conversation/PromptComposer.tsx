"use client";

import { useRef, type ChangeEvent, type KeyboardEvent } from "react";
import { CornerDownLeft, Paperclip, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type PromptComposerProps = {
  value: string;
  reference: string | null;
  notice: string | null;
  sending: boolean;
  onChange: (value: string) => void;
  onClearReference: () => void;
  onAttachFile: (fileName: string, text: string) => void;
  onAttachFileError: (message: string) => void;
  onSend: () => void;
};

const maxAttachmentCharacters = 12000;
const maxAttachmentBytes = 512 * 1024;

export function PromptComposer({
  value,
  reference,
  notice,
  sending,
  onChange,
  onClearReference,
  onAttachFile,
  onAttachFileError,
  onSend,
}: PromptComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onSend();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (file.size > maxAttachmentBytes) {
      onAttachFileError("这份资料太大了，请先摘取关键段落或换成 512KB 以内的文本文件。");
      return;
    }

    try {
      const text = await file.text();
      const trimmed = text.trim();
      if (!trimmed) {
        onAttachFileError("这份资料没有读取到文本内容，请换一个文本文件或直接粘贴关键内容。");
        return;
      }
      onAttachFile(file.name, trimmed.slice(0, maxAttachmentCharacters));
    } catch {
      onAttachFileError("这份资料暂时没有读取成功，请换一个文本文件或直接粘贴关键内容。");
    }
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.csv,.json,.text,text/*"
            className="hidden"
            onChange={handleFileChange}
            aria-label="选择文本资料"
          />
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
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                aria-label="粘贴资料"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" aria-label="重新生成">
                <RotateCcw className="h-4 w-4" />
              </Button>
              <span className="min-w-0 truncate text-xs text-muted-foreground" aria-live="polite">
                {notice}
              </span>
            </div>
            <Button type="button" variant="default" className="h-9 rounded-lg px-3.5" onClick={onSend} disabled={sending}>
              <CornerDownLeft className="h-4 w-4" />
              {sending ? "等待回复" : "发送"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
