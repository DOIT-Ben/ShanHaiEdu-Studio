import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { assertActiveProjectForWrite } from "./project-lifecycle-service";
import type { AddMessageInput } from "./types";

async function addMessage(client: PrismaClient, projectId: string, input: AddMessageInput) {
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    return tx.conversationMessage.create({
      data: {
        projectId,
        role: input.role,
        content: input.content,
        partsJson: JSON.stringify(input.parts ?? []),
        artifactRefsJson: JSON.stringify(input.artifactRefs ?? []),
        metadataJson: JSON.stringify(input.metadata ?? {}),
      },
    });
  });
}

async function updateMessageMetadata(
  client: PrismaClient,
  projectId: string,
  messageId: string,
  metadata: Record<string, unknown>,
  parts?: import("@/lib/conversation-message-contract").MessagePart[],
) {
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    const result = await tx.conversationMessage.updateMany({
      where: { id: messageId, projectId },
      data: {
        metadataJson: JSON.stringify(metadata),
        ...(parts ? { partsJson: JSON.stringify(parts) } : {}),
      },
    });

    if (result.count === 0) {
      throw new Error(`ConversationMessage not found: ${messageId}`);
    }

    const message = await tx.conversationMessage.findFirst({
      where: { id: messageId, projectId },
    });
    if (!message) {
      throw new Error(`ConversationMessage not found: ${messageId}`);
    }

    return message;
  });
}

async function getMessages(client: PrismaClient, projectId: string) {
  return client.conversationMessage.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
}

async function getMessageReactions(client: PrismaClient, projectId: string, createdByUserId: string) {
  return client.messageReaction.findMany({
    where: { projectId, createdByUserId },
    orderBy: { updatedAt: "asc" },
  });
}

async function setMessageReaction(
  client: PrismaClient,
  input: { projectId: string; messageId: string; createdByUserId: string; value: "helpful" | "unhelpful" | null },
) {
  return client.$transaction(async (tx) => {
    const message = await tx.conversationMessage.findFirst({
      where: { id: input.messageId, projectId: input.projectId, role: "assistant" },
    });
    if (!message) throw new Error(`ConversationMessage not found: ${input.messageId}`);
    if (!input.value) {
      await tx.messageReaction.deleteMany({ where: { messageId: input.messageId, createdByUserId: input.createdByUserId } });
      return null;
    }
    return tx.messageReaction.upsert({
      where: { messageId_createdByUserId: { messageId: input.messageId, createdByUserId: input.createdByUserId } },
      update: { value: input.value, projectId: input.projectId },
      create: { projectId: input.projectId, messageId: input.messageId, createdByUserId: input.createdByUserId, value: input.value },
    });
  });
}

export function createMessageRepository(client: PrismaClient = prisma) {
  return {
    addMessage: addMessage.bind(null, client),
    updateMessageMetadata: updateMessageMetadata.bind(null, client),
    getMessages: getMessages.bind(null, client),
    getMessageReactions: getMessageReactions.bind(null, client),
    setMessageReaction: setMessageReaction.bind(null, client),
  };
}
