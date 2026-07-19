import type { MainConversationAgentInput } from "./main-conversation-agent";

type ConversationContext = NonNullable<MainConversationAgentInput["conversationContext"]>;

export function projectMainAgentRequestContext(context: ConversationContext | undefined) {
  const contextPackage = context?.contextPackage ?? null;
  const semanticSnapshot = context?.semanticSnapshot ?? null;
  return {
    contextPackage,
    agentWorldState: context?.agentWorldState ?? null,
    capabilityAvailability: context?.capabilityAvailability ?? [],
    semanticSnapshot,
    pendingDecision: semanticSnapshot?.pendingDecision ?? null,
    conversationWindow: contextPackage
      ? null
      : {
          recentMessages: context?.recentMessages ?? [],
          latestAssistantContent: context?.latestAssistantContent ?? null,
        },
  };
}
