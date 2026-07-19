import {
  normalizeMessageParts,
  projectConversationMessageParts,
} from "@/lib/conversation-message-contract";
import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import type {
  AddMessageInput,
  ConversationMessageRecord,
  SetMessageReactionInput,
} from "./types";
import type { WorkbenchServiceContext } from "./workbench-service-context";
import {
  mapMessage,
  parseJsonArray,
  parseJsonObject,
} from "./workbench-service-mappers";

export function createWorkbenchMessageService(context: WorkbenchServiceContext) {
  const { actor, ensureProjectAccess, repository } = context;
  return {
    async addMessage(projectId: string, input: AddMessageInput): Promise<ConversationMessageRecord> {
      await ensureProjectAccess(projectId, "write");
      const message = await repository.addMessage(projectId, await projectMessageParts(context, projectId, input));
      return mapMessage(message);
    },

    async updateMessageMetadata(
      projectId: string,
      messageId: string,
      metadata: Record<string, unknown>,
    ): Promise<ConversationMessageRecord> {
      await ensureProjectAccess(projectId, "write");
      const existing = (await repository.getMessages(projectId)).find((candidate) => candidate.id === messageId);
      if (!existing) throw new Error(`ConversationMessage not found: ${messageId}`);
      const projected = await projectMessageParts(context, projectId, {
        role: existing.role as AddMessageInput["role"],
        content: existing.content,
        artifactRefs: parseJsonArray(existing.artifactRefsJson),
        metadata,
      });
      const message = await repository.updateMessageMetadata(projectId, messageId, metadata, projected.parts);
      return mapMessage(message);
    },

    async setMessageReaction(projectId: string, input: SetMessageReactionInput) {
      await ensureProjectAccess(projectId, "write");
      if (!actor?.userId) throw new Error("A signed-in teacher is required.");
      const reaction = await repository.setMessageReaction({
        projectId,
        messageId: input.messageId,
        createdByUserId: actor.userId,
        value: input.value,
      });
      return reaction
        ? { messageId: reaction.messageId, value: reaction.value as "helpful" | "unhelpful" }
        : { messageId: input.messageId, value: null };
    },

    async getMessages(projectId: string): Promise<ConversationMessageRecord[]> {
      await ensureProjectAccess(projectId);
      return (await repository.getMessages(projectId)).map((message) => mapMessage(message));
    },
  };
}

export async function projectMessageParts<T extends AddMessageInput>(
  context: WorkbenchServiceContext,
  projectId: string,
  input: T,
) {
  if (input.parts) return { ...input, parts: normalizeMessageParts(input.parts) };
  const referencedIds = input.artifactRefs ?? [];
  const artifacts = referencedIds.length > 0 ? await context.repository.getArtifacts(projectId) : [];
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const artifactRefs = referencedIds.flatMap((artifactId) => {
    const artifact = byId.get(artifactId);
    if (!artifact) return [];
    const structuredContent = parseJsonObject(artifact.structuredContentJson);
    const qualityState = structuredContent.artifactQualityState
      && typeof structuredContent.artifactQualityState === "object"
      && !Array.isArray(structuredContent.artifactQualityState)
      ? structuredContent.artifactQualityState as Record<string, unknown>
      : {};
    return [{
      artifactId: artifact.id,
      version: artifact.version,
      digest: hashArtifactDraft({
        nodeKey: artifact.nodeKey,
        kind: artifact.kind,
        title: artifact.title,
        summary: artifact.summary,
        markdownContent: artifact.markdownContent,
        structuredContent,
      }),
      title: artifact.title,
      summary: artifact.summary,
      qualityOutcome: qualityState.downstreamEligibility === "eligible"
        ? "passed" as const
        : artifact.status === "failed" ? "failed" as const : "pending" as const,
    }];
  });
  return {
    ...input,
    parts: projectConversationMessageParts({
      role: input.role,
      content: input.content,
      artifactRefs,
      metadata: input.metadata,
    }),
  };
}
