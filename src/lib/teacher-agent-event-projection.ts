import { toDialogueCheckpointPart, type ActivityMessagePart } from "./conversation-message-parts";
import { TEACHER_AGENT_EVENT_VERSION, type TeacherAgentEvent } from "./teacher-agent-event-contract";
import type { AgentEventEnvelope, AgentEventKind } from "@/server/conversation/agent-event-envelope";

export function projectTeacherAgentEvent(event: AgentEventEnvelope): TeacherAgentEvent | null {
  if (!isEnvelopeShape(event) || event.visibility !== "teacher") return null;
  const activity = activityFromEvent(event);
  if (!activity) return null;
  const text = isTextEvent(event.kind) ? teacherSafeEventText(event.payload.text) : undefined;
  const dialogueCheckpoint = event.kind === "decision_pending"
    ? toDialogueCheckpointPart(event.payload.dialogueCheckpoint)
    : undefined;
  return {
    schemaVersion: TEACHER_AGENT_EVENT_VERSION,
    eventId: event.eventId,
    projectId: event.projectId,
    taskId: event.taskId,
    runId: event.runId,
    intentEpoch: event.intentEpoch,
    sequence: event.sequence,
    kind: event.kind,
    visibility: "teacher",
    occurredAt: event.occurredAt,
    payload: {
      activity,
      ...(text ? { text } : {}),
      ...(dialogueCheckpoint ? { dialogueCheckpoint } : {}),
    },
  };
}

export function isBusinessActivityEvent(kind: AgentEventKind) {
  return [
    "activity_updated",
    "tool_started",
    "tool_observed",
    "decision_pending",
    "artifact_committed",
    "quality_updated",
    "run_completed",
    "run_failed",
    "task_failed",
  ].includes(kind);
}

export function isSubstantiveActivityEvent(kind: AgentEventKind) {
  return isBusinessActivityEvent(kind) && kind !== "run_completed" && kind !== "run_failed" && kind !== "task_failed";
}

export function isTextEvent(kind: AgentEventKind) {
  return kind === "text_started" || kind === "text_delta" || kind === "text_completed";
}

function activityFromEvent(event: AgentEventEnvelope): TeacherAgentEvent["payload"]["activity"] | null {
  if (event.kind === "activity_updated" && event.visibility === "teacher") {
    const activityId = optionalText(event.payload.activityId) ?? event.runId;
    const label = teacherSafeText(event.payload.label) ?? eventLabel(event.kind);
    return activityProjection(event, activityId, label, activityStatus(event.kind, event.payload.status, event.payload.control));
  }
  if (event.kind === "tool_started" || event.kind === "tool_observed") {
    const activityId = optionalText(event.payload.activityId) ?? event.runId;
    const label = teacherSafeText(event.payload.label) ?? eventLabel(event.kind);
    return activityProjection(event, activityId, label, activityStatus(event.kind, event.payload.status, event.payload.control));
  }
  return activityProjection(
    event,
    event.runId,
    teacherSafeText(event.payload.label) ?? eventLabel(event.kind),
    activityStatus(event.kind, event.payload.status, event.payload.control),
  );
}

function activityProjection(
  event: AgentEventEnvelope,
  activityId: string,
  label: string,
  status: ActivityMessagePart["status"],
): TeacherAgentEvent["payload"]["activity"] {
  const reasonCode = optionalText(event.payload.reasonCode);
  const artifactRefs = artifactRefsFromPayload(event.payload);
  const purpose = teacherSafeText(event.payload.purpose);
  const inputSummary = teacherSafeTextArray(event.payload.inputSummary);
  const expectedOutput = teacherSafeText(event.payload.expectedOutput);
  const observationSummary = teacherSafeText(event.payload.observationSummary);
  return {
    activityId,
    label,
    status,
    evidenceRefs: evidenceRefs(event.payload),
    activityKind: activityKind(event.kind),
    ...(reasonCode ? { reasonCode } : {}),
    ...(artifactRefs.length ? { artifactRefs } : {}),
    ...(purpose ? { purpose } : {}),
    ...(inputSummary.length ? { inputSummary } : {}),
    ...(expectedOutput ? { expectedOutput } : {}),
    ...(observationSummary ? { observationSummary } : {}),
    ...(validEventDate(event.payload.startedAt) ? { startedAt: String(event.payload.startedAt) } : {}),
    ...(validEventDate(event.payload.finishedAt) ? { finishedAt: String(event.payload.finishedAt) } : {}),
    ...(isNonNegativeNumber(event.payload.durationMs) ? { durationMs: event.payload.durationMs } : {}),
  };
}

function activityKind(kind: AgentEventKind): NonNullable<ActivityMessagePart["activityKind"]> {
  if (kind === "tool_started" || kind === "tool_observed") return "tool";
  if (kind === "artifact_committed") return "artifact";
  if (kind === "quality_updated") return "quality";
  if (kind === "decision_pending") return "decision";
  if (isTextEvent(kind)) return "response";
  return "task";
}

function eventLabel(kind: AgentEventKind) {
  const labels: Record<AgentEventKind, string> = {
    task_created: "正在理解你的备课要求",
    task_updated: "已保存任务变化，正在重新安排",
    run_started: "正在推进这项任务",
    run_completed: "本轮任务已经完成",
    run_failed: "本轮没有完成，进度已经保存",
    text_started: "正在组织回复",
    text_delta: "正在组织回复",
    text_completed: "回复已经整理完成",
    activity_updated: "正在更新任务进度",
    tool_started: "正在执行当前步骤",
    tool_observed: "已读取当前步骤结果，正在决定下一步",
    decision_pending: "需要你做一个选择",
    artifact_committed: "已保存当前成果，正在决定下一步",
    quality_updated: "正在检查当前成果",
    task_failed: "任务暂时无法继续，进度已经保存",
  };
  return labels[kind];
}

function activityStatus(kind: AgentEventKind, rawStatus: unknown, control: unknown): ActivityMessagePart["status"] {
  if (kind === "task_updated" && control === "pause") return "paused";
  if (kind === "task_updated" && control === "cancel") return "canceled";
  if (["task_created", "run_started", "text_started", "text_delta", "tool_started"].includes(kind)) return "running";
  if (kind === "run_completed" || kind === "text_completed") return "completed";
  if (kind === "run_failed" && rawStatus === "blocked") return "blocked";
  if (kind === "run_failed" || kind === "task_failed") return "failed";
  if (kind === "decision_pending") return "waiting";
  if (rawStatus === "failed") return "failed";
  if (rawStatus === "succeeded") return "succeeded";
  if (rawStatus === "completed") return "completed";
  if (rawStatus === "blocked" || rawStatus === "needs_input" || rawStatus === "repair") return "blocked";
  if (rawStatus === "paused") return "paused";
  if (rawStatus === "canceled") return "canceled";
  return "running";
}

function evidenceRefs(payload: Record<string, unknown>) {
  const refs = ["observationId", "artifactId", "decisionId", "messageId", "checkpointId"]
    .flatMap((key) => optionalText(payload[key]) ? [String(payload[key]).trim()] : []);
  return [...new Set(refs)];
}

function artifactRefsFromPayload(payload: Record<string, unknown>) {
  const refs = Array.isArray(payload.artifactRefs) ? payload.artifactRefs : [];
  return [...new Set(refs.flatMap((value) => {
    if (typeof value === "string" && value.trim()) return [value.trim()];
    if (isRecord(value) && optionalText(value.artifactId)) return [String(value.artifactId).trim()];
    return [];
  }))];
}

function isEnvelopeShape(value: AgentEventEnvelope) {
  return value?.schemaVersion === TEACHER_AGENT_EVENT_VERSION
    && Boolean(optionalText(value.eventId)) && Boolean(optionalText(value.projectId))
    && Boolean(optionalText(value.taskId)) && Boolean(optionalText(value.runId))
    && Number.isInteger(value.intentEpoch) && value.intentEpoch >= 0
    && Number.isInteger(value.sequence) && value.sequence > 0
    && isEventKind(value.kind) && (value.visibility === "teacher" || value.visibility === "internal")
    && Number.isFinite(Date.parse(value.occurredAt)) && isRecord(value.payload);
}

function isEventKind(value: unknown): value is AgentEventKind {
  return [
    "task_created", "task_updated", "run_started", "run_completed", "run_failed",
    "text_started", "text_delta", "text_completed", "activity_updated", "tool_started",
    "tool_observed", "decision_pending", "artifact_committed", "quality_updated", "task_failed",
  ].includes(String(value));
}

function teacherSafeText(value: unknown) {
  const text = optionalText(value);
  return text ? sanitizeTeacherVisibleText(text).slice(0, 500) : undefined;
}

function teacherSafeEventText(value: unknown) {
  return typeof value === "string" && value.length > 0 ? sanitizeTeacherVisibleText(value).slice(0, 500) : undefined;
}

function sanitizeTeacherVisibleText(value: string) {
  return value
    .replace(/Observation\.reasonCodes|reasonCodes/gi, "上一步结果中的具体问题")
    .replace(/ExecutionEnvelope/gi, "当前执行范围")
    .replace(/TaskBrief/gi, "当前任务说明")
    .replace(/IntentEpoch/gi, "当前任务版本")
    .replace(/Director/gi, "设计审查")
    .replace(/repairIssues/gi, "待修正项")
    .replace(/Artifact/gi, "成果")
    .replace(/schema/gi, "结构要求")
    .replace(/manifest|provider|node_id|storage|debug|local\s+path|capabilityId|runtimeKind|providerStatus|placeholder/gi, "任务信息")
    .replace(/\bAPI(?:\s*key)?\b/gi, "服务信息");
}

function teacherSafeTextArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => teacherSafeText(item) ? [teacherSafeText(item)!] : []).slice(0, 6);
}

function validEventDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
