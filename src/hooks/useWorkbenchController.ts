"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { type ConversationSubmissionOrigin } from "@/lib/workbench-actions";
import { createWorkbenchApiClient } from "@/lib/workbench-api";
import type { GenerationIntensity } from "@/lib/types";
import type { WorkbenchExecutionFeedback } from "@/lib/workbench-execution-feedback";
import { normalizeXiaoKuResponseStyle, type XiaoKuResponseStyle } from "@/lib/xiaoku-preferences";
import { useWorkbenchProjectState } from "@/hooks/useWorkbenchProjectState";
import { useWorkbenchProjectSync } from "@/hooks/useWorkbenchProjectSync";
import { useWorkbenchProjectActions } from "@/hooks/useWorkbenchProjectActions";
import { useWorkbenchComposerController } from "@/hooks/useWorkbenchComposerController";
import { useWorkbenchArtifactNavigation } from "@/hooks/useWorkbenchArtifactNavigation";
import { useWorkbenchArtifactOperations } from "@/hooks/useWorkbenchArtifactOperations";
import { updateGenerationIntensityWithRecovery } from "@/hooks/workbench-generation-intensity-recovery";
import type { SubmitConversationMessageInput } from "@/hooks/workbench-composer-submission";

export type { SubmitConversationMessageInput } from "@/hooks/workbench-composer-submission";
export { resolveBoundConfirmationActionId } from "@/hooks/workbench-composer-contracts";

const xiaokuResponseStyleStorageKey = "shanhai.xiaoku.responseStyle";
const xiaokuResponseStyleChangeEvent = "shanhai:xiaoku-response-style-change";

export function useWorkbenchController(options: { eventDrivenMessages?: boolean } = {}) {
  const dataSource = useMemo(() => createWorkbenchApiClient(), []);
  const state = useWorkbenchProjectState();
  const [pendingConfirmationActionId, setPendingConfirmationActionId] = useState<string | null>(null);
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [realAssetGenerationKey, setRealAssetGenerationKey] = useState<string | null>(null);
  const xiaokuResponseStyle = useSyncExternalStore(subscribeXiaoKuResponseStyle, readXiaoKuResponseStyle, getServerXiaoKuResponseStyle);
  const sync = useWorkbenchProjectSync({
    dataSource,
    state,
    eventDrivenMessages: options.eventDrivenMessages ?? false,
    composerSubmitting,
    setPendingConfirmationActionId,
    setNotice,
  });
  const actions = useWorkbenchProjectActions({ dataSource, state, sync, setPendingConfirmationActionId, setNotice });
  const composer = useWorkbenchComposerController({
    dataSource,
    state,
    sync,
    pendingConfirmationActionId,
    setPendingConfirmationActionId,
    composerSubmitting,
    setComposerSubmitting,
    xiaokuResponseStyle,
  });
  const intensityVersionRef = useRef(new Map<string, number>());
  useEffect(() => {
    if (state.activeProject) intensityVersionRef.current.set(state.activeProject.id, state.activeProject.intensityVersion ?? 0);
  }, [state.activeProject]);
  function setXiaoKuResponseStyle(value: XiaoKuResponseStyle) {
    const normalized = normalizeXiaoKuResponseStyle(value);
    window.localStorage.setItem(xiaokuResponseStyleStorageKey, normalized);
    window.dispatchEvent(new Event(xiaokuResponseStyleChangeEvent));
  }
  const navigation = useWorkbenchArtifactNavigation({ state, composer, setPendingConfirmationActionId, setNotice });
  async function updateGenerationIntensity(intensity: GenerationIntensity, confirmationActionId?: string) {
    const activeProject = state.activeProject;
    if (!activeProject) throw new Error("No active project.");
    return updateGenerationIntensityWithRecovery({
      projectId: activeProject.id,
      intensity,
      confirmationActionId,
      expectedVersion: intensityVersionRef.current.get(activeProject.id) ?? activeProject.intensityVersion ?? 0,
      update: dataSource.updateGenerationIntensity,
      apply: (result) => {
      intensityVersionRef.current.set(result.project.id, result.project.intensityVersion ?? 0);
      state.setProjects((current) => current.map((project) => project.id === result.project.id ? result.project : project));
      if (!result.confirmationRequired) setNotice(`生成强度已调整为${intensity === "standard" ? "标准" : intensity === "enhanced" ? "增强" : intensity === "deep" ? "深度" : "极致"}，从下一条任务开始生效。`);
      },
      reload: sync.loadProject,
    });
  }
  const operations = useWorkbenchArtifactOperations({ dataSource, state, sync, composer, setNotice, setRealAssetGenerationKey });
  const executionFeedback: WorkbenchExecutionFeedback | null = null;
  return {
    activeProjectId: state.activeProjectId,
    activeProject: state.activeProject,
    projects: state.projects,
    projectView: state.projectView,
    messages: state.messages,
    loadState: state.loadState,
    errorMessage: state.errorMessage,
    selectProject: actions.selectProject,
    openProjectView: actions.openProjectView,
    mutateProjectLifecycle: actions.mutateProjectLifecycle,
    updateGenerationIntensity,
    createProject: actions.createProject,
    retryActiveProject: () => (state.activeProjectId ? sync.loadProject(state.activeProjectId) : undefined),
    sidebarCollapsed,
    setSidebarCollapsed,
    input: composer.input,
    setInput: composer.setInput,
    reference: composer.reference,
    setReference: composer.setReference,
    clearComposerReference: composer.clearComposerReference,
    composerArtifactRefs: composer.composerArtifactRefs,
    pendingConfirmationActionId,
    composerSubmitting,
    projectBusy: state.projectBusy,
    turnJobs: state.turnJobs,
    executionFeedback,
    notice,
    composerNotice: composer.composerNotice,
    flashComposerNotice: composer.flashComposerNotice,
    detailItem: state.detailItem,
    detailOpen: state.detailOpen,
    setDetailOpen: state.setDetailOpen,
    railOpen: state.railOpen,
    setRailOpen: state.setRailOpen,
    sidePanelItem: state.sidePanelItem,
    sidePanelOpen: state.sidePanelOpen,
    setSidePanelOpen: state.setSidePanelOpen,
    artifacts: state.artifacts,
    activeArtifact: state.activeArtifact,
    openDetail: navigation.openDetail,
    openSidePanel: navigation.openSidePanel,
    copyArtifact: navigation.copyArtifact,
    useAsInput: navigation.useAsInput,
    setMessageReaction: actions.setMessageReaction,
    attachComposerFile: composer.attachComposerFile,
    confirmArtifact: operations.confirmArtifact,
    submitPptSampleReview: operations.submitPptSampleReview,
    submitPptFullDeckReview: operations.submitPptFullDeckReview,
    requestArtifactRegeneration: operations.requestArtifactRegeneration,
    generateRealAsset: operations.generateRealAsset,
    realAssetGenerationKey,
    xiaokuResponseStyle,
    setXiaoKuResponseStyle,
    sendPrompt: composer.sendPrompt,
    submitConversationMessage: (submission: SubmitConversationMessageInput, origin?: ConversationSubmissionOrigin) => composer.submitConversationMessage(submission, origin),
    recoverConversationTurn: composer.recoverConversationTurn,
    refreshProjectFromAgentEvent: sync.refreshProjectFromAgentEvent,
    correctProjectFromAgentStreamError: sync.correctProjectFromAgentStreamError,
    selectQuickReply: composer.selectQuickReply,
    showRecovery: navigation.showRecovery,
  };
}

function subscribeXiaoKuResponseStyle(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(xiaokuResponseStyleChangeEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(xiaokuResponseStyleChangeEvent, onStoreChange);
  };
}

function readXiaoKuResponseStyle(): XiaoKuResponseStyle {
  return normalizeXiaoKuResponseStyle(window.localStorage.getItem(xiaokuResponseStyleStorageKey));
}

function getServerXiaoKuResponseStyle(): XiaoKuResponseStyle {
  return "pragmatic";
}
