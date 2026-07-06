"use client";

import { BookOpenCheck, Circle, Menu, Plus, Search } from "lucide-react";
import type { ProjectItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const projectTone = {
  active: { label: "进行中", tone: "info" as const, dot: "text-info" },
  review: { label: "待重审", tone: "warning" as const, dot: "text-warning" },
  blocked: { label: "需处理", tone: "danger" as const, dot: "text-destructive" },
  done: { label: "已完成", tone: "success" as const, dot: "text-success" },
};

type ProjectSidebarProps = {
  projects: ProjectItem[];
  activeProjectId: string;
  collapsed?: boolean;
  onToggle?: () => void;
  onSelect: (id: string) => void;
};

export function ProjectSidebar({ projects, activeProjectId, collapsed, onToggle, onSelect }: ProjectSidebarProps) {
  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col border-r bg-card/82 transition-[width] duration-150",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className={cn("border-b p-4", collapsed && "px-2")}>
        <div className={cn("flex items-center gap-2", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed && (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <BookOpenCheck className="h-5 w-5 text-bronze" />
                <h2 className="truncate text-sm font-semibold">山海媒体工作台</h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">公开课项目</p>
            </div>
          )}
          <Button variant="ghost" size="icon" onClick={onToggle} aria-label="折叠项目栏">
            <Menu className="h-4 w-4" />
          </Button>
        </div>
        {!collapsed && (
          <>
            <Button className="mt-4 w-full" variant="bronze">
              <Plus className="h-4 w-4" />
              新建项目
            </Button>
            <div className="mt-3 flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground">
              <Search className="h-4 w-4" />
              <span>搜索课题</span>
            </div>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar p-2">
        {projects.map((project) => {
          const meta = projectTone[project.status];
          const active = project.id === activeProjectId;
          return (
            <button
              key={project.id}
              type="button"
              onClick={() => onSelect(project.id)}
              className={cn(
                "mb-1 w-full rounded-lg border p-3 text-left transition duration-150 hover:border-bronze/35 hover:bg-background",
                active ? "border-bronze bg-bronze/5" : "border-transparent",
                collapsed && "flex h-11 items-center justify-center p-0",
              )}
            >
              {collapsed ? (
                <Circle className={cn("h-3 w-3 fill-current", meta.dot)} />
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 text-sm font-semibold leading-5">{project.title}</h3>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{project.meta}</p>
                  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{project.currentStep}</span>
                    <span className="shrink-0">{project.updatedAt}</span>
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

