"use client";

import { useState } from "react";
import type { ArtifactItem } from "@/lib/types";
import { ArtifactNodeCard } from "@/components/artifacts/ArtifactNodeCard";
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
  const visibleItems = items.filter((item) => {
    if (filter === "reusable") return item.reusable;
    if (filter === "review") return ["needs_review", "blocked", "stale"].includes(item.status);
    return true;
  });

  if (variant === "drawer") {
    return (
      <aside className="flex h-full min-h-0 flex-col bg-card">
        <div className="border-b px-5 py-4">
          <h2 className="title-md">线性产物</h2>
          <p className="mt-1 text-xs text-muted-foreground">点击节点查看详情，确认后再作为下一步输入。</p>
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
    <aside className="flex h-full items-center justify-center border-l bg-card">
      <div className="relative flex w-[104px] flex-col gap-1 rounded-[26px] border bg-card px-2 py-4">
        <span className="absolute left-[25px] top-7 bottom-7 w-px bg-border" />
        {visibleItems.map((item, index) => (
          <div key={item.key} className="relative z-10">
            <ArtifactNodeCard
              item={item}
              active={item.key === activeKey}
              onCopy={onCopy}
              onUseAsInput={onUseAsInput}
              onOpen={onOpen}
            />
          </div>
        ))}
      </div>
    </aside>
  );
}
