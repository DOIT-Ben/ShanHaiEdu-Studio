"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, Circle, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ProjectItem, ProjectLifecycleAction, ProjectLifecycleMutation } from "@/lib/types";
import { cn } from "@/lib/utils";

const projectTone = {
  active: { label: "进行中", dot: "text-muted-foreground" },
  review: { label: "待重审", dot: "text-muted-foreground" },
  blocked: { label: "需处理", dot: "text-destructive" },
  done: { label: "已完成", dot: "text-muted-foreground" },
};

type ProjectListItemProps = {
  project: ProjectItem;
  active: boolean;
  collapsed: boolean;
  selectable: boolean;
  onSelect: (projectId: string) => void;
  onMutate: (projectId: string, mutation: ProjectLifecycleMutation) => Promise<unknown>;
  onRequestAction: (project: ProjectItem, action: "archive" | "trash") => void;
};

export function ProjectListItem({ project, active, collapsed, selectable, onSelect, onMutate, onRequestAction }: ProjectListItemProps) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(project.title);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurRef = useRef(false);
  const meta = projectTone[project.status];
  const canRename = project.lifecycleState === "active";

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startRename() {
    if (!canRename || submitting) return;
    setDraftTitle(project.title);
    setError(null);
    setEditing(true);
  }

  async function commitRename() {
    if (!editing || submitting) return;
    const title = draftTitle.trim();
    if (!title || title.length > 80) {
      setError("项目名称需为 1 到 80 个字符。");
      return;
    }
    if (title === project.title) {
      setEditing(false);
      return;
    }
    setSubmitting(true);
    try {
      await onMutate(project.id, { action: "rename", title, expectedLifecycleVersion: project.lifecycleVersion });
      setEditing(false);
    } catch {
      setError("项目名称没有保存，请刷新后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  function cancelRename() {
    skipBlurRef.current = true;
    setDraftTitle(project.title);
    setError(null);
    setEditing(false);
    window.setTimeout(() => {
      skipBlurRef.current = false;
    }, 0);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      skipBlurRef.current = true;
      void commitRename().finally(() => {
        window.setTimeout(() => {
          skipBlurRef.current = false;
        }, 0);
      });
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  }

  function request(action: "archive" | "trash") {
    if (submitting) return;
    setMenuOpen(false);
    onRequestAction(project, action);
  }

  async function restore() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onMutate(project.id, { action: "restore", expectedLifecycleVersion: project.lifecycleVersion });
    } finally {
      setSubmitting(false);
      setMenuOpen(false);
    }
  }

  return (
    <div className={cn("group relative mb-0.5 rounded-md", collapsed && "flex justify-center") } data-project-id={project.id}>
      {collapsed ? (
        <button type="button" onClick={() => selectable && onSelect(project.id)} className="flex h-11 w-11 items-center justify-center rounded-md transition hover:bg-[#eeeeef]" aria-label={project.title}>
          <Circle className={cn("h-3 w-3 fill-current", meta.dot)} />
        </button>
      ) : editing ? (
        <div className="rounded-md bg-[#edf5f2] p-2">
          <input
            ref={inputRef}
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (!skipBlurRef.current) void commitRename();
            }}
            maxLength={80}
            aria-label="项目名称"
            className="h-8 w-full rounded-md border border-[#367d6d] bg-card px-2 text-sm text-foreground outline-none ring-2 ring-[#367d6d]/35"
          />
          {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => selectable && onSelect(project.id)}
            onDoubleClick={startRename}
            disabled={!selectable}
            aria-current={active ? "page" : undefined}
            className={cn(
              "w-full rounded-md px-3 py-2 pr-16 text-left transition duration-150 ease-out hover:bg-[#eeeeef] focus:outline-none focus:ring-2 focus:ring-[#367d6d]/45 disabled:cursor-default disabled:hover:bg-transparent",
              active ? "bg-[#ededee] text-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.02)]" : "bg-transparent text-foreground",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Circle className={cn("h-3 w-3 shrink-0 fill-current", meta.dot)} />
              <h3 className="truncate text-sm font-normal leading-5">{project.title}</h3>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate">{active ? project.currentStep : project.meta}</span>
              <span className="shrink-0">{active ? project.updatedAt : meta.label}</span>
            </div>
          </button>
          <div className="absolute right-1 top-1 flex opacity-100 transition lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
            {canRename && (
              <Button type="button" variant="ghost" size="icon" aria-label="重命名项目" title="重命名项目" onClick={startRename} disabled={submitting}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="项目操作" title="项目操作" disabled={submitting}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-40 rounded-md p-1.5">
                {project.lifecycleState === "active" ? (
                  <>
                    <button type="button" onClick={() => request("archive")} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted">
                      <Archive className="h-4 w-4" />归档
                    </button>
                    <button type="button" onClick={() => request("trash")} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-destructive hover:bg-destructive/5">
                      <Trash2 className="h-4 w-4" />移入回收站
                    </button>
                  </>
                ) : project.lifecycleState === "archived" ? (
                  <>
                    <button type="button" onClick={() => void restore()} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted">
                      <RotateCcw className="h-4 w-4" />恢复项目
                    </button>
                    <button type="button" onClick={() => request("trash")} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-destructive hover:bg-destructive/5">
                      <Trash2 className="h-4 w-4" />移入回收站
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => void restore()} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted">
                    <RotateCcw className="h-4 w-4" />恢复项目
                  </button>
                )}
              </PopoverContent>
            </Popover>
          </div>
        </>
      )}
    </div>
  );
}
