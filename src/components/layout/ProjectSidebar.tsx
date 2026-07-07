"use client";

import { BookOpen, ChevronDown, ChevronLeft, Circle, FileText, FolderOpen, Plus, Search, Trash2 } from "lucide-react";
import type { ProjectItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const projectTone = {
  active: { label: "进行中", dot: "text-muted-foreground" },
  review: { label: "待重审", dot: "text-muted-foreground" },
  blocked: { label: "需处理", dot: "text-destructive" },
  done: { label: "已完成", dot: "text-muted-foreground" },
};

type ProjectSidebarProps = {
  projects: ProjectItem[];
  activeProjectId: string;
  collapsed?: boolean;
  onToggle?: () => void;
  onSelect: (id: string) => void;
  onCreateProject?: () => void;
};

export function ProjectSidebar({ projects, activeProjectId, collapsed, onToggle, onSelect, onCreateProject }: ProjectSidebarProps) {
  return (
    <aside className={cn("relative flex h-full min-h-0 flex-col border-r bg-[#f8f8f9] transition-[width] duration-200 ease-out", collapsed ? "w-16" : "w-72")}>
      <button
        type="button"
        onClick={onToggle}
        className="absolute -right-4 top-24 z-10 hidden h-9 w-9 items-center justify-center rounded-lg border bg-card transition hover:bg-[#f1f1f2] lg:flex"
        aria-label="折叠项目栏"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className={cn("px-3 py-4", collapsed && "px-2")}>
        <div className={cn("flex items-center gap-2", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed && (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md border bg-card text-muted-foreground">
                  <BookOpen className="h-4 w-4" />
                </div>
                <h2 className="truncate text-sm font-medium text-foreground">ShanHaiEdu 备课工作台</h2>
              </div>
            </div>
          )}
        </div>
        {!collapsed && (
          <>
            <Button
              className="mt-7 w-full justify-start border-transparent bg-transparent px-3 font-normal text-foreground hover:bg-[#eeeeef]"
              variant="ghost"
              onClick={onCreateProject}
            >
              <Plus className="h-4 w-4" />
              新建项目
            </Button>
            <div className="mt-2 flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition hover:bg-[#eeeeef]">
              <Search className="h-4 w-4" />
              <span>搜索课题</span>
            </div>
            <div className="mt-6 flex h-9 items-center justify-between rounded-md px-3 text-sm text-foreground transition hover:bg-[#eeeeef]">
              <span className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                公开课备课
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </div>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar px-2">
        {projects.map((project) => {
          const meta = projectTone[project.status];
          const active = project.id === activeProjectId;
          return (
            <button
              key={project.id}
              type="button"
              onClick={() => onSelect(project.id)}
              className={cn(
                "group mb-0.5 w-full rounded-md px-3 py-2 text-left transition duration-150 ease-out hover:bg-[#eeeeef]",
                active ? "bg-[#ededee] text-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.02)]" : "bg-transparent text-foreground",
                collapsed && "flex h-11 items-center justify-center p-0",
              )}
            >
              {collapsed ? (
                <Circle className={cn("h-3 w-3 fill-current", meta.dot)} />
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <h3 className="truncate text-sm font-normal leading-5">{project.title}</h3>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{active ? project.currentStep : project.meta}</span>
                    <span className="shrink-0">{active ? project.updatedAt : meta.label}</span>
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>
      {!collapsed && (
        <div className="px-3 py-4">
          <Button variant="ghost" className="w-full justify-start border-transparent bg-transparent font-normal hover:bg-[#eeeeef]">
            <Trash2 className="h-4 w-4" />
            回收站
          </Button>
        </div>
      )}
    </aside>
  );
}
