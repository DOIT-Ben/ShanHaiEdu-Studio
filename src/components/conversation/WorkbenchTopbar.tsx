"use client";

import { CheckCircle2, ListTree, MessageSquareText, MoreHorizontal, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import { cn } from "@/lib/utils";
import type { PasswordAuthUser } from "@/lib/auth-api";
import type { OpenFeedback } from "@/lib/feedback-contracts";
import type { ProjectItem } from "@/lib/types";

type WorkbenchTopbarProps = {
  project?: ProjectItem | null;
  currentUser?: PasswordAuthUser | null;
  compact?: boolean;
  onOpenArtifacts?: () => void;
  onOpenFeedback?: OpenFeedback;
  onLogout?: () => Promise<void>;
};

export function WorkbenchTopbar({ project, currentUser, compact = false, onOpenArtifacts, onOpenFeedback, onLogout }: WorkbenchTopbarProps) {
  const projectTitle = project?.title ?? "未选择项目";
  const savedLabel = project?.updatedAt ? `已保存 ${project.updatedAt}` : "未保存";

  return (
    <div data-workbench-topbar-compact={compact ? "true" : "false"} className={cn("flex items-center justify-between px-6 py-6 lg:px-8", compact ? "gap-2" : "gap-4")}>
      <nav className={cn("flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap text-sm text-muted-foreground", compact ? "gap-2" : "gap-4")} aria-label="当前位置">
        <span className="shrink-0">ShanHaiEdu</span>
        <span className="shrink-0">/</span>
        {!compact && (
          <>
            <span className="shrink-0">公开课备课</span>
            <span className="shrink-0">/</span>
          </>
        )}
        <span className="truncate font-medium text-foreground">{projectTitle}</span>
      </nav>
      <div className="flex shrink-0 items-center gap-2">
        {currentUser && (
          <span className="hidden max-w-[160px] truncate text-sm text-muted-foreground sm:inline">
            {currentUser.displayName}
          </span>
        )}
        <div className="hidden h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-muted-foreground shadow-sm sm:inline-flex" aria-label={savedLabel}>
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          <span className={cn(compact && "sr-only")}>{savedLabel}</span>
        </div>
        <Button disabled title="协作稍后开放" variant="secondary" size="sm" className="hidden sm:inline-flex">
          <Users className="h-4 w-4" />
          <span className={cn(compact && "sr-only")}>协作</span>
        </Button>
        {onOpenArtifacts && (
          <Button variant="secondary" size="sm" className="hidden sm:inline-flex" onClick={onOpenArtifacts}>
            <ListTree className="h-4 w-4" />
            <span className={cn(compact && "sr-only")}>产物</span>
          </Button>
        )}
        {onOpenFeedback && (
          <Button
            variant="secondary"
            size="sm"
            data-feedback-origin="global"
            onClick={() => onOpenFeedback({ origin: "global", projectId: project?.id })}
            aria-label="提交反馈"
          >
            <MessageSquareText className="h-4 w-4" />
            <span className="hidden sm:inline">反馈</span>
          </Button>
        )}
        {onOpenFeedback && (
          <ProfileMenu
            currentUser={currentUser}
            projectId={project?.id}
            onOpenFeedback={onOpenFeedback}
            onLogout={onLogout}
            compact
            align="end"
            className="h-9 w-9 lg:hidden"
          />
        )}
        <Button variant="secondary" size="icon" aria-label="更多产物操作" onClick={onOpenArtifacts} disabled={!onOpenArtifacts}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
