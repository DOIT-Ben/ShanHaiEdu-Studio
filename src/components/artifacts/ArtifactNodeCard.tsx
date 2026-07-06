"use client";

import { useState } from "react";
import { Clipboard, ExternalLink, SendToBack } from "lucide-react";
import type { ArtifactItem, ArtifactStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const statusMeta: Record<ArtifactStatus, { label: string; tone: "neutral" | "success" | "warning" | "info" | "danger" | "bronze"; dot: string }> = {
  approved: { label: "已确认", tone: "success", dot: "bg-[#9aa2ad]" },
  needs_review: { label: "待确认", tone: "bronze", dot: "bg-bronze" },
  in_progress: { label: "生成中", tone: "info", dot: "bg-[#9aa2ad]" },
  blocked: { label: "需处理", tone: "danger", dot: "bg-[#9b4a4a]" },
  stale: { label: "需重审", tone: "bronze", dot: "bg-bronze" },
  not_started: { label: "未开始", tone: "neutral", dot: "bg-[#c9ced6]" },
};

type ArtifactNodeCardProps = {
  item: ArtifactItem;
  active?: boolean;
  variant?: "rail" | "drawer";
  onCopy: (item: ArtifactItem) => void;
  onUseAsInput: (item: ArtifactItem) => void;
  onOpen: (item: ArtifactItem) => void;
};

function PreviewCard({
  item,
  onCopy,
  onUseAsInput,
  onOpen,
}: {
  item: ArtifactItem;
  onCopy: (item: ArtifactItem) => void;
  onUseAsInput: (item: ArtifactItem) => void;
  onOpen: (item: ArtifactItem) => void;
}) {
  const meta = statusMeta[item.status];

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-foreground">{item.title}</h4>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.summary}</p>
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>
      <div className="space-y-2">
        {item.previewFields.slice(0, 3).map((field) => (
          <div key={field.label} className="rounded-md bg-muted/70 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{field.label}</div>
            <div className="mt-0.5 line-clamp-2 text-xs leading-5 text-foreground">{field.value}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={!item.actions.canCopy} onClick={() => onCopy(item)}>
          <Clipboard className="h-3.5 w-3.5" />
          复制
        </Button>
        <Button variant="secondary" size="sm" disabled={!item.actions.canUseAsInput} onClick={() => onUseAsInput(item)}>
          <SendToBack className="h-3.5 w-3.5" />
          作为输入
        </Button>
        <Button variant="default" size="sm" onClick={() => onOpen(item)}>
          <ExternalLink className="h-3.5 w-3.5" />
          详情
        </Button>
      </div>
    </div>
  );
}

export function ArtifactNodeCard({
  item,
  active,
  variant = "rail",
  onCopy,
  onUseAsInput,
  onOpen,
}: ArtifactNodeCardProps) {
  const meta = statusMeta[item.status];
  const [previewOpen, setPreviewOpen] = useState(false);

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
          className={cn(
            "relative flex h-7 w-7 items-center justify-center rounded-full outline-none transition duration-150 hover:scale-110 focus:ring-2 focus:ring-ring/35",
            active && "bg-muted",
          )}
        >
          <span className={cn("h-2.5 w-2.5 rounded-full shadow-sm", meta.dot, active && "h-3 w-3")} />
          {active && <span className="absolute h-7 w-7 rounded-full border border-bronze/50" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="center"
        className="w-[350px] border-border bg-card/98 shadow-xl"
        onMouseEnter={() => setPreviewOpen(true)}
        onMouseLeave={() => setPreviewOpen(false)}
      >
        <PreviewCard item={item} onCopy={onCopy} onUseAsInput={onUseAsInput} onOpen={onOpen} />
      </PopoverContent>
    </Popover>
  );
}
