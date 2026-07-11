"use client";

import { useState } from "react";
import { ListTree } from "lucide-react";
import { PasswordAuthGate } from "@/components/auth/PasswordAuthGate";
import { ArtifactDetailSheet } from "@/components/artifacts/ArtifactDetailSheet";
import { ArtifactRail } from "@/components/artifacts/ArtifactRail";
import { ArtifactSidePanel } from "@/components/artifacts/ArtifactSidePanel";
import { AdminUserManagementDialog } from "@/components/admin/AdminUserManagementDialog";
import { ProjectMembersDialog } from "@/components/admin/ProjectMembersDialog";
import { ConversationWorkbench } from "@/components/conversation/ConversationWorkbench";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { ProjectSidebar } from "@/components/layout/ProjectSidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { PasswordAuthUser } from "@/lib/auth-api";
import { useFeedbackController } from "@/hooks/useFeedbackController";
import { usePasswordAuth } from "@/hooks/usePasswordAuth";
import { useWorkbenchController } from "@/hooks/useWorkbenchController";

export function MediaWorkbench() {
  const auth = usePasswordAuth();
  if (auth.enabled && auth.mode !== "authenticated") {
    if (auth.mode === "checking") {
      return (
        <main className="flex min-h-screen items-center justify-center bg-card text-sm text-muted-foreground">
          正在确认登录状态...
        </main>
      );
    }
    return (
      <PasswordAuthGate
        errorMessage={auth.errorMessage}
        submitting={auth.submitting}
        onLogin={auth.login}
        onRegister={auth.register}
      />
    );
  }

  return <AuthenticatedMediaWorkbench currentUser={auth.user} onLogout={auth.enabled ? auth.logout : undefined} />;
}

function AuthenticatedMediaWorkbench({ currentUser, onLogout }: { currentUser: PasswordAuthUser | null; onLogout?: () => Promise<void> }) {
  const controller = useWorkbenchController();
  const feedbackController = useFeedbackController();
  const [projectSheetOpen, setProjectSheetOpen] = useState(false);
  const [userManagementOpen, setUserManagementOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);

  function selectProjectFromSheet(projectId: string) {
    controller.selectProject(projectId);
    setProjectSheetOpen(false);
  }

  function createProjectFromSheet() {
    controller.createProject();
    setProjectSheetOpen(false);
  }

  function openDetailFromRail(item: Parameters<typeof controller.openDetail>[0]) {
    controller.openDetail(item);
    controller.setRailOpen(false);
  }

  return (
    <TooltipProvider delayDuration={180}>
      <div className="h-screen overflow-hidden">
        <div className="flex h-full">
          <div className="hidden lg:block">
            <ProjectSidebar
               projects={controller.projects}
               activeProjectId={controller.activeProjectId}
               view={controller.projectView}
               collapsed={controller.sidebarCollapsed}
               onToggle={() => controller.setSidebarCollapsed((value) => !value)}
               onSelect={controller.selectProject}
               onViewChange={controller.openProjectView}
               onMutateProject={controller.mutateProjectLifecycle}
              onCreateProject={controller.createProject}
              currentUser={currentUser}
              onOpenFeedback={feedbackController.openFeedback}
              onOpenUserManagement={() => setUserManagementOpen(true)}
              onLogout={onLogout}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b bg-card px-3 py-2 lg:hidden">
              <Sheet open={projectSheetOpen} onOpenChange={setProjectSheetOpen}>
                <SheetTrigger asChild>
                  <Button variant="secondary" size="sm">项目</Button>
                </SheetTrigger>
                <SheetContent side="right" className="max-w-[300px]">
                  <SheetTitle className="sr-only">项目列表</SheetTitle>
                  <ProjectSidebar
                    projects={controller.projects}
                    activeProjectId={controller.activeProjectId}
                    view={controller.projectView}
                    onSelect={selectProjectFromSheet}
                    onViewChange={controller.openProjectView}
                    onMutateProject={controller.mutateProjectLifecycle}
                    onCreateProject={createProjectFromSheet}
                  />
                </SheetContent>
              </Sheet>
              <Button variant="secondary" size="sm" onClick={() => controller.setRailOpen(true)}>
                <ListTree className="h-4 w-4" />
                产物
              </Button>
            </div>
            <ConversationWorkbench
              project={controller.activeProject}
              currentUser={currentUser}
              messages={controller.messages}
              artifacts={controller.artifacts}
              compact={controller.sidePanelOpen}
              loadState={controller.loadState}
              errorMessage={controller.errorMessage}
              input={controller.input}
              reference={controller.reference}
              composerSubmitting={controller.composerSubmitting}
              projectBusy={controller.projectBusy}
              executionFeedback={controller.executionFeedback}
              notice={controller.notice}
              composerNotice={controller.composerNotice}
              onInputChange={controller.setInput}
              onClearReference={() => controller.setReference(null)}
              onAttachFile={controller.attachComposerFile}
              onAttachFileError={controller.flashComposerNotice}
              onSend={controller.sendPrompt}
              onQuickReplySelect={controller.selectQuickReply}
              onRetry={controller.retryActiveProject}
              onOpenArtifacts={() => controller.setRailOpen(true)}
              onOpenMembers={() => setMembersOpen(true)}
              onOpenFeedback={feedbackController.openFeedback}
              onOpenUserManagement={() => setUserManagementOpen(true)}
              onLogout={onLogout}
            />
          </div>
          <ArtifactSidePanel
            projectId={controller.activeProjectId}
            item={controller.sidePanelItem}
            open={controller.sidePanelOpen}
            onClose={() => controller.setSidePanelOpen(false)}
            onCopy={controller.copyArtifact}
            onUseAsInput={controller.useAsInput}
            onOpenDetail={controller.openDetail}
          />
          <div className="hidden w-16 shrink-0 lg:block 2xl:w-20">
            <ArtifactRail
              projectId={controller.activeProjectId}
              items={controller.artifacts}
              activeKey={controller.activeArtifact?.key ?? ""}
              previewDisabled={controller.sidePanelOpen}
              onCopy={controller.copyArtifact}
              onUseAsInput={controller.useAsInput}
              onOpen={controller.openSidePanel}
              onRegenerate={controller.regenerateArtifact}
            />
          </div>
        </div>
      </div>
      <Sheet open={controller.railOpen} onOpenChange={controller.setRailOpen}>
        <SheetContent className="max-w-[390px]">
          <SheetTitle className="sr-only">线性产物</SheetTitle>
          <ArtifactRail
            projectId={controller.activeProjectId}
            variant="drawer"
            items={controller.artifacts}
            activeKey={controller.activeArtifact?.key ?? ""}
            onCopy={controller.copyArtifact}
            onUseAsInput={controller.useAsInput}
            onOpen={openDetailFromRail}
            onRegenerate={controller.regenerateArtifact}
          />
        </SheetContent>
      </Sheet>
      <ArtifactDetailSheet
        projectId={controller.activeProjectId}
        item={controller.detailItem}
        open={controller.detailOpen}
        onOpenChange={controller.setDetailOpen}
        onCopy={controller.copyArtifact}
        onUseAsInput={controller.useAsInput}
        onConfirm={controller.confirmArtifact}
        onRegenerate={controller.regenerateArtifact}
        onGenerateRealAsset={controller.generateRealAsset}
        realAssetGenerationKey={controller.realAssetGenerationKey}
      />
      <FeedbackDialog controller={feedbackController} />
      <AdminUserManagementDialog open={userManagementOpen} currentUserId={currentUser?.id} onOpenChange={setUserManagementOpen} />
      <ProjectMembersDialog open={membersOpen} projectId={controller.activeProjectId} currentUser={currentUser} onOpenChange={setMembersOpen} />
    </TooltipProvider>
  );
}
