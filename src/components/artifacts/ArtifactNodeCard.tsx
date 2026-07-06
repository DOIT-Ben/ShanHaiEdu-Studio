"use client";

import { useState } from "react";
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
  const Icon = iconByTitle[item.title as keyof typeof iconByTitle] ?? FileText;

  if (variant === "drawer") {
    return (
      <button
        type="button"
        onClick={() => onOpen(item)}
        className={cn(
          "w-full rounded-lg px-3 py-3 text-left transition hover:bg-muted",
          active && "bg-muted",
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", meta.dot)} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{item.title}</div>
              <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.summary}</div>
            </div>
          </div>
          <Badge tone={meta.tone}>{meta.label}</Badge>
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
          onMouseEnter={() => setPreviewOpen(true)}
          onMouseLeave={() => setPreviewOpen(false)}
          onFocus={() => setPreviewOpen(true)}
          onBlur={() => setPreviewOpen(false)}
          onClick={() => {
            setPreviewOpen(false);
            onOpen(item);
          }}
          className="group grid w-full grid-cols-[34px_1fr] items-center gap-2 rounded-full py-1.5 pr-1 text-left outline-none transition duration-150 hover:bg-muted/70 focus:ring-2 focus:ring-ring/35"
        >
          <span
            className={cn(
              "relative flex h-8 w-8 items-center justify-center rounded-full border bg-card transition",
              active && "border-input bg-muted",
            )}
          >
            <Icon className={cn("h-4 w-4", active ? "text-foreground" : "text-muted-foreground")} />
            <span className={cn("absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-card", meta.dot)} />
          </span>
          <span className={cn("truncate text-sm", active ? "font-semibold text-foreground" : "text-muted-foreground")}>
            {item.title.replace("策划卡", "").replace("提示词", "")}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="center"
        className="w-[350px] border-border bg-card shadow-[0_12px_32px_rgba(0,0,0,0.08)]"
        onMouseEnter={() => setPreviewOpen(true)}
        onMouseLeave={() => setPreviewOpen(false)}
      >
        <ArtifactPreviewCard item={item} onCopy={onCopy} onUseAsInput={onUseAsInput} onOpen={onOpen} />
      </PopoverContent>
    </Popover>
  );
}
