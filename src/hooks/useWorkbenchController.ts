"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRealAssetGenerationActions, type RealAssetKind } from "@/lib/artifact-real-assets";
import { resolveArtifactActionKey } from "@/lib/workbench-actions";
import { artifactText, createDefaultWorkbenchDataSource } from "@/lib/workbench-api";
import type { ArtifactItem, ChatMessage, ProjectItem, WorkbenchLoadState, WorkbenchSnapshot } from "@/lib/types";
import type { WorkbenchExecutionFeedback } from "@/lib/workbench-progress";

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
  const [sending, setSending] = useState(false);
  const [executionFeedback, setExecutionFeedback] = useState<WorkbenchExecutionFeedback | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<ArtifactItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [sidePanelItem, setSidePanelItem] = useState<ArtifactItem | null>(null);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [activeArtifactKey, setActiveArtifactKey] = useState("");
  const [realAssetGenerationKey, setRealAssetGenerationKey] = useState<string | null>(null);

  const activeArtifact = useMemo(
    () => artifacts.find((item) => item.key === activeArtifactKey) ?? artifacts[0] ?? null,
    [activeArtifactKey, artifacts],
  );
  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId) ?? null,
    [activeProjectId, projects],
  );
  const sendingRef = useRef(false);
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
    setDetailOpen(false);
  }

  function attachComposerFile(fileName: string, text: string) {
    setReference(`资料《${fileName}》：\n${text}`);
    flashComposerNotice(`已附加《${fileName}》，发送时会作为本轮资料引用。`);
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

  async function generateRealAsset(item: ArtifactItem, assetKind: RealAssetKind) {
    if (!activeProjectId || !item.artifactId) {
      setNotice(`「${item.title}」暂时不能生成真实素材，请稍后再试。`);
      return;
    }
    const action = getRealAssetGenerationActions(item).find((candidate) => candidate.kind === assetKind);
    if (!action) {
      setNotice(`「${item.title}」暂时不能生成真实素材，请稍后再试。`);
      return;
    }

    const nextGenerationKey = `${item.artifactId}:${assetKind}`;
    setRealAssetGenerationKey(nextGenerationKey);
    try {
      const snapshot = await dataSource.generateRealAsset(activeProjectId, item.artifactId, assetKind);
      applySnapshot(snapshot);
      setNotice(action.successNotice);
    } catch {
      setNotice(action.failureNotice);
    } finally {
      setRealAssetGenerationKey(null);
    }
  }

  async function sendPrompt() {
    if (sendingRef.current || sending) {
      flashComposerNotice("上一条还在回复，请稍等片刻。");
      return;
    }
    if (!input.trim() && !reference) {
      flashComposerNotice("先输入内容，或从右侧选择一个上游产物。");
      return;
    }
    let targetProjectId = activeProjectId;
    const body = input.trim();
    const displayBody = reference ? `${body || "请参考这份资料继续。"}\n\n引用：${reference}` : body;
    const optimisticMessage: ChatMessage = {
      id: `optimistic-teacher-${Date.now()}`,
      speaker: "teacher",
      body: displayBody,
    };
    setInput("");
    setReference(null);
    sendingRef.current = true;
    setSending(true);
    setExecutionFeedback({ label: "正在理解你的备课要求", stageIndex: 1 });
    setMessages((current) => [...current, optimisticMessage]);
    flashComposerNotice("正在等待回复");
    try {
      if (!targetProjectId) {
        flashComposerNotice("正在新建项目并发送");
        const createdSnapshot = await dataSource.createProject();
        targetProjectId = createdSnapshot.project.id;
        const nextProjects = await dataSource.listProjects();
        setProjects(nextProjects);
        applySnapshot(createdSnapshot);
        setMessages((current) => [...current, optimisticMessage]);
      }

      setExecutionFeedback({ label: "正在组织教案、课件和素材任务", stageIndex: 2 });
      const snapshot = await dataSource.sendMessage(targetProjectId, body, reference);
      setExecutionFeedback({ label: "正在保存本轮成果", stageIndex: 3 });
      applySnapshot(snapshot);
      flashComposerNotice("已发送");
    } catch {
      setMessages((current) => current.filter((message) => message.id !== optimisticMessage.id));
      setInput(body);
      setReference(reference);
      flashComposerNotice("发送没有成功，请稍后再试。");
    } finally {
      sendingRef.current = false;
      setSending(false);
      setExecutionFeedback(null);
    }
  }

  function selectQuickReply(value: string) {
    setInput(value);
    flashComposerNotice("已填入，可修改后发送。");
  }

  function showRecovery() {
    const blocked = artifacts.find((item) => item.key === "video-storyboard");
    if (blocked) openDetail(blocked);
    setNotice("失败恢复示例已打开：旧内容会保留，并提示下一步能做什么。");
  }

  return {
    activeProjectId,
    activeProject,
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
    sending,
    executionFeedback,
    notice,
    composerNotice,
    flashComposerNotice,
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
    attachComposerFile,
    confirmArtifact,
    regenerateArtifact,
    generateRealAsset,
    realAssetGenerationKey,
    sendPrompt,
    selectQuickReply,
    showRecovery,
  };
}
