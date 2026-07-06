"use client";

import { useState } from "react";
import { Filter, PackageOpen } from "lucide-react";
import type { ArtifactItem } from "@/lib/types";
import { ArtifactNodeCard } from "@/components/artifacts/ArtifactNodeCard";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ArtifactRailProps = {
  items: ArtifactItem[];
  activeKey: string;
  onCopy: (item: ArtifactItem) => void;
  onUseAsInput: (item: ArtifactItem) => void;
  onOpen: (item: ArtifactItem) => void;
  onRegenerate: (item: ArtifactItem) => void;
};

export function ArtifactRail({ items, activeKey, onCopy, onUseAsInput, onOpen, onRegenerate }: ArtifactRailProps) {
  const [filter, setFilter] = useState("all");
  const visibleItems = items.filter((item) => {
    if (filter === "reusable") return item.reusable;
    if (filter === "review") return ["needs_review", "blocked", "stale"].includes(item.status);
    return true;
  });

  return (
    <aside className="flex h-full min-h-0 flex-col border-l bg-card/70">
      <div className="border-b p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="title-md">线性产物</h2>
            <p className="mt-1 text-xs text-muted-foreground">已确认内容会成为下一步输入</p>
          </div>
          <Button variant="secondary" size="icon" aria-label="筛选节点">
            <Filter className="h-4 w-4" />
          </Button>
        </div>
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
        <div className="space-y-2 p-3">
          {visibleItems.map((item) => (
            <ArtifactNodeCard
              key={item.key}
              item={item}
              active={item.key === activeKey}
              onCopy={onCopy}
              onUseAsInput={onUseAsInput}
              onOpen={onOpen}
              onRegenerate={onRegenerate}
            />
          ))}
        </div>
      </ScrollArea>
      <div className="border-t p-3">
        <div className="flex items-start gap-2 rounded-lg border bg-background p-3 text-xs leading-5 text-muted-foreground">
          <PackageOpen className="mt-0.5 h-4 w-4 shrink-0 text-bronze" />
          <span>最终交付前会统一检查教案、PPT、导入视频、讲稿和检查清单。</span>
        </div>
      </div>
    </aside>
  );
}
