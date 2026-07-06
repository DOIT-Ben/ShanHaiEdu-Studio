"use client";

import { useMemo, useState } from "react";
import { ListTree } from "lucide-react";
import { artifacts as initialArtifacts, chatMessages, projects, steps } from "@/lib/mock-data";
import type { ArtifactItem } from "@/lib/types";
import { ArtifactDetailSheet } from "@/components/artifacts/ArtifactDetailSheet";
import { ArtifactRail } from "@/components/artifacts/ArtifactRail";
import { ConversationWorkbench } from "@/components/conversation/ConversationWorkbench";
import { ProjectSidebar } from "@/components/layout/ProjectSidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";

function artifactText(item: ArtifactItem) {
  const fields = item.previewFields.map((field) => `${field.label}：${field.value}`).join("；");
  return `${item.title}｜${item.summary}｜${fields}`;
}

export function MediaWorkbench() {
  const [activeProjectId, setActiveProjectId] = useState(projects[0].id);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [input, setInput] = useState("");
  const [reference, setReference] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<ArtifactItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [artifacts, setArtifacts] = useState(initialArtifacts);

  const activeArtifact = useMemo(() => artifacts.find((item) => item.key === "intro-video-plan") ?? artifacts[0], [artifacts]);

  function openDetail(item: ArtifactItem) {
    setDetailItem(item);
    setDetailOpen(true);
  }

  async function copyArtifact(item: ArtifactItem) {
    const text = artifactText(item);
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`已复制「${item.title}」关键内容。`);
    } catch {
      setNotice(`复制没有成功，请打开「${item.title}」详情后手动选择内容。`);
    }
  }

  function useAsInput(item: ArtifactItem) {
    const text = artifactText(item);
    setReference(`${item.title}：${item.summary}`);
    setInput((current) => (current ? `${current}\n\n请基于：${text}` : `请基于：${text}`));
    setNotice(`已把「${item.title}」插入为下一步输入。`);
    setRailOpen(false);
  }

  function confirmArtifact(item: ArtifactItem) {
    setArtifacts((current) =>
      current.map((entry) => (entry.key === item.key ? { ...entry, status: "approved", updatedAt: "刚刚" } : entry)),
    );
    setNotice(`已确认「${item.title}」，下一步会使用它继续生成。`);
  }

  function regenerateArtifact(item: ArtifactItem) {
    setNotice(`已保留「${item.title}」旧内容，新的版本生成后再由你确认是否采用。`);
  }

  function sendPrompt() {
    if (!input.trim() && !reference) {
      setNotice("可以先输入你的修改要求，或从右侧选择一个上游产物作为输入。");
      return;
    }
    setNotice("已收到修改要求。演示版不会连接真实生成服务，但会保留你的输入状态。");
  }

  function showRecovery() {
    const blocked = artifacts.find((item) => item.key === "video-storyboard");
    if (blocked) openDetail(blocked);
    setNotice("失败恢复示例已打开：旧内容会保留，并提示下一步能做什么。");
  }

  return (
    <TooltipProvider delayDuration={180}>
      <div className="h-screen overflow-hidden">
        <div className="flex h-full">
          <div className="hidden lg:block">
            <ProjectSidebar
              projects={projects}
              activeProjectId={activeProjectId}
              collapsed={sidebarCollapsed}
              onToggle={() => setSidebarCollapsed((value) => !value)}
              onSelect={setActiveProjectId}
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
                    activeProjectId={activeProjectId}
                    onSelect={setActiveProjectId}
                  />
                </SheetContent>
              </Sheet>
              <Button variant="secondary" size="sm" onClick={() => setRailOpen(true)}>
                <ListTree className="h-4 w-4" />
                产物
              </Button>
            </div>
            <ConversationWorkbench
              steps={steps}
              messages={chatMessages}
              input={input}
              reference={reference}
              notice={notice}
              onInputChange={setInput}
              onClearReference={() => setReference(null)}
              onSend={sendPrompt}
              onConfirmIntro={() => confirmArtifact(activeArtifact)}
              onRecover={showRecovery}
            />
          </div>
          <div className="hidden w-[86px] shrink-0 xl:block">
            <ArtifactRail
              items={artifacts}
              activeKey={activeArtifact.key}
              onCopy={copyArtifact}
              onUseAsInput={useAsInput}
              onOpen={openDetail}
              onRegenerate={regenerateArtifact}
            />
          </div>
        </div>
      </div>
      <Sheet open={railOpen} onOpenChange={setRailOpen}>
        <SheetContent className="max-w-[390px]">
          <SheetTitle className="sr-only">线性产物</SheetTitle>
          <ArtifactRail
            variant="drawer"
            items={artifacts}
            activeKey={activeArtifact.key}
            onCopy={copyArtifact}
            onUseAsInput={useAsInput}
            onOpen={openDetail}
            onRegenerate={regenerateArtifact}
          />
        </SheetContent>
      </Sheet>
      <ArtifactDetailSheet
        item={detailItem}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onCopy={copyArtifact}
        onUseAsInput={useAsInput}
        onConfirm={confirmArtifact}
        onRegenerate={regenerateArtifact}
      />
    </TooltipProvider>
  );
}
