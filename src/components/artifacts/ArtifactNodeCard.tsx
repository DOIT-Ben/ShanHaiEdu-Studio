"use client";

import { BookOpen, FileText, Image, PackageCheck, Presentation, Video } from "lucide-react";
import type { ArtifactItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { getArtifactStatusMeta } from "@/components/artifacts/artifact-status";
import { InteractiveListRow } from "@/components/ui/interactive-list-row";

const iconByTitle = {
  教材证据包: BookOpen,
  教案: FileText,
  "PPT 大纲": Presentation,
  "PPT 大纲与逐页脚本": Presentation,
  导入视频策划卡: Video,
  "PPT 草稿": Presentation,
  课堂视觉图: Image,
  视频分镜: Video,
  最终交付: PackageCheck,
};

type ArtifactNodeCardProps = {
  item: ArtifactItem;
  active?: boolean;
  variant?: "rail" | "drawer";
  onOpen: (item: ArtifactItem) => void;
  onPreviewStart?: (item: ArtifactItem) => void;
  onPreviewEnd?: () => void;
};

export function ArtifactNodeCard({
  item,
  active,
  variant = "rail",
  onOpen,
  onPreviewStart,
  onPreviewEnd,
}: ArtifactNodeCardProps) {
  const meta = getArtifactStatusMeta(item.status);
  const Icon = iconByTitle[item.title as keyof typeof iconByTitle] ?? FileText;

  if (variant === "drawer") {
    return (
      <InteractiveListRow
        aria-label={`${item.title}，${meta.label}`}
        onClick={() => onOpen(item)}
        selected={active}
        leading={<span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#d7ebe5] bg-white text-muted-foreground"><Icon className="h-4 w-4" /></span>}
        title={item.title}
        subtitle={item.summary}
        meta={meta.label}
        showArrow
        compact
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`${item.title}，${meta.label}`}
      onMouseEnter={() => onPreviewStart?.(item)}
      onMouseLeave={onPreviewEnd}
      onFocus={() => onPreviewStart?.(item)}
      onBlur={onPreviewEnd}
      onClick={() => onOpen(item)}
      className={cn(
        "group flex h-10 w-10 items-center justify-center rounded-xl outline-none transition duration-150 ease-out hover:-translate-x-0.5 hover:bg-[#eef8f5] focus:ring-2 focus:ring-[#8fcbbb]/35",
        active && "bg-[#eef8f5]",
      )}
    >
      <span
        className={cn(
          "relative flex h-7 w-7 items-center justify-center rounded-full border border-[#d7ebe5] bg-card transition group-hover:border-[#8fcbbb]",
          active && "border-[#8fcbbb] bg-card shadow-[0_2px_8px_rgba(29,74,66,0.08)]",
        )}
      >
        <Icon className={cn("h-3.5 w-3.5", active ? "text-foreground" : "text-muted-foreground")} />
        {active && <span className={cn("absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-card", meta.dot)} />}
      </span>
    </button>
  );
}
