"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import { CheckCircle2, CornerDownLeft, Image, Paperclip, RotateCcw, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AttachmentStatusCard } from "@/components/conversation/composer/AttachmentStatusCard";
import {
  buildComposerAttachmentCard,
  getComposerToolMenuItems,
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
  const attachmentRequestIdRef = useRef(0);
  const previousComposerSubmittingRef = useRef(false);
  const [attachment, setAttachment] = useState<ComposerAttachmentCard | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  useAutoResizeTextarea(textareaRef, value, { minRows: 2, maxRows: 8 });

  function cancelPendingAttachmentRead() {
    attachmentRequestIdRef.current += 1;
  }

  useEffect(() => {
    if (!attachment?.canUseAsReference) return;
    if (composerSubmitting) return;
    if (!reference || !reference.startsWith(`资料《${attachment.fileName}》`)) {
      cancelPendingAttachmentRead();
      setAttachment(null);
    }
  }, [attachment, composerSubmitting, reference]);

  useEffect(() => {
    if (previousComposerSubmittingRef.current && !composerSubmitting && !reference && !value.trim()) {
      setAttachment(null);
    }
    previousComposerSubmittingRef.current = composerSubmitting;
  }, [composerSubmitting, reference, value]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (composerSubmitting) return;
    handleSubmit();
  }

  function handleSubmit() {
    if (attachment?.status === "pending_parse") {
      onAttachFileError("这份资料还在读取，请稍候再发送。");
      return;
    }
    onSend();
  }

  function clearAttachment() {
    cancelPendingAttachmentRead();
    if (attachment?.canUseAsReference) onClearReference();
    setAttachment(null);
  }

  async function attachLocalFile(file: File) {
    if (!file) return;
    if (composerSubmitting) {
      onAttachFileError("正在发送中，请等本轮发送完成后再添加资料。");
      return;
    }
    const requestId = attachmentRequestIdRef.current + 1;
    attachmentRequestIdRef.current = requestId;
    if (attachment?.canUseAsReference) onClearReference();

    const fileName = file.name || "粘贴截图.png";
    const kind = getComposerAttachmentKind(file);
    if (kind === "image_reference") {
      setAttachment(buildComposerAttachmentCard({ fileName, mimeType: file.type, status: "visual_reference" }));
      return;
    }

    if (kind === "rich_document") {
      setAttachment(buildComposerAttachmentCard({ fileName, mimeType: file.type, status: "needs_manual_summary" }));
      onAttachFileError("PDF 或 Word 暂不能自动读取，请摘取关键内容、另存为文本，或直接粘贴要参考的段落。");
      return;
    }

    if (kind === "unsupported") {
      setAttachment(buildComposerAttachmentCard({ fileName, mimeType: file.type, status: "unsupported" }));
      onAttachFileError("这类资料暂不能直接读取，请换成文本资料、截图，或直接粘贴关键内容。");
      return;
    }

    setAttachment(buildComposerAttachmentCard({ fileName, mimeType: file.type, status: "pending_parse" }));

    if (file.size > maxAttachmentBytes) {
      setAttachment(buildComposerAttachmentCard({ fileName, mimeType: file.type, status: "parse_failed" }));
      onAttachFileError("这份资料太大了，请先摘取关键段落或换成 512KB 以内的文本文件。");
      return;
    }

    try {
      const text = await file.text();
      if (attachmentRequestIdRef.current !== requestId) return;
      const trimmed = text.trim();
      if (!trimmed) {
        setAttachment(buildComposerAttachmentCard({ fileName, mimeType: file.type, status: "parse_failed" }));
        onAttachFileError("这份资料没有读取到文本内容，请换一个文本文件或直接粘贴关键内容。");
        return;
      }
      const clipped = trimmed.slice(0, maxAttachmentCharacters);
      const status = trimmed.length > maxAttachmentCharacters ? "readable_truncated" : "readable";
      setAttachment(buildComposerAttachmentCard({ fileName, mimeType: file.type, status }));
      onAttachFile(fileName, clipped);
    } catch {
      if (attachmentRequestIdRef.current !== requestId) return;
      setAttachment(buildComposerAttachmentCard({ fileName, mimeType: file.type, status: "parse_failed" }));
      onAttachFileError("这份资料暂时没有读取成功，请换一个文本文件或直接粘贴关键内容。");
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await attachLocalFile(file);
  }

  function hasDraggedFiles(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    setDraggingFile(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDraggingFile(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDraggingFile(false);
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    setDraggingFile(false);
    if (composerSubmitting) {
      onAttachFileError("正在发送中，请等本轮发送完成后再添加资料。");
      return;
    }
    const file = event.dataTransfer.files?.[0];
    if (file) await attachLocalFile(file);
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageFile = Array.from(event.clipboardData.files).find((file) => getComposerAttachmentKind(file) === "image_reference");
    if (!imageFile) return;
    event.preventDefault();
    if (composerSubmitting) {
      onAttachFileError("正在发送中，请等本轮发送完成后再添加资料。");
      return;
    }
    await attachLocalFile(imageFile);
  }

  return (
    <div className="bg-card px-4 pb-4 pt-3 sm:px-8">
      <div className="mx-auto w-full max-w-[980px]">
        {attachment && <AttachmentStatusCard attachment={attachment} onRemove={composerSubmitting ? undefined : clearAttachment} />}
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
        <div
          className="relative rounded-xl border bg-card p-3 shadow-[0_14px_38px_rgba(0,0,0,0.065)] transition duration-150 ease-out hover:border-input hover:shadow-[0_18px_46px_rgba(0,0,0,0.08)] focus-within:border-input focus-within:shadow-[0_18px_50px_rgba(0,0,0,0.09)]"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {draggingFile && (
            <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border border-dashed border-foreground/30 bg-card/92 text-sm font-medium text-foreground">
              松开后添加到本轮备课要求
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.markdown,.csv,.json,.text,.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,text/*,application/pdf,image/*"
            className="hidden"
            onChange={handleFileChange}
            aria-label="选择资料"
            disabled={composerSubmitting}
          />
          <Textarea
            ref={textareaRef}
            id="lesson-workbench-prompt"
            name="lesson-workbench-prompt"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
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
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    aria-label="工具和资料"
                    title="工具和资料"
                  >
                    <Wrench className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(360px,calc(100vw-32px))] p-2">
                  <div className="px-2 pb-2 pt-1 text-xs font-medium text-muted-foreground">工具和资料</div>
                  <div className="space-y-1">
                    {getComposerToolMenuItems().map((item) => (
                      <ComposerToolMenuRow
                        key={item.label}
                        item={item}
                        onAttachFile={() => fileInputRef.current?.click()}
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
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
            <Button type="button" variant="default" className="h-9 rounded-lg px-3.5" onClick={handleSubmit} disabled={composerSubmitting}>
              <CornerDownLeft className="h-4 w-4" />
              {composerSubmitting ? "发送中" : projectBusy ? "加入队列" : "发送"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ComposerToolMenuRow({
  item,
  onAttachFile,
}: {
  item: ReturnType<typeof getComposerToolMenuItems>[number];
  onAttachFile: () => void;
}) {
  const icon = item.enabled ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Image className="mt-0.5 h-3.5 w-3.5 shrink-0" />;
  const content = (
    <>
      {icon}
      <div className="min-w-0">
        <div className="font-medium">{item.label}</div>
        <div className="text-muted-foreground">{item.description}</div>
      </div>
    </>
  );

  if (item.action === "attach_file") {
    return (
      <button
        type="button"
        className="flex w-full gap-2 rounded-md px-2 py-2 text-left text-xs leading-5 text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onAttachFile}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={`flex gap-2 rounded-md px-2 py-2 text-xs leading-5 ${item.enabled ? "text-foreground" : "text-muted-foreground opacity-70"}`} aria-disabled={!item.enabled}>
      {content}
    </div>
  );
}
