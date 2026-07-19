"use client";

import { useState } from "react";
import { ListTree } from "lucide-react";
import { PasswordAuthGate } from "@/components/auth/PasswordAuthGate";
import { ArtifactDetailSheet } from "@/components/artifacts/ArtifactDetailSheet";
import { ArtifactRail } from "@/components/artifacts/ArtifactRail";
import { ArtifactSidePanel } from "@/components/artifacts/ArtifactSidePanel";
import type { ArtifactCapabilityGroupId } from "@/components/artifacts/artifact-capability-groups";
import { AdminUserManagementDialog } from "@/components/admin/AdminUserManagementDialog";
import { ProjectMembersDialog } from "@/components/admin/ProjectMembersDialog";
import { ConversationWorkbench } from "@/components/conversation/ConversationWorkbench";
import { XiaoKuSettingsDialog } from "@/components/conversation/XiaoKuSettingsDialog";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { ProjectSidebar } from "@/components/layout/ProjectSidebar";
import { AuthenticatedWelcome } from "@/components/layout/AuthenticatedWelcome";
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
        registrationEnabled={auth.registrationEnabled}
        onLogin={auth.login}
        onRegister={auth.register}
      />
    );
  }

  return <AuthenticatedMediaWorkbench currentUser={auth.user} onLogout={auth.enabled ? auth.logout : undefined} />;
}

function AuthenticatedMediaWorkbench({ currentUser, onLogout }: { currentUser: PasswordAuthUser | null; onLogout?: () => Promise<void> }) {
  const controller = useWorkbenchController({ eventDrivenMessages: true });
  const feedbackController = useFeedbackController();
  const [projectSheetOpen, setProjectSheetOpen] = useState(false);
  const [userManagementOpen, setUserManagementOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [xiaokuSettingsOpen, setXiaoKuSettingsOpen] = useState(false);
  const [artifactDrawerGroup, setArtifactDrawerGroup] = useState<"all" | ArtifactCapabilityGroupId>("all");
  const [detailFromArtifactDrawer, setDetailFromArtifactDrawer] = useState(false);

  function selectProjectFromSheet(projectId: string) {
    controller.selectProject(projectId);
    setProjectSheetOpen(false);
  }

  async function createProjectFromSheet() {
    const created = await controller.createProject();
    if (created) setProjectSheetOpen(false);
  }

  function openDetailFromRail(item: Parameters<typeof controller.openDetail>[0]) {
    setDetailFromArtifactDrawer(true);
    controller.openDetail(item);
    controller.setRailOpen(false);
  }

  function openDetailFromReading(item: Parameters<typeof controller.openDetail>[0]) {
    setDetailFromArtifactDrawer(false);
    controller.openDetail(item);
  }

  function returnToArtifactDrawer() {
    controller.setDetailOpen(false);
    controller.setRailOpen(true);
  }

  function openArtifactDrawer(group: "all" | ArtifactCapabilityGroupId = "all") {
    setArtifactDrawerGroup(group);
    controller.setSidePanelOpen(false);
    controller.setRailOpen(true);
  }

  function openConversationArtifact(artifactId: string) {
    const item = controller.artifacts.find((candidate) => candidate.artifactId === artifactId);
    if (item) openDetailFromReading(item);
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
               onOpenXiaoKuSettings={() => setXiaoKuSettingsOpen(true)}
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
                    currentUser={currentUser}
                    onOpenFeedback={feedbackController.openFeedback}
                    onOpenUserManagement={() => setUserManagementOpen(true)}
                    onLogout={onLogout}
                    onOpenXiaoKuSettings={() => setXiaoKuSettingsOpen(true)}
                  />
                </SheetContent>
              </Sheet>
              {controller.activeProject && (
                <Button variant="secondary" size="sm" onClick={() => openArtifactDrawer("all")}>
                  <ListTree className="h-4 w-4" />
                  产物
                </Button>
              )}
            </div>
            {controller.activeProject ? <ConversationWorkbench
              project={controller.activeProject}
              currentUser={currentUser}
              messages={controller.messages}
              artifacts={controller.artifacts}
              compact={controller.sidePanelOpen}
              loadState={controller.loadState}
              errorMessage={controller.errorMessage}
              input={controller.input}
              reference={controller.reference}
              artifactRefs={controller.composerArtifactRefs}
              confirmedActionId={controller.pendingConfirmationActionId}
              composerSubmitting={controller.composerSubmitting}
              projectBusy={controller.projectBusy}
              executionFeedback={controller.executionFeedback}
              notice={controller.notice}
              composerNotice={controller.composerNotice}
              onInputChange={controller.setInput}
              onClearReference={controller.clearComposerReference}
              onAttachFile={controller.attachComposerFile}
              onAttachFileError={controller.flashComposerNotice}
              onSubmitConversationMessage={controller.submitConversationMessage}
              onAgentEvent={controller.refreshProjectFromAgentEvent}
              onAgentStreamError={controller.correctProjectFromAgentStreamError}
              onRecoverCheckpoint={controller.recoverConversationTurn}
               onQuickReplySelect={controller.selectQuickReply}
               onSetMessageReaction={controller.setMessageReaction}
              onRetry={controller.retryActiveProject}
              onOpenArtifacts={() => openArtifactDrawer("all")}
              onOpenArtifact={openConversationArtifact}
              onOpenMembers={() => setMembersOpen(true)}
              onOpenFeedback={feedbackController.openFeedback}
              onOpenUserManagement={() => setUserManagementOpen(true)}
               onLogout={onLogout}
               onOpenXiaoKuSettings={() => setXiaoKuSettingsOpen(true)}
             /> : (
              <AuthenticatedWelcome
                currentUser={currentUser}
                projects={controller.projectView === "active" ? controller.projects : []}
                loadState={controller.loadState}
                errorMessage={controller.errorMessage}
                onCreateProject={controller.createProject}
                onSelectProject={controller.selectProject}
                onOpenFeedback={feedbackController.openFeedback}
                onOpenUserManagement={() => setUserManagementOpen(true)}
                onLogout={onLogout}
                onOpenXiaoKuSettings={() => setXiaoKuSettingsOpen(true)}
              />
            )}
          </div>
          {controller.activeProject && <ArtifactSidePanel
            projectId={controller.activeProjectId}
            item={controller.sidePanelItem}
            open={controller.sidePanelOpen}
            onClose={() => controller.setSidePanelOpen(false)}
            onCopy={controller.copyArtifact}
            onUseAsInput={controller.useAsInput}
            onOpenDetail={openDetailFromReading}
          />}
          {controller.activeProject && <div className="hidden w-16 shrink-0 lg:block 2xl:w-20">
            <ArtifactRail
              items={controller.artifacts}
              activeKey={controller.activeArtifact?.key ?? ""}
              onOpen={controller.openSidePanel}
              onOpenGroup={openArtifactDrawer}
            />
          </div>}
        </div>
      </div>
      <Sheet open={controller.railOpen} onOpenChange={controller.setRailOpen}>
        <SheetContent className="max-w-[390px]">
          <SheetTitle className="sr-only">备课成果</SheetTitle>
          <ArtifactRail
            variant="drawer"
            initialGroup={artifactDrawerGroup}
            items={controller.artifacts}
            activeKey={controller.activeArtifact?.key ?? ""}
            onOpen={openDetailFromRail}
          />
        </SheetContent>
      </Sheet>
      <ArtifactDetailSheet
        projectId={controller.activeProjectId}
        item={controller.detailItem}
        open={controller.detailOpen}
        onOpenChange={(open) => {
          controller.setDetailOpen(open);
          if (!open) setDetailFromArtifactDrawer(false);
        }}
        onBack={detailFromArtifactDrawer ? returnToArtifactDrawer : undefined}
        onCopy={controller.copyArtifact}
        onUseAsInput={controller.useAsInput}
        onConfirm={controller.confirmArtifact}
        onPptSampleReview={controller.submitPptSampleReview}
        onPptFullDeckReview={controller.submitPptFullDeckReview}
        onRegenerate={controller.regenerateArtifact}
        onGenerateRealAsset={controller.generateRealAsset}
        realAssetGenerationKey={controller.realAssetGenerationKey}
      />
      <FeedbackDialog controller={feedbackController} />
      <XiaoKuSettingsDialog
        open={xiaokuSettingsOpen}
        value={controller.xiaokuResponseStyle}
        generationIntensity={controller.activeProject?.generationIntensity ?? "standard"}
        generationIntensitySuggestion={controller.activeProject?.generationIntensitySuggestion ?? null}
        onOpenChange={setXiaoKuSettingsOpen}
        onChange={controller.setXiaoKuResponseStyle}
        onGenerationIntensityChange={controller.updateGenerationIntensity}
      />
      <AdminUserManagementDialog open={userManagementOpen} currentUserId={currentUser?.id} onOpenChange={setUserManagementOpen} />
      <ProjectMembersDialog open={membersOpen} projectId={controller.activeProjectId} currentUser={currentUser} onOpenChange={setMembersOpen} />
    </TooltipProvider>
  );
}
