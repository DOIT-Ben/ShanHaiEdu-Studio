import type { ArtifactItem, ConversationMessageSubmission } from "@/lib/types";

export type ConversationSubmissionOrigin = "composer" | "artifact_action";

export function resolveArtifactActionKey(item: ArtifactItem, action: "confirm"): string | null {
  if (action !== "confirm" || !item.actions.canConfirm) return null;
  return item.artifactId?.trim() || null;
}

export function buildArtifactRegenerationSubmission(item: ArtifactItem): ConversationMessageSubmission | null {
  const artifactId = item.artifactId?.trim();
  if (!item.actions.canRegenerate || !artifactId) return null;
  return {
    body: `请基于当前任务重新生成「${item.title}」，保留旧版本供我对比。`,
    reference: null,
    artifactRefs: [artifactId],
  };
}

export function resolveConversationSubmissionPolicy(origin: ConversationSubmissionOrigin) {
  const usesComposerDraft = origin === "composer";
  return { bindPendingConfirmation: usesComposerDraft, clearComposer: usesComposerDraft, restoreOnFailure: usesComposerDraft };
}
