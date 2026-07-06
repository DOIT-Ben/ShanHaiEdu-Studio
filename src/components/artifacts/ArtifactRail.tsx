"use client";

import { useRef, useState } from "react";
import type { ArtifactItem } from "@/lib/types";
import { ArtifactNodeCard } from "@/components/artifacts/ArtifactNodeCard";
import { ArtifactPreviewCard } from "@/components/artifacts/ArtifactPreviewCard";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ArtifactRailProps = {
  items: ArtifactItem[];
  activeKey: string;
  variant?: "rail" | "drawer";
  onCopy: (item: ArtifactItem) => void;
  onUseAsInput: (item: ArtifactItem) => void;
  onOpen: (item: ArtifactItem) => void;
  onRegenerate: (item: ArtifactItem) => void;
};

export function ArtifactRail({
  items,
  activeKey,
  variant = "rail",
  onCopy,
  onUseAsInput,
  onOpen,
}: ArtifactRailProps) {
  const [filter, setFilter] = useState("all");
  const [previewItem, setPreviewItem] = useState<ArtifactItem | null>(null);
  const closeTimer = useRef<number | null>(null);
  const visibleItems = items.filter((item) => {
    if (filter === "reusable") return item.reusable;
    if (filter === "review") return ["needs_review", "blocked", "stale"].includes(item.status);
    return true;
  });

  function openPreview(item: ArtifactItem) {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setPreviewItem((current) => (current?.key === item.key ? current : item));
  }

  function keepPreviewOpen() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }

  function closePreviewSoon() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setPreviewItem(null), 620);
  }

  if (variant === "drawer") {
    return (
      <aside className="flex h-full min-h-0 flex-col bg-[#f7f7f7]">
        <div className="border-b px-5 py-4">
          <h2 className="title-md">线性产物</h2>
          <p className="mt-1 text-xs text-muted-foreground">点击查看详情，确认后复用到下一步。</p>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="mt-3 w-full">
              <SelectValue placeholder="筛选节点" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部节点</SelectItem>
              <SelectItem value="reusable">只看可复用</SelectItem>
              <SelectItem value="review">待确认与需处理</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 p-3">
            {visibleItems.map((item) => (
              <ArtifactNodeCard
                key={item.key}
                item={item}
                active={item.key === activeKey}
                variant="drawer"
                onCopy={onCopy}
                onUseAsInput={onUseAsInput}
                onOpen={onOpen}
              />
            ))}
          </div>
        </ScrollArea>
      </aside>
    );
  }

  return (
    <aside className="relative flex h-full items-center justify-center border-l bg-card">
      <div className="relative flex w-full flex-col items-center gap-2 px-2 py-4">
        <span className="absolute bottom-8 left-1/2 top-8 w-px -translate-x-1/2 bg-border" />
        {visibleItems.map((item, index) => (
          <div key={item.key} className="relative z-10">
            <ArtifactNodeCard
              item={item}
              active={item.key === activeKey}
              onCopy={onCopy}
              onUseAsInput={onUseAsInput}
              onOpen={onOpen}
              onPreviewStart={openPreview}
              onPreviewEnd={closePreviewSoon}
            />
          </div>
        ))}
      </div>
      {previewItem && (
        <div
          className="artifact-preview-popover absolute right-full top-1/2 z-40 mr-3 w-[350px] -translate-y-1/2 rounded-lg border bg-card p-3 text-card-foreground shadow-[0_12px_32px_rgba(0,0,0,0.08)] outline-none"
          onMouseEnter={keepPreviewOpen}
          onMouseLeave={closePreviewSoon}
        >
          <ArtifactPreviewCard item={previewItem} onCopy={onCopy} onUseAsInput={onUseAsInput} onOpen={onOpen} />
        </div>
      )}
    </aside>
  );
}
