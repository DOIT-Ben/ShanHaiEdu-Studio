"use client";

import { MessageCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InteractiveListRow } from "@/components/ui/interactive-list-row";
import { ProfileMenu } from "@/components/layout/ProfileMenu";
import type { PasswordAuthUser } from "@/lib/auth-api";
import type { OpenFeedback } from "@/lib/feedback-contracts";
import type { ProjectItem, WorkbenchLoadState } from "@/lib/types";

type AuthenticatedWelcomeProps = {
  currentUser: PasswordAuthUser | null;
  projects: ProjectItem[];
  loadState: WorkbenchLoadState;
  errorMessage: string | null;
  onCreateProject: () => void | Promise<boolean>;
  onSelectProject: (projectId: string) => void;
  onOpenFeedback: OpenFeedback;
  onOpenUserManagement?: () => void;
  onLogout?: () => Promise<void>;
  onOpenXiaoKuSettings?: () => void;
};

export function AuthenticatedWelcome({ currentUser, projects, loadState, errorMessage, onCreateProject, onSelectProject, onOpenFeedback, onOpenUserManagement, onLogout, onOpenXiaoKuSettings }: AuthenticatedWelcomeProps) {
  const recentProjects = projects.slice(0, 4);
  const displayName = currentUser?.displayName?.trim() || "老师";

  return (
    <main className="flex min-h-0 flex-1 overflow-y-auto bg-card" data-authenticated-welcome>
      <section className="m-auto w-full max-w-[760px] px-5 py-12 sm:px-8 lg:py-16" aria-labelledby="authenticated-welcome-title">
        <div className="mb-8 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" data-feedback-origin="global" onClick={() => onOpenFeedback({ origin: "global" })} aria-label="提交反馈">
            <MessageCircle className="h-4 w-4" />
            反馈
          </Button>
          <ProfileMenu currentUser={currentUser} compact align="end" onOpenFeedback={onOpenFeedback} onOpenUserManagement={onOpenUserManagement} onLogout={onLogout} onOpenXiaoKuSettings={onOpenXiaoKuSettings} />
        </div>
        <div className="max-w-[620px]">
          <p className="text-sm font-medium text-[#367d6d]">欢迎回来，{displayName}</p>
          <h1 id="authenticated-welcome-title" className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[34px]">
            今天想准备哪一节课？
          </h1>
          <p className="mt-4 max-w-[580px] text-sm leading-7 text-muted-foreground">
            山海课伴会陪你从教材证据、教案到 PPT 和课堂视频逐步完成。
          </p>
          <Button className="mt-7 h-11 px-5" onClick={() => void onCreateProject()}>
            <Plus className="h-4 w-4" />开始新的备课
          </Button>
        </div>

        {loadState === "loading" && <p className="mt-10 text-sm text-muted-foreground">正在取回最近项目…</p>}
        {loadState === "error" && <p className="mt-10 text-sm text-destructive">{errorMessage ?? "最近项目暂时没有取回，请稍后再试。"}</p>}

        {loadState === "ready" && recentProjects.length > 0 && (
          <div className="mt-12 border-t pt-6">
            <h2 className="text-sm font-medium text-foreground">继续最近项目</h2>
            <div className="mt-2 divide-y">
              {recentProjects.map((project) => (
                <InteractiveListRow
                  key={project.id}
                  className="min-h-[72px] gap-4"
                  title={project.title}
                  subtitle={<>{project.meta} · {project.currentStep}</>}
                  meta={project.updatedAt}
                  showArrow
                  onClick={() => onSelectProject(project.id)}
                />
              ))}
            </div>
          </div>
        )}

        {loadState === "ready" && recentProjects.length === 0 && (
          <p className="mt-10 text-sm leading-6 text-muted-foreground">还没有进行中的项目，从新的备课开始吧。</p>
        )}
      </section>
    </main>
  );
}
