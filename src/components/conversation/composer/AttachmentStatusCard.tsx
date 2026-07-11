"use client";

import { X } from "lucide-react";
import type { ComposerAttachmentCard } from "./composer-contracts";

type AttachmentStatusCardProps = {
  attachment: ComposerAttachmentCard;
  onRemove?: () => void;
};

export function AttachmentStatusCard({ attachment, onRemove }: AttachmentStatusCardProps) {
  return (
    <div className="mb-2 flex max-w-full items-start justify-between gap-3 rounded-lg border bg-muted/55 px-3 py-2" aria-live="polite">
      <div className="min-w-0 space-y-0.5 text-xs leading-5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="max-w-[220px] truncate font-medium text-foreground sm:max-w-[360px]">{attachment.fileName}</span>
          <span className="shrink-0 text-muted-foreground">{attachment.fileTypeLabel}</span>
        </div>
        <div className="text-muted-foreground">{attachment.teacherLabel}</div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={!onRemove}
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        aria-label="移除附件"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
