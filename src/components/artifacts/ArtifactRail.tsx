"use client";

import { useMemo, useState } from "react";
import { BookOpen, Grid2X2, Image, PackageCheck, Presentation, Video } from "lucide-react";
import type { ArtifactItem } from "@/lib/types";
import {
  artifactCapabilityGroups,
  getArtifactGroupActivation,
  groupArtifacts,
  needsArtifactAttention,
  type ArtifactCapabilityGroupId,
} from "@/components/artifacts/artifact-capability-groups";
import { ArtifactNodeCard } from "@/components/artifacts/ArtifactNodeCard";
import { getArtifactStatusMeta } from "@/components/artifacts/artifact-status";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type DrawerFilter = "all" | ArtifactCapabilityGroupId;

type ArtifactRailProps = {
  items: ArtifactItem[];
  activeKey: string;
  variant?: "rail" | "drawer";
  initialGroup?: DrawerFilter;
  onCopy: (item: ArtifactItem) => void;
  onUseAsInput: (item: ArtifactItem) => void;
  onOpen: (item: ArtifactItem) => void;
  onOpenGroup?: (group: DrawerFilter) => void;
};

const iconByGroup = {
  lesson: BookOpen,
  ppt: Presentation,
  image: Image,
  video: Video,
  delivery: PackageCheck,
};

export function ArtifactRail({
  items,
  activeKey,
  variant = "rail",
  initialGroup = "all",
  onCopy,
  onUseAsInput,
  onOpen,
  onOpenGroup,
}: ArtifactRailProps) {
  const [filterSelection, setFilterSelection] = useState(() => ({ initialGroup, filter: initialGroup }));
  const filter = filterSelection.initialGroup === initialGroup ? filterSelection.filter : initialGroup;
  const setFilter = (nextFilter: DrawerFilter) => setFilterSelection({ initialGroup, filter: nextFilter });
  const groups = useMemo(() => groupArtifacts(items), [items]);
  const attentionCount = items.filter((item) => needsArtifactAttention(item.status)).length;

  const visibleItems = filter === "all"
    ? items
    : groups.find((group) => group.id === filter)?.items ?? [];

  if (variant === "drawer") {
    const filterLabel = artifactCapabilityGroups.find((group) => group.id === filter)?.label;
    return (
      <aside className="flex h-full min-h-0 flex-col bg-[#fcfdfd]">
        <div className="border-b border-[#e3ece9] px-5 pb-3 pt-5 pr-12">
          <h2 className="text-base font-semibold tracking-tight">备课成果</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            共 {items.length} 项{attentionCount > 0 ? ` · ${attentionCount} 项需处理` : " · 暂无待处理"}
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5" aria-label="按能力筛选备课成果">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>全部</FilterChip>
            {artifactCapabilityGroups.map((group) => (
              <FilterChip key={group.id} active={filter === group.id} onClick={() => setFilter(group.id)}>
                {group.label}
              </FilterChip>
            ))}
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-1 p-3">
            {items.length === 0 ? (
              <EmptyState title="还没有备课成果" description="完成教案、PPT、图片或视频后，成果会集中显示在这里。" />
            ) : visibleItems.length === 0 ? (
              <EmptyState title={`暂无${filterLabel ?? "此类"}成果`} description="可以切换到其他能力，或回到对话继续备课。" />
            ) : visibleItems.map((item) => (
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

  function activateGroup(groupId: ArtifactCapabilityGroupId, groupItems: ArtifactItem[]) {
    const activation = getArtifactGroupActivation(groupItems);
    if (activation.mode === "direct") onOpen(activation.item);
    else onOpenGroup?.(groupId);
  }

  return (
    <aside className="flex h-full items-center justify-center border-l border-[#e3ece9] bg-[#fcfdfd]">
      <nav className="flex w-full flex-col items-center gap-1.5 px-2 py-4" aria-label="备课成果能力导航">
        {groups.map((group) => {
          const Icon = iconByGroup[group.id];
          const meta = getArtifactStatusMeta(group.status);
          const active = group.items.some((item) => item.key === activeKey);
          const statusText = group.attentionCount > 0 ? `${group.attentionCount} 项需处理` : meta.label;
          const label = `${group.label}，${group.items.length} 项，${statusText}`;
          return (
            <Tooltip key={group.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={label}
                  onClick={() => activateGroup(group.id, group.items)}
                  className={cn(
                    "relative flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground outline-none transition-colors hover:bg-[#eef5f3] hover:text-foreground focus-visible:ring-2 focus-visible:ring-[#8fcbbb]/35",
                    active && "bg-[#eaf3f0] text-foreground",
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                  <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-[#e4eeeb] px-1 text-center text-[10px] font-semibold leading-4 text-[#315f55]">
                    {group.items.length}
                  </span>
                  {group.attentionCount > 0 && <span className="absolute bottom-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-[#9b4a4a]" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">{label}</TooltipContent>
            </Tooltip>
          );
        })}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`全部产物，${items.length} 项${attentionCount > 0 ? `，${attentionCount} 项需处理` : ""}`}
              onClick={() => onOpenGroup?.("all")}
              className="relative flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground outline-none transition-colors hover:bg-[#eef5f3] hover:text-foreground focus-visible:ring-2 focus-visible:ring-[#8fcbbb]/35"
            >
              <Grid2X2 className="h-[18px] w-[18px]" />
              <span className="sr-only">全部产物</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">全部产物 · {items.length} 项</TooltipContent>
        </Tooltip>
      </nav>
    </aside>
  );
}

function FilterChip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1.5 text-xs text-muted-foreground outline-none transition-colors hover:bg-[#eef5f3] hover:text-foreground focus-visible:ring-2 focus-visible:ring-[#8fcbbb]/35",
        active && "bg-[#e7f1ee] font-medium text-[#315f55]",
      )}
    >
      {children}
    </button>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-5 py-12 text-center">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <p className="mx-auto mt-2 max-w-[260px] text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}
