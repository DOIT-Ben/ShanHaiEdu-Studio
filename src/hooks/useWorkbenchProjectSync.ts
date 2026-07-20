"use client";

import { useCallback, useEffect } from "react";
import { createWorkbenchApiClient } from "@/lib/workbench-api";
import {
  createProjectSnapshotCommitWatermark,
  createProjectSnapshotRefreshCoordinator,
  type ProjectSnapshotCommitToken,
} from "@/lib/project-agent-event-sync";
import { shouldRefreshSnapshotForAgentEvent, type TeacherAgentEvent } from "@/lib/teacher-agent-events";
import type { WorkbenchSnapshot } from "@/lib/types";
import { snapshotHasPendingTurn, type WorkbenchProjectState } from "@/hooks/useWorkbenchProjectState";

type WorkbenchApiClient = ReturnType<typeof createWorkbenchApiClient>;
const snapshotPollingIntervalMs = 1200;

type SnapshotSyncOptions = {
  dataSource: WorkbenchApiClient;
  state: WorkbenchProjectState;
  eventDrivenMessages: boolean;
  composerSubmitting: boolean;
  setPendingConfirmationActionId: React.Dispatch<React.SetStateAction<string | null>>;
  setNotice: React.Dispatch<React.SetStateAction<string | null>>;
};

export type WorkbenchProjectSync = {
  clearActiveProject: () => void;
  beginSnapshotRequest: (projectId: string) => ProjectSnapshotCommitToken;
  applySnapshot: (snapshot: WorkbenchSnapshot, token: ProjectSnapshotCommitToken) => boolean;
  loadProject: (projectId: string) => Promise<void>;
  refreshProjectFromAgentEvent: (event: TeacherAgentEvent) => Promise<number | null>;
  correctProjectFromAgentStreamError: () => Promise<void>;
};

export function useWorkbenchSnapshotCoordinator({ dataSource, state, setPendingConfirmationActionId }: SnapshotSyncOptions) {
  const {
    activeProjectIdRef, snapshotCommitWatermarkRef, eventSnapshotCoordinatorRef,
    setActiveProjectId, setMessages, setArtifacts, setTurnJobs, setActiveArtifactKey,
    setDetailItem, setSidePanelItem, setSidePanelOpen, setDetailOpen,
    setProjects, setErrorMessage, setLoadState,
  } = state;
  const clearActiveProject = useCallback(() => {
    activeProjectIdRef.current = "";
    setActiveProjectId("");
    setPendingConfirmationActionId(null);
    window.localStorage.removeItem("shanhai.activeProjectId");
    setMessages([]);
    setArtifacts([]);
    setTurnJobs([]);
    setActiveArtifactKey("");
    setDetailItem(null);
    setSidePanelItem(null);
    setSidePanelOpen(false);
    setDetailOpen(false);
  }, [activeProjectIdRef, setActiveArtifactKey, setActiveProjectId, setArtifacts, setDetailItem, setDetailOpen, setMessages, setPendingConfirmationActionId, setSidePanelItem, setSidePanelOpen, setTurnJobs]);
  const applySnapshotState = useCallback((snapshot: WorkbenchSnapshot) => {
    activeProjectIdRef.current = snapshot.project.id;
    setActiveProjectId(snapshot.project.id);
    window.localStorage.setItem("shanhai.activeProjectId", snapshot.project.id);
    setMessages(snapshot.messages);
    setArtifacts(snapshot.artifacts);
    setTurnJobs(snapshot.turnJobs ?? []);
    setActiveArtifactKey(snapshot.activeArtifactKey);
    setDetailItem((current) => current
      ? snapshot.artifacts.find((item) => item.key === current.key)
        ?? snapshot.artifacts.find((item) => item.nodeKey === current.nodeKey)
        ?? current
      : current);
    setSidePanelItem((current) => current
      ? snapshot.artifacts.find((item) => item.key === current.key)
        ?? snapshot.artifacts.find((item) => item.nodeKey === current.nodeKey)
        ?? current
      : current);
    setProjects((current) => current.map((project) => (project.id === snapshot.project.id ? snapshot.project : project)));
    setErrorMessage(null);
    setLoadState("ready");
  }, [activeProjectIdRef, setActiveArtifactKey, setActiveProjectId, setArtifacts, setDetailItem, setErrorMessage, setLoadState, setMessages, setProjects, setSidePanelItem, setTurnJobs]);
  const beginSnapshotRequest = useCallback((projectId: string) => {
    const watermark = snapshotCommitWatermarkRef.current;
    if (!watermark) throw new Error("Project snapshot commit watermark is not ready.");
    return watermark.begin(projectId);
  }, [snapshotCommitWatermarkRef]);
  const applySnapshot = useCallback((snapshot: WorkbenchSnapshot, token: ProjectSnapshotCommitToken) => {
    const watermark = snapshotCommitWatermarkRef.current;
    if (!watermark) throw new Error("Project snapshot commit watermark is not ready.");
    return watermark.commit(snapshot, token);
  }, [snapshotCommitWatermarkRef]);
  useEffect(() => {
    const watermark = createProjectSnapshotCommitWatermark({ applySnapshot: applySnapshotState });
    const coordinator = createProjectSnapshotRefreshCoordinator({
      loadSnapshot: dataSource.getProjectSnapshot,
      beginSnapshotRequest: watermark.begin,
      applySnapshot: (snapshot, token) => {
        if (!token) throw new Error("Project event snapshot commit token is missing.");
        watermark.commit(snapshot, token);
      },
      isCurrentProject: (projectId: string) => activeProjectIdRef.current === projectId,
      onError: () => setErrorMessage("项目进度暂时没有刷新成功，请稍后再试。"),
    });
    snapshotCommitWatermarkRef.current = watermark;
    eventSnapshotCoordinatorRef.current = coordinator;
    return () => {
      snapshotCommitWatermarkRef.current = null;
      eventSnapshotCoordinatorRef.current = null;
    };
  }, [activeProjectIdRef, applySnapshotState, dataSource, eventSnapshotCoordinatorRef, setErrorMessage, snapshotCommitWatermarkRef]);
  return { clearActiveProject, beginSnapshotRequest, applySnapshot };
}

export function useWorkbenchProjectRefresh(input: SnapshotSyncOptions & ReturnType<typeof useWorkbenchSnapshotCoordinator>) {
  const { dataSource, state, eventDrivenMessages, composerSubmitting, setNotice, clearActiveProject, beginSnapshotRequest, applySnapshot } = input;
  const { activeProjectId, activeProjectIdRef, projectBusy, setProjects, setProjectView, setLoadState, setErrorMessage, setMessages, setArtifacts, setTurnJobs, setActiveProjectId, eventSnapshotCoordinatorRef } = state;
  const loadProject = useCallback(async (projectId: string) => {
    setLoadState("loading");
    try {
      const snapshotRequest = beginSnapshotRequest(projectId);
      const snapshot = await dataSource.getProjectSnapshot(projectId);
      if (snapshot.project.lifecycleState !== "active") {
        setProjects(await dataSource.listProjects("active"));
        setProjectView("active");
        clearActiveProject();
        setNotice("项目状态已变化，已返回进行中的项目列表。");
        setLoadState("ready");
        return;
      }
      applySnapshot(snapshot, snapshotRequest);
    } catch (error) {
      setLoadState("error");
      setErrorMessage(error instanceof Error && "userMessage" in error ? String(error.userMessage) : "项目内容暂时没有取回，请稍后再试。");
    }
  }, [applySnapshot, beginSnapshotRequest, clearActiveProject, dataSource, setErrorMessage, setLoadState, setNotice, setProjectView, setProjects]);
  useEffect(() => {
    if (eventDrivenMessages || !activeProjectId || !projectBusy || composerSubmitting || state.loadState !== "ready") return;
    let active = true;
    let snapshotPollingTimer: number | null = null;
    function scheduleNextSnapshotRefresh() {
      snapshotPollingTimer = window.setTimeout(async () => {
        try {
          const snapshotRequest = beginSnapshotRequest(activeProjectId);
          const snapshot = await dataSource.getProjectSnapshot(activeProjectId);
          if (!active) return;
          if (snapshot.project.lifecycleState !== "active") {
            setProjects(await dataSource.listProjects("active"));
            if (!active) return;
            setProjectView("active");
            clearActiveProject();
            setNotice("项目状态已变化，已返回进行中的项目列表。");
            setLoadState("ready");
            return;
          }
          applySnapshot(snapshot, snapshotRequest);
          if (snapshotHasPendingTurn(snapshot)) scheduleNextSnapshotRefresh();
        } catch {
          if (!active) return;
          setErrorMessage("项目进度暂时没有刷新成功，请稍后再试。");
          scheduleNextSnapshotRefresh();
        }
      }, snapshotPollingIntervalMs);
    }
    scheduleNextSnapshotRefresh();
    return () => {
      active = false;
      if (snapshotPollingTimer) window.clearTimeout(snapshotPollingTimer);
    };
  }, [activeProjectId, applySnapshot, beginSnapshotRequest, clearActiveProject, composerSubmitting, dataSource, eventDrivenMessages, projectBusy, setErrorMessage, setLoadState, setNotice, setProjectView, setProjects, state.loadState]);
  const refreshProjectFromAgentEvent = useCallback(async (event: TeacherAgentEvent) => {
    if (!eventDrivenMessages || event.projectId !== activeProjectIdRef.current || !shouldRefreshSnapshotForAgentEvent(event)) return null;
    return eventSnapshotCoordinatorRef.current?.request({ projectId: event.projectId, requiredSequence: event.sequence }) ?? Promise.resolve(null);
  }, [activeProjectIdRef, eventDrivenMessages, eventSnapshotCoordinatorRef]);
  const correctProjectFromAgentStreamError = useCallback(async () => {
    const projectId = activeProjectIdRef.current;
    if (!eventDrivenMessages || !projectId) return;
    await eventSnapshotCoordinatorRef.current?.request({ projectId, requiredSequence: 0 });
  }, [activeProjectIdRef, eventDrivenMessages, eventSnapshotCoordinatorRef]);
  useEffect(() => {
    let active = true;
    async function loadInitialState() {
      setLoadState("loading");
      try {
        const nextProjects = await dataSource.listProjects("active");
        if (!active) return;
        setProjects(nextProjects);
        activeProjectIdRef.current = "";
        setActiveProjectId("");
        setMessages([]);
        setArtifacts([]);
        setTurnJobs([]);
        setLoadState("ready");
      } catch (error) {
        if (!active) return;
        setLoadState("error");
        setErrorMessage(error instanceof Error && "userMessage" in error ? String(error.userMessage) : "项目内容暂时没有取回，请稍后再试。");
      }
    }
    void loadInitialState();
    return () => { active = false; };
  }, [activeProjectIdRef, dataSource, setActiveProjectId, setArtifacts, setErrorMessage, setLoadState, setMessages, setProjects, setTurnJobs]);
  return { loadProject, refreshProjectFromAgentEvent, correctProjectFromAgentStreamError };
}

export function useWorkbenchProjectSync(options: SnapshotSyncOptions): WorkbenchProjectSync {
  const coordinator = useWorkbenchSnapshotCoordinator(options);
  const refresh = useWorkbenchProjectRefresh({ ...options, ...coordinator });
  return { ...coordinator, ...refresh };
}
