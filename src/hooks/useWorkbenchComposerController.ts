"use client";

import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createWorkbenchApiClient } from "@/lib/workbench-api";
import type { ChatMessage } from "@/lib/types";
import type { XiaoKuResponseStyle } from "@/lib/xiaoku-preferences";
import type { WorkbenchProjectState } from "@/hooks/useWorkbenchProjectState";
import type { WorkbenchProjectSync } from "@/hooks/useWorkbenchProjectSync";
import { submitWorkbenchConversationMessage, type SubmitConversationMessageInput } from "@/hooks/workbench-composer-submission";

type WorkbenchApiClient = ReturnType<typeof createWorkbenchApiClient>;

type ComposerOptions = {
  dataSource: WorkbenchApiClient;
  state: WorkbenchProjectState;
  sync: WorkbenchProjectSync;
  pendingConfirmationActionId: string | null;
  setPendingConfirmationActionId: Dispatch<SetStateAction<string | null>>;
  composerSubmitting: boolean;
  setComposerSubmitting: Dispatch<SetStateAction<boolean>>;
  xiaokuResponseStyle: XiaoKuResponseStyle;
};

export function useWorkbenchComposerController({ dataSource, state, sync, pendingConfirmationActionId, setPendingConfirmationActionId, composerSubmitting, setComposerSubmitting, xiaokuResponseStyle }: ComposerOptions) {
  const { activeProjectId, projectBusy, setMessages } = state;
  const [input, setInputState] = useState("");
  const [reference, setReferenceState] = useState<string | null>(null);
  const [composerArtifactRefs, setComposerArtifactRefs] = useState<string[]>([]);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const composerSubmittingRef = useRef(false);
  const messageIdempotencyRef = useRef(new Map<string, string>());
  const composerNoticeTimer = useRef<number | null>(null);
  const setInput = useCallback((value: string | ((current: string) => string)) => {
    setPendingConfirmationActionId(null);
    setInputState(value);
  }, [setPendingConfirmationActionId]);
  const setReference = useCallback((value: string | null | ((current: string | null) => string | null)) => {
    setPendingConfirmationActionId(null);
    setReferenceState(value);
  }, [setPendingConfirmationActionId]);
  const flashComposerNotice = useCallback((message: string) => {
    setComposerNotice(message);
    if (composerNoticeTimer.current) window.clearTimeout(composerNoticeTimer.current);
    composerNoticeTimer.current = window.setTimeout(() => setComposerNotice(null), 1800);
  }, []);
  const clearComposer = useCallback(() => {
    setInputState("");
    setPendingConfirmationActionId(null);
    setReferenceState(null);
    setComposerArtifactRefs([]);
  }, [setPendingConfirmationActionId]);
  const appendMessage = useCallback((message: ChatMessage) => setMessages((current) => [...current, message]), [setMessages]);
  const removeMessage = useCallback((messageId: string) => setMessages((current) => current.filter((message) => message.id !== messageId)), [setMessages]);
  const createProjectForSubmission = useCallback(async () => {
    const snapshot = await dataSource.createProject();
    const snapshotRequest = sync.beginSnapshotRequest(snapshot.project.id);
    state.setProjects(await dataSource.listProjects());
    state.setProjectView("active");
    sync.applySnapshot(snapshot, snapshotRequest);
    return { projectId: snapshot.project.id, snapshotRequest };
  }, [dataSource, state, sync]);
  const submitConversationMessage = useCallback((submission: SubmitConversationMessageInput, origin?: "composer" | "artifact_action") => submitWorkbenchConversationMessage({
    dataSource,
    activeProjectId,
    projectBusy,
    composerSubmitting,
    composerSubmittingRef,
    pendingConfirmationActionId,
    input,
    xiaokuResponseStyle,
    messageIdempotencyRef,
    beginSnapshotRequest: sync.beginSnapshotRequest,
    applySnapshot: sync.applySnapshot,
    createProjectForSubmission,
    appendMessage,
    removeMessage,
    clearComposer,
    setInput: setInputState,
    setPendingConfirmationActionId,
    setReference: setReferenceState,
    setComposerArtifactRefs,
    setComposerSubmitting,
    flashComposerNotice,
  }, submission, origin), [activeProjectId, appendMessage, clearComposer, composerSubmitting, createProjectForSubmission, dataSource, flashComposerNotice, input, pendingConfirmationActionId, projectBusy, removeMessage, setComposerSubmitting, setPendingConfirmationActionId, sync, xiaokuResponseStyle]);
  const recoverConversationTurn = useCallback(async (checkpointId: string) => {
    if (!activeProjectId || composerSubmittingRef.current || composerSubmitting) return;
    composerSubmittingRef.current = true;
    setComposerSubmitting(true);
    flashComposerNotice("正在从已保存的进度恢复");
    try {
      const snapshotRequest = sync.beginSnapshotRequest(activeProjectId);
      const snapshot = await dataSource.recoverConversationTurn(activeProjectId, checkpointId);
      sync.applySnapshot(snapshot, snapshotRequest);
      flashComposerNotice("已恢复当前任务");
    } catch {
      flashComposerNotice("当前进度暂时不能恢复，请刷新后重试。");
    } finally {
      composerSubmittingRef.current = false;
      setComposerSubmitting(false);
    }
  }, [activeProjectId, composerSubmitting, dataSource, flashComposerNotice, setComposerSubmitting, sync]);
  const attachComposerFile = useCallback((fileName: string, text: string) => {
    setPendingConfirmationActionId(null);
    setReferenceState(`资料《${fileName}》：\n${text}`);
    setComposerArtifactRefs([]);
    flashComposerNotice(`已附加《${fileName}》，发送时会作为本轮资料引用。`);
  }, [flashComposerNotice, setPendingConfirmationActionId]);
  const clearComposerReference = useCallback(() => {
    setPendingConfirmationActionId(null);
    setReferenceState(null);
    setComposerArtifactRefs([]);
  }, [setPendingConfirmationActionId]);
  const selectQuickReply = useCallback((value: string, actionId?: string) => {
    setPendingConfirmationActionId(actionId?.trim() || null);
    setInputState(value);
    flashComposerNotice("已填入，可修改后发送。");
  }, [flashComposerNotice, setPendingConfirmationActionId]);
  const sendPrompt = useCallback(() => submitConversationMessage({ body: input, reference, artifactRefs: composerArtifactRefs, ...(pendingConfirmationActionId ? { confirmedActionId: pendingConfirmationActionId } : {}) }), [composerArtifactRefs, input, pendingConfirmationActionId, reference, submitConversationMessage]);
  return {
    input, setInput, reference, setReference, composerArtifactRefs, setComposerArtifactRefs,
    pendingConfirmationActionId, composerSubmitting, composerNotice, flashComposerNotice,
    attachComposerFile, clearComposerReference, submitConversationMessage, recoverConversationTurn,
    selectQuickReply, sendPrompt,
  };
}

export type WorkbenchComposerController = ReturnType<typeof useWorkbenchComposerController>;
