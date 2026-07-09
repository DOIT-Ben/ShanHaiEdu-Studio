"use client";

import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { CornerDownLeft, Paperclip, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AttachmentStatusCard } from "@/components/conversation/composer/AttachmentStatusCard";
import {
  buildComposerAttachmentCard,
  getComposerAttachmentKind,
  type ComposerAttachmentCard,
} from "@/components/conversation/composer/composer-contracts";
import { useAutoResizeTextarea } from "@/components/conversation/composer/useAutoResizeTextarea";

type PromptComposerProps = {
  value: string;
  reference: string | null;
  notice: string | null;
  composerSubmitting: boolean;
  projectBusy: boolean;
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
  composerSubmitting,
  projectBusy,
  onChange,
  onClearReference,
  onAttachFile,
  onAttachFileError,
  onSend,
}: PromptComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [attachment, setAttachment] = useState<ComposerAttachmentCard | null>(null);
  useAutoResizeTextarea(textareaRef, value, { minRows: 2, maxRows: 8 });

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (composerSubmitting) return;
    onSend();
  }

  function clearAttachment() {
    if (attachment?.canUseAsReference) onClearReference();
    setAttachment(null);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (attachment?.canUseAsReference) onClearReference();

    const kind = getComposerAttachmentKind(file);
    if (kind === "unsupported") {
      setAttachment(buildComposerAttachmentCard({ fileName: file.name, mimeType: file.type, status: "unsupported" }));
      onAttachFileError("这类资料暂不能直接读取，请换成文本资料或直接粘贴关键内容。");
      return;
    }

    setAttachment(buildComposerAttachmentCard({ fileName: file.name, mimeType: file.type, status: "pending_parse" }));

    if (file.size > maxAttachmentBytes) {
      setAttachment(buildComposerAttachmentCard({ fileName: file.name, mimeType: file.type, status: "parse_failed" }));
      onAttachFileError("这份资料太大了，请先摘取关键段落或换成 512KB 以内的文本文件。");
      return;
    }

    try {
      const text = await file.text();
      const trimmed = text.trim();
      if (!trimmed) {
        setAttachment(buildComposerAttachmentCard({ fileName: file.name, mimeType: file.type, status: "parse_failed" }));
        onAttachFileError("这份资料没有读取到文本内容，请换一个文本文件或直接粘贴关键内容。");
        return;
      }
      setAttachment(buildComposerAttachmentCard({ fileName: file.name, mimeType: file.type, status: "readable" }));
      onAttachFile(file.name, trimmed.slice(0, maxAttachmentCharacters));
    } catch {
      setAttachment(buildComposerAttachmentCard({ fileName: file.name, mimeType: file.type, status: "parse_failed" }));
      onAttachFileError("这份资料暂时没有读取成功，请换一个文本文件或直接粘贴关键内容。");
    }
  }

  return (
    <div className="bg-card px-4 pb-4 pt-3 sm:px-8">
      <div className="mx-auto w-full max-w-[980px]">
        {attachment && <AttachmentStatusCard attachment={attachment} onRemove={clearAttachment} />}
        {reference && !attachment?.canUseAsReference && (
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
            accept=".txt,.md,.markdown,.csv,.json,.text,.pdf,.doc,.docx,text/*,application/pdf"
            className="hidden"
            onChange={handleFileChange}
            aria-label="选择文本资料"
            disabled={composerSubmitting}
          />
          <Textarea
            ref={textareaRef}
            id="lesson-workbench-prompt"
            name="lesson-workbench-prompt"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={composerSubmitting}
            aria-label={projectBusy ? "正在生成中，也可以继续输入下一步要求" : "输入备课要求"}
            className="min-h-20 border-0 bg-transparent px-2 py-1 text-sm leading-6 shadow-none focus:ring-0"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2">
            <div className="flex min-w-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                aria-label="添加资料"
                onClick={() => fileInputRef.current?.click()}
                disabled={composerSubmitting}
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                aria-label="重新生成"
                title="请在产物详情中调整后重做"
                disabled
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <span className="min-w-0 truncate text-xs text-muted-foreground" aria-live="polite">
                {notice ?? (projectBusy ? "正在生成中，你可以继续输入下一条要求。" : null)}
              </span>
            </div>
            <Button type="button" variant="default" className="h-9 rounded-lg px-3.5" onClick={onSend} disabled={composerSubmitting}>
              <CornerDownLeft className="h-4 w-4" />
              {composerSubmitting ? "发送中" : projectBusy ? "加入队列" : "发送"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
