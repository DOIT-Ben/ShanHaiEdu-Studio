"use client";

import { BookOpen, ChevronLeft, Circle, FileText, FolderOpen, Plus, Search, Trash2 } from "lucide-react";
import type { ProjectItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const projectTone = {
  active: { label: "进行中", tone: "info" as const, dot: "text-bronze" },
  review: { label: "待重审", tone: "warning" as const, dot: "text-bronze" },
  blocked: { label: "需处理", tone: "danger" as const, dot: "text-destructive" },
  done: { label: "已完成", tone: "success" as const, dot: "text-muted-foreground" },
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
    <aside className={cn("relative flex h-full min-h-0 flex-col border-r bg-card transition-[width] duration-150", collapsed ? "w-16" : "w-72")}>
      <button
        type="button"
        onClick={onToggle}
        className="absolute -right-4 top-24 z-10 hidden h-9 w-9 items-center justify-center rounded-lg border bg-card shadow-md hover:bg-muted lg:flex"
        aria-label="折叠项目栏"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className={cn("p-5", collapsed && "px-2")}>
        <div className={cn("flex items-center gap-2", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed && (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
                  <BookOpen className="h-4 w-4" />
                </div>
                <h2 className="truncate text-base font-semibold text-primary">ShanHaiEdu 备课工作台</h2>
              </div>
            </div>
          )}
        </div>
        {!collapsed && (
          <>
            <Button className="mt-8 w-full" variant="default">
              <Plus className="h-4 w-4" />
              新建项目
            </Button>
            <div className="mt-6 flex h-10 items-center gap-2 rounded-lg border bg-background px-3 text-sm text-muted-foreground">
              <Search className="h-4 w-4" />
              <span>搜索课题</span>
            </div>
            <div className="mt-8 flex items-center justify-between text-sm font-medium">
              <span className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-bronze" />
                公开课备课
              </span>
              <span className="text-muted-foreground">⌃</span>
            </div>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar px-4">
        {projects.map((project) => {
          const meta = projectTone[project.status];
          const active = project.id === activeProjectId;
          return (
            <button
              key={project.id}
              type="button"
              onClick={() => onSelect(project.id)}
              className={cn(
                "mb-2 w-full rounded-lg border border-transparent p-4 text-left transition duration-150 hover:bg-muted",
                active ? "bg-primary/5 text-primary" : "bg-transparent",
                collapsed && "flex h-11 items-center justify-center p-0",
              )}
            >
              {collapsed ? (
                <Circle className={cn("h-3 w-3 fill-current", meta.dot)} />
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <h3 className="line-clamp-2 text-sm font-semibold leading-5">{project.title}</h3>
                    </div>
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
      {!collapsed && (
        <div className="p-5">
          <Button variant="secondary" className="w-full justify-start">
            <Trash2 className="h-4 w-4" />
            回收站
          </Button>
        </div>
      )}
    </aside>
  );
}
