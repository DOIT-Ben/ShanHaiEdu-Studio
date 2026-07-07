"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveArtifactActionKey } from "@/lib/workbench-actions";
import { artifactText, createDefaultWorkbenchDataSource } from "@/lib/workbench-api";
import type { ArtifactItem, ChatMessage, ProjectItem, WorkbenchLoadState, WorkbenchSnapshot } from "@/lib/types";

const activeProjectStorageKey = "shanhai.activeProjectId";

export function useWorkbenchController() {
  const dataSource = useMemo(() => createDefaultWorkbenchDataSource(), []);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [loadState, setLoadState] = useState<WorkbenchLoadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [input, setInput] = useState("");
  const [reference, setReference] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<ArtifactItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [sidePanelItem, setSidePanelItem] = useState<ArtifactItem | null>(null);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [activeArtifactKey, setActiveArtifactKey] = useState("");

  const activeArtifact = useMemo(
    () => artifacts.find((item) => item.key === activeArtifactKey) ?? artifacts[0] ?? null,
    [activeArtifactKey, artifacts],
  );
  const composerNoticeTimer = useRef<number | null>(null);

  const applySnapshot = useCallback((snapshot: WorkbenchSnapshot) => {
    setActiveProjectId(snapshot.project.id);
    window.localStorage.setItem(activeProjectStorageKey, snapshot.project.id);
    setMessages(snapshot.messages);
    setArtifacts(snapshot.artifacts);
    setActiveArtifactKey(snapshot.activeArtifactKey);
    setDetailItem((current) => (current ? snapshot.artifacts.find((item) => item.key === current.key) ?? current : current));
    setSidePanelItem((current) => (current ? snapshot.artifacts.find((item) => item.key === current.key) ?? current : current));
    setProjects((current) => current.map((project) => (project.id === snapshot.project.id ? snapshot.project : project)));
    setErrorMessage(null);
    setLoadState("ready");
  }, []);

  const loadProject = useCallback(
    async (projectId: string) => {
      setLoadState("loading");
      try {
        const snapshot = await dataSource.getProjectSnapshot(projectId);
        applySnapshot(snapshot);
      } catch (error) {
        setLoadState("error");
        setErrorMessage(error instanceof Error && "userMessage" in error ? String(error.userMessage) : "项目内容暂时没有取回，请稍后再试。");
      }
    },
    [applySnapshot, dataSource],
  );

  useEffect(() => {
    let active = true;

    async function loadInitialState() {
      setLoadState("loading");
      try {
        const nextProjects = await dataSource.listProjects();
        if (!active) return;
        setProjects(nextProjects);
        const storedProjectId = window.localStorage.getItem(activeProjectStorageKey);
        const nextProjectId = nextProjects.some((project) => project.id === storedProjectId) ? storedProjectId : nextProjects[0]?.id;
        if (!nextProjectId) {
          setMessages([]);
          setArtifacts([]);
          setActiveProjectId("");
          window.localStorage.removeItem(activeProjectStorageKey);
          setLoadState("ready");
          return;
        }
        const snapshot = await dataSource.getProjectSnapshot(nextProjectId);
        if (active) applySnapshot(snapshot);
      } catch (error) {
        if (!active) return;
        setLoadState("error");
        setErrorMessage(error instanceof Error && "userMessage" in error ? String(error.userMessage) : "项目内容暂时没有取回，请稍后再试。");
      }
    }

    loadInitialState();
    return () => {
      active = false;
    };
  }, [applySnapshot, dataSource]);

  function flashComposerNotice(message: string) {
    setComposerNotice(message);
    if (composerNoticeTimer.current) {
      window.clearTimeout(composerNoticeTimer.current);
    }
    composerNoticeTimer.current = window.setTimeout(() => setComposerNotice(null), 1800);
  }

  function openDetail(item: ArtifactItem) {
    setDetailItem(item);
    setDetailOpen(true);
  }

  function selectProject(projectId: string) {
    setActiveProjectId(projectId);
    setSidePanelOpen(false);
    setDetailOpen(false);
    loadProject(projectId);
  }

  async function createProject() {
    setLoadState("loading");
    try {
      const snapshot = await dataSource.createProject();
      const nextProjects = await dataSource.listProjects();
      setProjects(nextProjects);
      applySnapshot(snapshot);
      setNotice("已新建公开课项目，可以开始描述备课目标。");
    } catch (error) {
      setLoadState("error");
      setErrorMessage(error instanceof Error && "userMessage" in error ? String(error.userMessage) : "新项目暂时没有创建成功，请稍后再试。");
    }
  }

  function openSidePanel(item: ArtifactItem) {
    if (sidePanelOpen && sidePanelItem?.key === item.key) {
      setSidePanelOpen(false);
      return;
    }
    setSidePanelItem(item);
    setSidePanelOpen(true);
  }

  async function copyArtifact(item: ArtifactItem) {
    const text = artifactText(item);
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`已复制「${item.title}」关键内容。`);
      return true;
    } catch {
      setNotice(`复制没有成功，请打开「${item.title}」详情后手动选择内容。`);
      return false;
    }
  }

  function useAsInput(item: ArtifactItem) {
    const text = artifactText(item);
    setReference(`${item.title}：${item.summary}`);
    setInput((current) => (current ? `${current}\n\n请基于：${text}` : `请基于：${text}`));
    setNotice(`已把「${item.title}」插入为下一步输入。`);
    flashComposerNotice("已插入为下一步输入。");
    setRailOpen(false);
    setSidePanelOpen(false);
  }

  async function confirmArtifact(item: ArtifactItem) {
    if (!activeProjectId) return;
    const artifactKey = resolveArtifactActionKey(item, "confirm");
    if (!artifactKey) {
      setNotice(`「${item.title}」暂时没有确认成功，请稍后再试。`);
      return;
    }
    try {
      const snapshot = await dataSource.approveArtifact(activeProjectId, artifactKey);
      applySnapshot(snapshot);
      setNotice(`已确认「${item.title}」，下一步会使用它继续生成。`);
    } catch {
      setNotice(`「${item.title}」暂时没有确认成功，请稍后再试。`);
    }
  }

  async function regenerateArtifact(item: ArtifactItem) {
    if (!activeProjectId) return;
    const artifactKey = resolveArtifactActionKey(item, "regenerate");
    if (!artifactKey) {
      setNotice(`「${item.title}」暂时没有开始重做，请稍后再试。`);
      return;
    }
    try {
      const snapshot = await dataSource.regenerateArtifact(activeProjectId, artifactKey);
      applySnapshot(snapshot);
      setNotice(`已保留「${item.title}」旧内容，新的版本完成后再由你确认是否采用。`);
    } catch {
      setNotice(`「${item.title}」暂时没有开始重做，请稍后再试。`);
    }
  }

  async function sendPrompt() {
    if (!input.trim() && !reference) {
      flashComposerNotice("先输入内容，或从右侧选择一个上游产物。");
      return;
    }
    if (!activeProjectId) {
      flashComposerNotice("请先选择或新建一个项目。");
      return;
    }
    const body = input.trim();
    setInput("");
    setReference(null);
    flashComposerNotice("正在发送");
    try {
      const snapshot = await dataSource.sendMessage(activeProjectId, body, reference);
      applySnapshot(snapshot);
      flashComposerNotice("已发送");
    } catch {
      setInput(body);
      setReference(reference);
      flashComposerNotice("发送没有成功，请稍后再试。");
    }
  }

  function showRecovery() {
    const blocked = artifacts.find((item) => item.key === "video-storyboard");
    if (blocked) openDetail(blocked);
    setNotice("失败恢复示例已打开：旧内容会保留，并提示下一步能做什么。");
  }

  return {
    activeProjectId,
    projects,
    messages,
    loadState,
    errorMessage,
    selectProject,
    createProject,
    retryActiveProject: () => (activeProjectId ? loadProject(activeProjectId) : undefined),
    sidebarCollapsed,
    setSidebarCollapsed,
    input,
    setInput,
    reference,
    setReference,
    notice,
    composerNotice,
    detailItem,
    detailOpen,
    setDetailOpen,
    railOpen,
    setRailOpen,
    sidePanelItem,
    sidePanelOpen,
    setSidePanelOpen,
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
