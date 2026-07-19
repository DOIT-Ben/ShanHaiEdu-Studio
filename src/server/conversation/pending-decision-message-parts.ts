import { normalizeMessageParts, type MessagePart } from "@/lib/conversation-message-contract";

export function removeResolvedDecisionParts(
  value: unknown,
  decision: { decisionId: string; actionId: string },
): MessagePart[] {
  const retained: MessagePart[] = [];
  for (const part of normalizeMessageParts(parseParts(value))) {
    if (part.type === "human-input" && part.decisionId === decision.decisionId) continue;
    if (part.type !== "next-actions") {
      retained.push(part);
      continue;
    }
    const actions = part.actions.filter((action) =>
      action.actionId !== decision.actionId && !action.id.startsWith(`decision:${decision.decisionId}:`));
    if (actions.length > 0) retained.push({ ...part, actions });
  }
  return retained;
}

function parseParts(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return [];
  }
}
