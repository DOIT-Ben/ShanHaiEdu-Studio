import type { OrchestrationAuditEvent, PrismaClient } from "@/generated/prisma/client";

import { digestOrchestrationAuditEvent } from "./orchestration-audit-event-digest";

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type ToolAuditEventInput = Omit<OrchestrationAuditEvent, "sequence" | "eventDigest" | "createdAt">;

export async function appendToolAuditEvent(tx: TransactionClient, input: ToolAuditEventInput) {
  return tx.orchestrationAuditEvent.create({
    data: { ...input, eventDigest: digestToolAuditEvent(input) },
  });
}

export function digestToolAuditEvent(event: ToolAuditEventInput | OrchestrationAuditEvent) {
  return digestOrchestrationAuditEvent(event, "shanhai-orchestration-audit-event.v1");
}
