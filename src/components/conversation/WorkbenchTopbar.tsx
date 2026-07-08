"use client";

import { CheckCircle2, ListTree, LogOut, MoreHorizontal, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PasswordAuthUser } from "@/lib/auth-api";
import type { ProjectItem } from "@/lib/types";

type WorkbenchTopbarProps = {
  project?: ProjectItem | null;
  currentUser?: PasswordAuthUser | null;
  onOpenArtifacts?: () => void;
  onLogout?: () => Promise<void>;
};

export function WorkbenchTopbar({ project, currentUser, onOpenArtifacts, onLogout }: WorkbenchTopbarProps) {
  const projectTitle = project?.title ?? "未选择项目";
  const savedLabel = project?.updatedAt ? `已保存 ${project.updatedAt}` : "未保存";

  return (
    <div className="flex items-center justify-between gap-4 px-6 py-6 lg:px-8">
      <nav className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden whitespace-nowrap text-sm text-muted-foreground" aria-label="当前位置">
        <span className="shrink-0">ShanHaiEdu</span>
        <span className="shrink-0">/</span>
        <span className="shrink-0">公开课备课</span>
        <span className="shrink-0">/</span>
        <span className="truncate font-medium text-foreground">{projectTitle}</span>
      </nav>
      <div className="flex shrink-0 items-center gap-2">
        {currentUser && (
          <span className="hidden max-w-[160px] truncate text-sm text-muted-foreground sm:inline">
            {currentUser.displayName}
          </span>
        )}
        <Button variant="secondary" size="sm" className="hidden sm:inline-flex">
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          {savedLabel}
        </Button>
        <Button variant="secondary" size="sm" className="hidden sm:inline-flex">
          <Users className="h-4 w-4" />
          协作
        </Button>
        {onOpenArtifacts && (
          <Button variant="secondary" size="sm" className="hidden sm:inline-flex" onClick={onOpenArtifacts}>
            <ListTree className="h-4 w-4" />
            产物
          </Button>
        )}
        {onLogout && (
          <Button variant="secondary" size="sm" onClick={() => void onLogout()}>
            <LogOut className="h-4 w-4" />
            退出登录
          </Button>
        )}
        <Button variant="secondary" size="icon" aria-label="更多">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
