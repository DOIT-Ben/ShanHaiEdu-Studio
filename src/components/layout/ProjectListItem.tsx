"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, Circle, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InteractiveListRow } from "@/components/ui/interactive-list-row";
import { Input } from "@/components/ui/input";
import { MenuItem } from "@/components/ui/menu-item";
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
        <button type="button" disabled={!selectable} onClick={() => onSelect(project.id)} className="flex h-11 w-11 items-center justify-center rounded-md transition-colors enabled:hover:bg-[#eeeeef] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-default disabled:opacity-55" aria-label={project.title}>
          <Circle className={cn("h-3 w-3 fill-current", meta.dot)} />
        </button>
      ) : editing ? (
        <div className="rounded-md bg-[#edf5f2] p-2">
          <Input
            ref={inputRef}
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (!skipBlurRef.current) void commitRename();
            }}
            maxLength={80}
            aria-label="项目名称"
            inputSize="sm"
          />
          {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
      ) : (
        <div className={cn(
          "grid grid-cols-[minmax(0,1fr)_68px] items-stretch overflow-hidden rounded-lg border border-transparent transition-colors duration-150 hover:border-[#b9d8cf] hover:bg-[#eaf5f1] focus-within:border-[#b9d8cf] focus-within:bg-[#eaf5f1]",
          active && "border-[#b9d8cf] bg-[#eaf5f1]",
        )}>
          <InteractiveListRow
              onClick={() => selectable && onSelect(project.id)}
              onDoubleClick={startRename}
              disabled={!selectable}
              aria-current={active ? "page" : undefined}
              active={active}
              attention={project.status === "blocked"}
              leading={<Circle className={cn("h-3 w-3 fill-current", meta.dot)} />}
              title={project.title}
              subtitle={<>{active ? project.currentStep : project.meta}<span className="mx-1 text-border">·</span>{active ? project.updatedAt : meta.label}</>}
              compact
              className="rounded-r-none border-0 bg-transparent enabled:hover:border-0 enabled:hover:bg-transparent"
            />
          <div className="flex items-center justify-end gap-1 px-1 opacity-100 transition-opacity duration-150 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
            {canRename && (
              <button
                type="button"
                aria-label="重命名项目"
                title="重命名项目"
                onClick={startRename}
                disabled={submitting}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent bg-transparent text-muted-foreground transition-[background-color,border-color,color] hover:border-[#b9d8cf] hover:bg-[#eaf5f1] hover:text-[#167467] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#68a999]/45 disabled:pointer-events-none disabled:opacity-45"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            <Popover open={menuOpen} onOpenChange={setMenuOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="项目操作"
                  title="项目操作"
                  disabled={submitting}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent bg-transparent text-muted-foreground transition-[background-color,border-color,color] hover:border-[#d7e4e0] hover:bg-[#f2f4f3] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#68a999]/45 disabled:pointer-events-none disabled:opacity-45"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-40 rounded-md p-1.5">
                {project.lifecycleState === "active" ? (
                  <>
                    <MenuItem icon={<Archive className="h-4 w-4" />} onClick={() => request("archive")}>归档</MenuItem>
                    <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onClick={() => request("trash")}>移入回收站</MenuItem>
                  </>
                ) : project.lifecycleState === "archived" ? (
                  <>
                    <MenuItem icon={<RotateCcw className="h-4 w-4" />} onClick={() => void restore()}>恢复项目</MenuItem>
                    <MenuItem danger icon={<Trash2 className="h-4 w-4" />} onClick={() => request("trash")}>移入回收站</MenuItem>
                  </>
                ) : (
                  <MenuItem icon={<RotateCcw className="h-4 w-4" />} onClick={() => void restore()}>恢复项目</MenuItem>
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}
    </div>
  );
}
