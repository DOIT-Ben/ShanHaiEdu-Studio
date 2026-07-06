"use client";

import { useMemo, useState } from "react";
import { artifacts as initialArtifacts, projects } from "@/lib/mock-data";
import type { ArtifactItem } from "@/lib/types";

function artifactText(item: ArtifactItem) {
  const fields = item.previewFields.map((field) => `${field.label}：${field.value}`).join("；");
  return `${item.title}｜${item.summary}｜${fields}`;
}

export function useWorkbenchController() {
  const [activeProjectId, setActiveProjectId] = useState(projects[0].id);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [input, setInput] = useState("");
  const [reference, setReference] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<ArtifactItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [sidePanelItem, setSidePanelItem] = useState<ArtifactItem | null>(null);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [sidePanelWidth, setSidePanelWidth] = useState(380);
  const [artifacts, setArtifacts] = useState(initialArtifacts);

  const activeArtifact = useMemo(() => artifacts.find((item) => item.key === "intro-video-plan") ?? artifacts[0], [artifacts]);

  function openDetail(item: ArtifactItem) {
    setDetailItem(item);
    setDetailOpen(true);
  }

  function openSidePanel(item: ArtifactItem) {
    setSidePanelItem(item);
    setSidePanelOpen(true);
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
    setSidePanelOpen(false);
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

  return {
    activeProjectId,
    setActiveProjectId,
    sidebarCollapsed,
    setSidebarCollapsed,
    input,
    setInput,
    reference,
    setReference,
    notice,
    detailItem,
    detailOpen,
    setDetailOpen,
    railOpen,
    setRailOpen,
    sidePanelItem,
    sidePanelOpen,
    setSidePanelOpen,
    sidePanelWidth,
    setSidePanelWidth,
    artifacts,
    activeArtifact,
    openDetail,
    openSidePanel,
    copyArtifact,
    useAsInput,
    confirmArtifact,
    regenerateArtifact,
    sendPrompt,
    showRecovery,
  };
}
