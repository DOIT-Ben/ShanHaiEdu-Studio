import type { AgentEventEnvelope } from "@/server/conversation/agent-event-envelope";
import type { AgentEventInput } from "@/server/conversation/control-plane-store";

import {
  SHANHAI_RUNTIME_EVENT_VERSION,
  type SkillRuntimeEvent,
  type SkillRuntimeEventType,
} from "./skill-runtime-types";

export { SHANHAI_RUNTIME_EVENT_VERSION } from "./skill-runtime-types";
export type { SkillRuntimeEvent } from "./skill-runtime-types";

export type SkillRuntimeEventContext = {
  projectId: string;
  taskId: string;
  intentEpoch: number;
};

export type SkillRuntimeEventStore = {
  appendEvent(input: AgentEventInput): Promise<AgentEventEnvelope>;
};

const RUNTIME_EVENT_TYPES = new Set<SkillRuntimeEventType>([
  "stage_started",
  "capability_requested",
  "artifact_emitted",
  "quality_failed",
  "needs_input",
  "needs_review",
  "blocked",
  "completed",
  "cancelled",
]);

const RUNTIME_EVENT_FIELDS = new Set([
  "schemaVersion",
  "eventId",
  "runId",
  "invocationId",
  "sequence",
  "occurredAt",
  "type",
  "skill",
  "artifactId",
  "capability",
  "reasonCode",
  "message",
]);

export function toAgentEventInput(
  event: SkillRuntimeEvent,
  context: SkillRuntimeEventContext,
): AgentEventInput {
  assertRuntimeEvent(event);
  assertContext(context);

  return {
    eventId: event.eventId,
    projectId: context.projectId.trim(),
    taskId: context.taskId.trim(),
    runId: event.runId,
    intentEpoch: context.intentEpoch,
    kind: event.type === "stage_started" ? "tool_started" : "tool_observed",
    visibility: "internal",
    occurredAt: event.occurredAt,
    payload: compactPayload({
      source: "shanhai_skill_runtime",
      transportOnly: true,
      orchestrationAuthority: "main_agent",
      invocationId: event.invocationId,
      runtimeEventSequence: event.sequence,
      runtimeEventType: event.type,
      skill: structuredClone(event.skill),
      artifactId: event.artifactId,
      capability: event.capability,
      reasonCode: event.reasonCode,
      message: event.message,
    }),
  };
}

export async function persistSkillRuntimeEvent(
  store: SkillRuntimeEventStore,
  event: SkillRuntimeEvent,
  context: SkillRuntimeEventContext,
): Promise<AgentEventEnvelope> {
  return store.appendEvent(toAgentEventInput(event, context));
}

function assertRuntimeEvent(event: SkillRuntimeEvent): void {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("Skill RuntimeEvent is required.");
  }
  const unknownFields = Object.keys(event).filter((field) => !RUNTIME_EVENT_FIELDS.has(field));
  if (unknownFields.length) throw new Error(`Skill RuntimeEvent has unknown fields: ${unknownFields.join(", ")}.`);
  if (event.schemaVersion !== SHANHAI_RUNTIME_EVENT_VERSION) {
    throw new Error("Skill RuntimeEvent schemaVersion is invalid.");
  }
  requireId(event.eventId, "eventId");
  requireId(event.runId, "runId");
  requireId(event.invocationId, "invocationId");
  if (!Number.isInteger(event.sequence) || event.sequence < 0) {
    throw new Error("Skill RuntimeEvent sequence must be a non-negative integer.");
  }
  if (!Number.isFinite(Date.parse(event.occurredAt))) {
    throw new Error("Skill RuntimeEvent occurredAt is invalid.");
  }
  if (!RUNTIME_EVENT_TYPES.has(event.type)) {
    throw new Error("Skill RuntimeEvent type is invalid.");
  }
  if (!event.skill || typeof event.skill !== "object" || Array.isArray(event.skill)) {
    throw new Error("Skill RuntimeEvent skill is invalid.");
  }
  const skillFields = Object.keys(event.skill).sort();
  if (skillFields.length !== 2 || skillFields[0] !== "name" || skillFields[1] !== "version") {
    throw new Error("Skill RuntimeEvent skill fields are invalid.");
  }
  if (!/^shanhai-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(event.skill.name)) {
    throw new Error("Skill RuntimeEvent skill name is invalid.");
  }
  if (!/^\d+\.\d+$/.test(event.skill.version)) {
    throw new Error("Skill RuntimeEvent skill version is invalid.");
  }
  requireOptionalText(event.artifactId, "artifactId");
  requireOptionalText(event.capability, "capability");
  requireOptionalText(event.reasonCode, "reasonCode");
  if (!event.message?.trim()) throw new Error("Skill RuntimeEvent message is required.");
}

function assertContext(context: SkillRuntimeEventContext): void {
  if (!context?.projectId?.trim()) throw new Error("Skill RuntimeEvent projectId is required.");
  if (!context.taskId?.trim()) throw new Error("Skill RuntimeEvent taskId is required.");
  if (!Number.isInteger(context.intentEpoch) || context.intentEpoch < 0) {
    throw new Error("Skill RuntimeEvent intentEpoch must be a non-negative integer.");
  }
}

function requireId(value: string, field: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`Skill RuntimeEvent ${field} is invalid.`);
  }
}

function requireOptionalText(value: string | null | undefined, field: string): void {
  if (value !== undefined && value !== null && !value.trim()) {
    throw new Error(`Skill RuntimeEvent ${field} is invalid.`);
  }
}

function compactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== null));
}
