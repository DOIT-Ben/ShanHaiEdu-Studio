export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { scheduleRetryableConversationTurnRecovery } = await import("@/server/conversation/conversation-turn-recovery");
  scheduleRetryableConversationTurnRecovery();
}
