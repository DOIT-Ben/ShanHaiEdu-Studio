import type { ThreadMessageLike } from "@assistant-ui/react";

import {
  legacyContentToMessageParts,
  projectMessagePartsToAssistantUi,
} from "@/lib/conversation-message-contract";
import type { ChatDeliveryPlan, ChatMessage } from "@/lib/types";

export type ShanHaiAssistantMessageCustom = {
  projectMessageId: string;
  title?: string;
  body: string;
  timeLabel?: string;
  tone?: ChatMessage["tone"];
  turnStatus?: ChatMessage["turnStatus"];
  turnStatusLabel?: string;
  artifactRefs: string[];
  quickReplies: NonNullable<ChatMessage["quickReplies"]>;
  deliveryPlan?: ChatDeliveryPlan;
  reaction?: ChatMessage["reaction"];
  projectionKind?: ChatMessage["projectionKind"];
};

export function chatMessageToAssistantUi(message: ChatMessage): ThreadMessageLike {
  const parts = message.parts?.length ? message.parts : legacyContentToMessageParts(message.body);
  const projected = projectMessagePartsToAssistantUi({
    id: message.id,
    role: message.speaker,
    parts,
  });

  const custom: ShanHaiAssistantMessageCustom = {
    projectMessageId: message.id,
    body: message.body,
    artifactRefs: [...(message.artifactRefs ?? [])],
    quickReplies: [...(message.quickReplies ?? [])],
    ...(message.title ? { title: message.title } : {}),
    ...(message.timeLabel ? { timeLabel: message.timeLabel } : {}),
    ...(message.tone ? { tone: message.tone } : {}),
    ...(message.turnStatus ? { turnStatus: message.turnStatus } : {}),
    ...(message.turnStatusLabel ? { turnStatusLabel: message.turnStatusLabel } : {}),
    ...(message.deliveryPlan ? { deliveryPlan: message.deliveryPlan } : {}),
    ...(message.reaction ? { reaction: message.reaction } : {}),
    ...(message.projectionKind ? { projectionKind: message.projectionKind } : {}),
  };

  return {
    id: projected.id,
    role: projected.role,
    content: projected.content,
    metadata: { custom },
  };
}

export function messageBodyFromAssistantUi(content: readonly { type: string; text?: string }[]) {
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}
