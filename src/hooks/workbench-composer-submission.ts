import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { buildArtifactRegenerationSubmission, resolveConversationSubmissionPolicy, type ConversationSubmissionOrigin } from "@/lib/workbench-actions";
import { buildClientMessageSignature, clearRetrySafeMessageIdempotencyKey, getRetrySafeMessageIdempotencyKey } from "@/lib/workbench-message-idempotency";
import type { ChatMessage, WorkbenchSendMessageOptions, WorkbenchSnapshot } from "@/lib/types";
import type { XiaoKuResponseStyle } from "@/lib/xiaoku-preferences";
import type { ProjectSnapshotCommitToken } from "@/lib/project-agent-event-sync";
import { resolveBoundConfirmationActionId } from "@/hooks/workbench-composer-contracts";

type WorkbenchApiClient = {
  createProject: () => Promise<WorkbenchSnapshot>;
  listProjects: (view?: "active" | "archived" | "trash") => Promise<import("@/lib/types").ProjectItem[]>;
  submitConversationMessage: (projectId: string, submission: import("@/lib/types").ConversationMessageSubmission) => Promise<WorkbenchSnapshot>;
};

type SubmissionContext = {
  dataSource: WorkbenchApiClient;
  activeProjectId: string;
  projectBusy: boolean;
  composerSubmitting: boolean;
  composerSubmittingRef: MutableRefObject<boolean>;
  pendingConfirmationActionId: string | null;
  input: string;
  xiaokuResponseStyle: XiaoKuResponseStyle;
  messageIdempotencyRef: MutableRefObject<Map<string, string>>;
  beginSnapshotRequest: (projectId: string) => ProjectSnapshotCommitToken;
  applySnapshot: (snapshot: WorkbenchSnapshot, token: ProjectSnapshotCommitToken) => boolean;
  createProjectForSubmission: () => Promise<{ projectId: string; snapshotRequest: ProjectSnapshotCommitToken }>;
  appendMessage: (message: ChatMessage) => void;
  removeMessage: (messageId: string) => void;
  clearComposer: () => void;
  setInput: Dispatch<SetStateAction<string>>;
  setPendingConfirmationActionId: Dispatch<SetStateAction<string | null>>;
  setReference: Dispatch<SetStateAction<string | null>>;
  setComposerArtifactRefs: Dispatch<SetStateAction<string[]>>;
  setComposerSubmitting: Dispatch<SetStateAction<boolean>>;
  flashComposerNotice: (message: string) => void;
};

export type SubmitConversationMessageInput = {
  body: string;
  reference: string | null;
  artifactRefs: string[];
  confirmedActionId?: string;
};

export async function submitWorkbenchConversationMessage(context: SubmissionContext, submission: SubmitConversationMessageInput, origin: ConversationSubmissionOrigin = "composer") {
  if (context.composerSubmittingRef.current || context.composerSubmitting) {
    context.flashComposerNotice("正在发送，请稍候。");
    return;
  }
  const body = submission.body.trim();
  const submittedReference = submission.reference?.trim() || null;
  const artifactRefs = [...new Set(submission.artifactRefs.map((value) => value.trim()).filter(Boolean))];
  if (!body && !submittedReference) {
    context.flashComposerNotice("先输入内容，或从右侧选择一个上游产物。");
    return;
  }
  const policy = resolveConversationSubmissionPolicy(origin);
  const confirmationActionId = policy.bindPendingConfirmation ? resolveBoundConfirmationActionId({
    submittedActionId: submission.confirmedActionId,
    pendingActionId: context.pendingConfirmationActionId,
    submittedBody: body,
    boundBody: context.input,
  }) : null;
  const displayBody = submittedReference ? `${body || "请参考这份资料继续。"}\n\n引用：${submittedReference}` : body;
  const optimisticMessage: ChatMessage = {
    id: `optimistic-teacher-${Date.now()}`,
    speaker: "teacher",
    body: displayBody,
    artifactRefs,
    turnStatus: context.projectBusy ? "queued" : "running",
    turnStatusLabel: context.projectBusy ? "排队中" : "正在生成",
  };
  if (policy.clearComposer) context.clearComposer();
  context.composerSubmittingRef.current = true;
  context.setComposerSubmitting(true);
  context.appendMessage(optimisticMessage);
  context.flashComposerNotice(context.projectBusy ? "已加入队列" : "已发送，正在生成");
  let targetProjectId = context.activeProjectId;
  let snapshotRequest = targetProjectId ? context.beginSnapshotRequest(targetProjectId) : null;
  try {
    if (!targetProjectId) {
      context.flashComposerNotice("正在新建项目并发送");
      const created = await context.createProjectForSubmission();
      targetProjectId = created.projectId;
      snapshotRequest = created.snapshotRequest;
      context.appendMessage(optimisticMessage);
    }
    const messageSignature = buildClientMessageSignature(targetProjectId, body, submittedReference, confirmationActionId, context.xiaokuResponseStyle, artifactRefs);
    const sendOptions: WorkbenchSendMessageOptions = {
      idempotencyKey: getRetrySafeMessageIdempotencyKey(context.messageIdempotencyRef, messageSignature),
      ...(confirmationActionId ? { confirmedActionId: confirmationActionId } : {}),
      responseStyle: context.xiaokuResponseStyle,
    };
    const snapshot = await context.dataSource.submitConversationMessage(targetProjectId, {
      body,
      reference: submittedReference,
      artifactRefs,
      ...sendOptions,
    });
    if (!snapshotRequest) throw new Error("Conversation snapshot commit token is missing.");
    context.applySnapshot(snapshot, snapshotRequest);
    clearRetrySafeMessageIdempotencyKey(context.messageIdempotencyRef, messageSignature);
    context.flashComposerNotice("已发送");
  } catch {
    context.removeMessage(optimisticMessage.id);
    if (policy.restoreOnFailure) {
      context.setInput(body);
      context.setPendingConfirmationActionId(confirmationActionId);
      context.setReference(submittedReference);
      context.setComposerArtifactRefs(artifactRefs);
    }
    context.flashComposerNotice("发送没有成功，请稍后再试。");
  } finally {
    context.composerSubmittingRef.current = false;
    context.setComposerSubmitting(false);
  }
}

export function buildArtifactRegenerationRequest(item: import("@/lib/types").ArtifactItem) {
  return buildArtifactRegenerationSubmission(item);
}
