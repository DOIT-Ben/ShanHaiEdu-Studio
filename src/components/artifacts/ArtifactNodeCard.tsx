"use client";

import { useState } from "react";
import { Clipboard, ExternalLink, RotateCcw, SendToBack } from "lucide-react";
import type { ArtifactItem, ArtifactStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const statusMeta: Record<ArtifactStatus, { label: string; tone: "neutral" | "success" | "warning" | "info" | "danger" | "bronze"; dot: string }> = {
  approved: { label: "已确认", tone: "success", dot: "bg-success" },
  needs_review: { label: "待确认", tone: "warning", dot: "bg-warning" },
  in_progress: { label: "生成中", tone: "bronze", dot: "bg-bronze" },
  blocked: { label: "需处理", tone: "danger", dot: "bg-destructive" },
  stale: { label: "需重审", tone: "warning", dot: "bg-warning" },
  not_started: { label: "未开始", tone: "neutral", dot: "bg-muted-foreground/45" },
};

type ArtifactNodeCardProps = {
  item: ArtifactItem;
  active?: boolean;
  onCopy: (item: ArtifactItem) => void;
  onUseAsInput: (item: ArtifactItem) => void;
  onOpen: (item: ArtifactItem) => void;
  onRegenerate: (item: ArtifactItem) => void;
};

export function ArtifactNodeCard({
  item,
  active,
  onCopy,
  onUseAsInput,
  onOpen,
  onRegenerate,
}: ArtifactNodeCardProps) {
  const meta = statusMeta[item.status];
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <Popover open={previewOpen} onOpenChange={setPreviewOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseEnter={() => setPreviewOpen(true)}
          onMouseLeave={() => setPreviewOpen(false)}
          onFocus={() => setPreviewOpen(true)}
          onBlur={() => setPreviewOpen(false)}
          onClick={() => {
            setPreviewOpen(false);
            onOpen(item);
          }}
          className={cn(
            "group w-full rounded-lg border bg-card p-3 text-left transition duration-150 hover:-translate-y-0.5 hover:border-bronze/40 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/35",
            active ? "border-bronze bg-bronze/5" : "border-border",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)} />
                <h3 className="truncate text-sm font-semibold text-foreground">{item.title}</h3>
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.summary}</p>
            </div>
            <Badge tone={meta.tone} className="shrink-0">
              {meta.label}
            </Badge>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{item.updatedAt}</span>
            <span className={cn(item.reusable ? "text-success" : "text-muted-foreground")}>
              {item.reusable ? "可作下步输入" : "暂不可复用"}
            </span>
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[21.5rem]" onMouseEnter={() => setPreviewOpen(true)} onMouseLeave={() => setPreviewOpen(false)}>
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold">{item.title}</h4>
              <Badge tone={meta.tone}>{meta.label}</Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.summary}</p>
          </div>
          <div className="space-y-2">
            {item.previewFields.map((field) => (
              <div key={field.label} className="rounded-md border bg-background px-2.5 py-2">
                <div className="text-[11px] font-medium text-muted-foreground">{field.label}</div>
                <div className="mt-0.5 text-xs leading-5 text-foreground">{field.value}</div>
              </div>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">
            上一步来源：{item.sourceTitles.length ? item.sourceTitles.join("、") : "当前项目配置"}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="secondary" size="sm" disabled={!item.actions.canCopy} onClick={() => onCopy(item)}>
                  <Clipboard className="h-3.5 w-3.5" />
                  复制
                </Button>
              </TooltipTrigger>
              <TooltipContent>复制关键内容</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="secondary" size="sm" disabled={!item.actions.canUseAsInput} onClick={() => onUseAsInput(item)}>
                  <SendToBack className="h-3.5 w-3.5" />
                  作为输入
                </Button>
              </TooltipTrigger>
              <TooltipContent>插入到下方输入框</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="secondary" size="sm" onClick={() => onOpen(item)}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  详情
                </Button>
              </TooltipTrigger>
              <TooltipContent>查看完整产物</TooltipContent>
            </Tooltip>
          </div>
          {item.actions.canRegenerate && (
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => onRegenerate(item)}>
              <RotateCcw className="h-3.5 w-3.5" />
              保留旧内容并重做
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
