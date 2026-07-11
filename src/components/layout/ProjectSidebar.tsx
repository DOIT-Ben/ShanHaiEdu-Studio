"use client";

import { useMemo, useState } from "react";
import { Archive, ChevronDown, ChevronLeft, FolderOpen, Plus, Search, Trash2 } from "lucide-react";
import type { PasswordAuthUser } from "@/lib/auth-api";
import type { OpenFeedback } from "@/lib/feedback-contracts";
import type { ProjectItem, ProjectLifecycleMutation, ProjectLifecycleState } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { ProjectLifecycleConfirmDialog } from "@/components/layout/ProjectLifecycleConfirmDialog";
import { ProjectListItem } from "@/components/layout/ProjectListItem";

type ProjectSidebarProps = {
  projects: ProjectItem[];
  activeProjectId: string;
  view?: ProjectLifecycleState;
  collapsed?: boolean;
  onToggle?: () => void;
  onSelect: (id: string) => void;
  onViewChange?: (view: ProjectLifecycleState) => void;
  onMutateProject?: (projectId: string, mutation: ProjectLifecycleMutation) => Promise<unknown>;
  onCreateProject?: () => void;
  currentUser?: PasswordAuthUser | null;
  onOpenFeedback?: OpenFeedback;
  onOpenUserManagement?: () => void;
  onLogout?: () => Promise<void>;
};

export function ProjectSidebar({
  projects,
  activeProjectId,
  view = "active",
  collapsed,
  onToggle,
  onSelect,
  onViewChange,
  onMutateProject,
  onCreateProject,
  currentUser,
  onOpenFeedback,
  onOpenUserManagement,
  onLogout,
}: ProjectSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [courseSectionOpen, setCourseSectionOpen] = useState(true);
  const [pendingProject, setPendingProject] = useState<ProjectItem | null>(null);
  const [pendingAction, setPendingAction] = useState<"archive" | "trash" | null>(null);
  const [mutationSubmitting, setMutationSubmitting] = useState(false);
  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) => `${project.title} ${project.currentStep} ${project.meta}`.toLowerCase().includes(query));
  }, [projects, searchQuery]);
  const sectionTitle = view === "active" ? "公开课备课" : view === "archived" ? "已归档" : "回收站";

  async function confirmLifecycleAction() {
    if (!pendingProject || !pendingAction || !onMutateProject) return;
    setMutationSubmitting(true);
    try {
      await onMutateProject(pendingProject.id, { action: pendingAction, expectedLifecycleVersion: pendingProject.lifecycleVersion });
      setPendingProject(null);
      setPendingAction(null);
    } finally {
      setMutationSubmitting(false);
    }
  }

  return (
    <aside className={cn("relative flex h-full min-h-0 flex-col border-r bg-[#f8f8f9] transition-[width] duration-200 ease-out", collapsed ? "w-16" : "w-72")}>
      <button type="button" onClick={onToggle} className="absolute -right-4 top-24 z-10 hidden h-9 w-9 items-center justify-center rounded-lg border bg-card transition hover:bg-[#f1f1f2] lg:flex" aria-label="折叠项目栏">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className={cn("px-3 py-4", collapsed && "px-2")}>
        <div className={cn("flex items-center gap-2", collapsed ? "justify-center" : "justify-between")}>
          {!collapsed && (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-md border bg-card text-muted-foreground">
                  <img src="/brand/shanhai-ai-logo-256.png" alt="" className="h-full w-full object-cover" />
                </div>
                <h2 className="truncate text-sm font-medium text-foreground">ShanHaiEdu 备课工作台</h2>
              </div>
            </div>
          )}
        </div>
        {!collapsed && (
          <>
            <Button className="mt-7 w-full justify-start border-transparent bg-transparent px-3 font-normal text-foreground hover:bg-[#eeeeef]" variant="ghost" onClick={onCreateProject}>
              <Plus className="h-4 w-4" />新建项目
            </Button>
            <label className="mt-2 flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition focus-within:bg-card focus-within:ring-2 focus-within:ring-[#367d6d]/45 hover:bg-[#eeeeef]">
              <Search className="h-4 w-4" />
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索课题" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
            </label>
            <button
              type="button"
              aria-expanded={courseSectionOpen}
              aria-label={view === "active" ? "折叠项目列表" : "返回进行中的项目"}
              onClick={() => {
                if (view !== "active") {
                  onViewChange?.("active");
                  return;
                }
                setCourseSectionOpen((value) => !value);
              }}
              className="mt-6 flex h-9 w-full items-center justify-between rounded-md px-3 text-sm text-foreground transition hover:bg-[#eeeeef] focus:outline-none focus:ring-2 focus:ring-[#367d6d]/45"
            >
              <span className="flex items-center gap-2"><FolderOpen className="h-4 w-4 text-muted-foreground" />{sectionTitle}</span>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !courseSectionOpen && "-rotate-90")} />
            </button>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar px-2">
        {courseSectionOpen && filteredProjects.length === 0 && !collapsed && <div className="rounded-md px-3 py-3 text-xs leading-5 text-muted-foreground">没有找到匹配项目</div>}
        {(collapsed || courseSectionOpen) && filteredProjects.map((project) => (
          <ProjectListItem
            key={project.id}
            project={project}
            active={project.id === activeProjectId}
            collapsed={Boolean(collapsed)}
            selectable={view === "active"}
            onSelect={onSelect}
            onMutate={onMutateProject ?? (async () => undefined)}
            onRequestAction={(item, action) => {
              setPendingProject(item);
              setPendingAction(action);
            }}
          />
        ))}
      </div>
      <div className="mt-auto border-t px-2 py-2">
        <div className={cn("space-y-0.5", collapsed && "flex flex-col items-center")}>
          <Button variant="ghost" size={collapsed ? "icon" : "default"} title="已归档" onClick={() => onViewChange?.("archived")} className={cn("justify-start border-transparent bg-transparent font-normal hover:bg-[#eeeeef]", view === "archived" && "bg-[#ededee]", collapsed && "justify-center")}>
            <Archive className="h-4 w-4" />{!collapsed && "已归档"}
          </Button>
          <Button variant="ghost" size={collapsed ? "icon" : "default"} title="回收站" onClick={() => onViewChange?.("trash")} className={cn("justify-start border-transparent bg-transparent font-normal hover:bg-[#eeeeef]", view === "trash" && "bg-[#ededee]", collapsed && "justify-center")}>
            <Trash2 className="h-4 w-4" />{!collapsed && "回收站"}
          </Button>
        </div>
        {onOpenFeedback && (
          <div className="mt-2 border-t pt-2">
            <ProfileMenu currentUser={currentUser} projectId={activeProjectId || undefined} compact={collapsed} onOpenFeedback={onOpenFeedback} onOpenUserManagement={onOpenUserManagement} onLogout={onLogout} />
          </div>
        )}
      </div>
      <ProjectLifecycleConfirmDialog
        project={pendingProject}
        action={pendingAction}
        submitting={mutationSubmitting}
        onOpenChange={(open) => {
          if (!open && !mutationSubmitting) {
            setPendingProject(null);
            setPendingAction(null);
          }
        }}
        onConfirm={() => void confirmLifecycleAction()}
      />
    </aside>
  );
}
