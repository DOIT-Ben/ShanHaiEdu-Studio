"use client";

import { ListTree } from "lucide-react";
import { chatMessages, projects } from "@/lib/mock-data";
import { ArtifactDetailSheet } from "@/components/artifacts/ArtifactDetailSheet";
import { ArtifactRail } from "@/components/artifacts/ArtifactRail";
import { ArtifactSidePanel } from "@/components/artifacts/ArtifactSidePanel";
import { ConversationWorkbench } from "@/components/conversation/ConversationWorkbench";
import { ProjectSidebar } from "@/components/layout/ProjectSidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWorkbenchController } from "@/hooks/useWorkbenchController";

export function MediaWorkbench() {
  const controller = useWorkbenchController();

  return (
    <TooltipProvider delayDuration={180}>
      <div className="h-screen overflow-hidden">
        <div className="flex h-full">
          <div className="hidden lg:block">
            <ProjectSidebar
              projects={projects}
              activeProjectId={controller.activeProjectId}
              collapsed={controller.sidebarCollapsed}
              onToggle={() => controller.setSidebarCollapsed((value) => !value)}
              onSelect={controller.setActiveProjectId}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border-b bg-card px-3 py-2 lg:hidden">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="secondary" size="sm">项目</Button>
                </SheetTrigger>
                <SheetContent side="right" className="max-w-[300px]">
                  <SheetTitle className="sr-only">项目列表</SheetTitle>
                  <ProjectSidebar
                    projects={projects}
                    activeProjectId={controller.activeProjectId}
                    onSelect={controller.setActiveProjectId}
                  />
                </SheetContent>
              </Sheet>
              <Button variant="secondary" size="sm" onClick={() => controller.setRailOpen(true)}>
                <ListTree className="h-4 w-4" />
                产物
              </Button>
            </div>
            <ConversationWorkbench
              messages={chatMessages}
              input={controller.input}
              reference={controller.reference}
              notice={controller.notice}
              composerNotice={controller.composerNotice}
              onInputChange={controller.setInput}
              onClearReference={() => controller.setReference(null)}
              onSend={controller.sendPrompt}
              onConfirmIntro={() => controller.confirmArtifact(controller.activeArtifact)}
              onRecover={controller.showRecovery}
            />
          </div>
          <ArtifactSidePanel
            item={controller.sidePanelItem}
            open={controller.sidePanelOpen}
            onClose={() => controller.setSidePanelOpen(false)}
            onCopy={controller.copyArtifact}
            onUseAsInput={controller.useAsInput}
            onOpenDetail={controller.openDetail}
          />
          <div className="hidden w-16 shrink-0 lg:block 2xl:w-20">
            <ArtifactRail
              items={controller.artifacts}
              activeKey={controller.activeArtifact.key}
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
            variant="drawer"
            items={controller.artifacts}
            activeKey={controller.activeArtifact.key}
            onCopy={controller.copyArtifact}
            onUseAsInput={controller.useAsInput}
            onOpen={controller.openDetail}
            onRegenerate={controller.regenerateArtifact}
          />
        </SheetContent>
      </Sheet>
      <ArtifactDetailSheet
        item={controller.detailItem}
        open={controller.detailOpen}
        onOpenChange={controller.setDetailOpen}
        onCopy={controller.copyArtifact}
        onUseAsInput={controller.useAsInput}
        onConfirm={controller.confirmArtifact}
        onRegenerate={controller.regenerateArtifact}
      />
    </TooltipProvider>
  );
}
