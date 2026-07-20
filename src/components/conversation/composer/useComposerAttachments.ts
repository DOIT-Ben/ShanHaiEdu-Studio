"use client";

import { useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent } from "react";
import {
  buildComposerAttachmentCard,
  getComposerAttachmentKind,
  hasCompletedComposerAttachmentSubmission,
  type ComposerAttachmentCard,
  type ComposerAttachmentSubmissionSnapshot,
} from "@/components/conversation/composer/composer-contracts";

const maxAttachmentCharacters = 12000;
const maxAttachmentBytes = 512 * 1024;

type ComposerAttachmentsOptions = {
  value: string;
  reference: string | null;
  composerSubmitting: boolean;
  onClearReference: () => void;
  onAttachFile: (fileName: string, text: string) => void;
  onAttachFileError: (message: string) => void;
};

export function useComposerAttachments({ value, reference, composerSubmitting, onClearReference, onAttachFile, onAttachFileError }: ComposerAttachmentsOptions) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentRequestIdRef = useRef(0);
  const [attachment, setAttachment] = useState<ComposerAttachmentCard | null>(null);
  const [attachmentSubmission, setAttachmentSubmission] = useState<ComposerAttachmentSubmissionSnapshot | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);
  const attachmentReferenceMatches = Boolean(attachment?.canUseAsReference && reference?.startsWith(`资料《${attachment.fileName}》`));
  const attachmentWasSubmitted = hasCompletedComposerAttachmentSubmission({ snapshot: attachmentSubmission, value, reference, composerSubmitting });
  const visibleAttachment = attachmentWasSubmitted || (attachment?.canUseAsReference && !composerSubmitting && !attachmentReferenceMatches) ? null : attachment;
  const cancelPendingAttachmentRead = () => { attachmentRequestIdRef.current += 1; };
  const clearAttachment = () => {
    cancelPendingAttachmentRead();
    if (visibleAttachment?.canUseAsReference) onClearReference();
    setAttachment(null);
    setAttachmentSubmission(null);
  };
  const attachLocalFile = async (file: File) => {
    if (!file) return;
    if (composerSubmitting) {
      onAttachFileError("正在发送中，请等本轮发送完成后再添加资料。");
      return;
    }
    const requestId = ++attachmentRequestIdRef.current;
    setAttachmentSubmission(null);
    if (visibleAttachment?.canUseAsReference) onClearReference();
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
      setAttachment(buildComposerAttachmentCard({ fileName, mimeType: file.type, status: trimmed.length > maxAttachmentCharacters ? "readable_truncated" : "readable" }));
      onAttachFile(fileName, clipped);
    } catch {
      if (attachmentRequestIdRef.current !== requestId) return;
      setAttachment(buildComposerAttachmentCard({ fileName, mimeType: file.type, status: "parse_failed" }));
      onAttachFileError("这份资料暂时没有读取成功，请换一个文本文件或直接粘贴关键内容。");
    }
  };
  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await attachLocalFile(file);
  };
  const hasDraggedFiles = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes("Files");
  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    setDraggingFile(true);
  };
  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDraggingFile(true);
  };
  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFile(false);
  };
  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    setDraggingFile(false);
    const file = event.dataTransfer.files?.[0];
    if (file) await attachLocalFile(file);
  };
  const handlePaste = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFile = Array.from(event.clipboardData.files).find((file) => getComposerAttachmentKind(file) === "image_reference");
    if (!imageFile) return;
    event.preventDefault();
    await attachLocalFile(imageFile);
  };
  return { fileInputRef, visibleAttachment, draggingFile, setAttachmentSubmission, handleFileChange, handleDragEnter, handleDragOver, handleDragLeave, handleDrop, handlePaste, clearAttachment };
}
