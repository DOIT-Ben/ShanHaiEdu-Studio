"use client";

import { useCallback } from "react";
import { createWorkbenchApiClient } from "@/lib/workbench-api";
import type { ChatMessage, ProjectLifecycleMutation } from "@/lib/types";
import type { WorkbenchProjectState } from "@/hooks/useWorkbenchProjectState";
import type { WorkbenchProjectSync } from "@/hooks/useWorkbenchProjectSync";

type WorkbenchApiClient = ReturnType<typeof createWorkbenchApiClient>;

type ProjectActionOptions = {
  dataSource: WorkbenchApiClient;
  state: WorkbenchProjectState;
  sync: WorkbenchProjectSync;
  setPendingConfirmationActionId: React.Dispatch<React.SetStateAction<string | null>>;
  setNotice: React.Dispatch<React.SetStateAction<string | null>>;
};

export function useWorkbenchProjectActions({ dataSource, state, sync, setPendingConfirmationActionId, setNotice }: ProjectActionOptions) {
  const { activeProjectId, activeProjectIdRef, projectView, setActiveProjectId, setDetailOpen, setErrorMessage, setLoadState, setProjectView, setProjects, setSidePanelOpen } = state;
  const selectProject = useCallback((projectId: string) => {
    setPendingConfirmationActionId(null);
    activeProjectIdRef.current = projectId;
    setActiveProjectId(projectId);
    setSidePanelOpen(false);
    setDetailOpen(false);
    void sync.loadProject(projectId);
  }, [activeProjectIdRef, setActiveProjectId, setDetailOpen, setPendingConfirmationActionId, setSidePanelOpen, sync]);
  const createProjectSnapshot = useCallback(async () => {
    const snapshot = await dataSource.createProject();
    const snapshotRequest = sync.beginSnapshotRequest(snapshot.project.id);
    setProjects(await dataSource.listProjects());
    setProjectView("active");
    sync.applySnapshot(snapshot, snapshotRequest);
    return snapshot;
  }, [dataSource, setProjectView, setProjects, sync]);
  const createProject = useCallback(async () => {
    setPendingConfirmationActionId(null);
    setLoadState("loading");
    try {
      await createProjectSnapshot();
      setNotice("已新建公开课项目，可以开始描述备课目标。");
      return true;
    } catch (error) {
      setLoadState("error");
      setErrorMessage(error instanceof Error && "userMessage" in error ? String(error.userMessage) : "新项目暂时没有创建成功，请稍后再试。");
      return false;
    }
  }, [createProjectSnapshot, setErrorMessage, setLoadState, setNotice, setPendingConfirmationActionId]);
  const openProjectView = useCallback(async (view: WorkbenchProjectState["projectView"]) => {
    setLoadState("loading");
    try {
      setProjects(await dataSource.listProjects(view));
      setProjectView(view);
      sync.clearActiveProject();
      setLoadState("ready");
    } catch {
      setLoadState("error");
      setErrorMessage("项目列表暂时没有取回，请稍后再试。");
    }
  }, [dataSource, setErrorMessage, setLoadState, setProjectView, setProjects, sync]);
  const mutateProjectLifecycle = useCallback(async (projectId: string, mutation: ProjectLifecycleMutation) => {
    try {
      const result = await dataSource.mutateProjectLifecycle(projectId, mutation);
      if (result.project.lifecycleState === "active" && projectView !== "active") {
        setProjects(await dataSource.listProjects("active"));
        setProjectView("active");
        await sync.loadProject(projectId);
        setNotice(result.changed ? "项目已恢复到进行中的项目列表。" : "项目状态没有变化。");
        return result;
      }
      const targetView = result.project.lifecycleState === "active" && projectView === "active" ? "active" : projectView;
      setProjects(await dataSource.listProjects(targetView));
      if (result.project.lifecycleState !== "active" && projectId === activeProjectId) {
        sync.clearActiveProject();
        setProjectView("active");
        setProjects(await dataSource.listProjects("active"));
      }
      setNotice(result.changed ? "项目状态已更新。" : "项目状态没有变化。");
      return result;
    } catch (error) {
      const status = error instanceof Error && "status" in error ? Number(error.status) : undefined;
      setNotice(status === 409 ? "项目状态已变化，请刷新后再操作。" : "项目操作暂时没有完成，请稍后重试。");
      throw error;
    }
  }, [activeProjectId, dataSource, projectView, setNotice, setProjectView, setProjects, sync]);
  const setMessageReaction = useCallback(async (messageId: string, value: ChatMessage["reaction"] | null) => {
    if (!activeProjectId || !dataSource.setMessageReaction) return;
    try {
      const snapshotRequest = sync.beginSnapshotRequest(activeProjectId);
      const snapshot = await dataSource.setMessageReaction(activeProjectId, messageId, value);
      sync.applySnapshot(snapshot, snapshotRequest);
    } catch {
      setNotice("这条反馈标签暂时没有保存，请稍后重试。");
    }
  }, [activeProjectId, dataSource, setNotice, sync]);
  return { selectProject, createProject, createProjectSnapshot, openProjectView, mutateProjectLifecycle, setMessageReaction };
}
