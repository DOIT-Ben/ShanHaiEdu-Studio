"use client";

import { useRef, useState } from "react";
import { BookOpen, FileText, Image, PackageCheck, Presentation, Video } from "lucide-react";
import type { ArtifactItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ArtifactPreviewCard } from "@/components/artifacts/ArtifactPreviewCard";
import { getArtifactStatusMeta } from "@/components/artifacts/artifact-status";

const iconByTitle = {
  教材证据包: BookOpen,
  教案: FileText,
  导入视频策划卡: Video,
  "PPT 草稿": Presentation,
  图片提示词: Image,
  视频分镜: Video,
  最终交付: PackageCheck,
};

type ArtifactNodeCardProps = {
  item: ArtifactItem;
  active?: boolean;
  variant?: "rail" | "drawer";
  onCopy: (item: ArtifactItem) => void;
  onUseAsInput: (item: ArtifactItem) => void;
  onOpen: (item: ArtifactItem) => void;
};

export function ArtifactNodeCard({
  item,
  active,
  variant = "rail",
  onCopy,
  onUseAsInput,
  onOpen,
}: ArtifactNodeCardProps) {
  const meta = getArtifactStatusMeta(item.status);
  const [previewOpen, setPreviewOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const Icon = iconByTitle[item.title as keyof typeof iconByTitle] ?? FileText;

  function openPreview() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setPreviewOpen(true);
  }

  function closePreviewSoon() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setPreviewOpen(false), 360);
  }

  if (variant === "drawer") {
    return (
      <button
        type="button"
        onClick={() => onOpen(item)}
        className={cn(
          "w-full rounded-md px-3 py-3 text-left transition duration-150 ease-out hover:bg-[#ebebeb]",
          active && "bg-[#e9e9e9]",
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{item.title}</div>
              <div className={cn("mt-0.5 line-clamp-1 text-xs text-muted-foreground", !active && "hidden")}>{item.summary}</div>
            </div>
          </div>
          {active && <Badge tone={meta.tone}>{meta.label}</Badge>}
        </div>
      </button>
    );
  }

  return (
    <Popover open={previewOpen} onOpenChange={setPreviewOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${item.title}，${meta.label}`}
          onMouseEnter={openPreview}
          onMouseLeave={closePreviewSoon}
          onFocus={openPreview}
          onBlur={closePreviewSoon}
          onClick={() => {
            setPreviewOpen(false);
            onOpen(item);
          }}
          className={cn(
            "group flex h-10 w-10 items-center justify-center rounded-xl outline-none transition duration-150 ease-out hover:-translate-x-0.5 hover:bg-[#f3f3f3] focus:ring-2 focus:ring-ring/35",
            active && "bg-[#eeeeee]",
          )}
        >
          <span
            className={cn(
              "relative flex h-7 w-7 items-center justify-center rounded-full border bg-card transition group-hover:border-input",
              active && "border-input bg-card shadow-[0_2px_8px_rgba(0,0,0,0.05)]",
            )}
          >
            <Icon className={cn("h-3.5 w-3.5", active ? "text-foreground" : "text-muted-foreground")} />
            {active && <span className={cn("absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-card", meta.dot)} />}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="center"
        sideOffset={12}
        className="artifact-preview-popover w-[350px] border-border bg-card shadow-[0_12px_32px_rgba(0,0,0,0.08)]"
        onMouseEnter={openPreview}
        onMouseLeave={closePreviewSoon}
      >
        <ArtifactPreviewCard item={item} onCopy={onCopy} onUseAsInput={onUseAsInput} onOpen={onOpen} />
      </PopoverContent>
    </Popover>
  );
}
