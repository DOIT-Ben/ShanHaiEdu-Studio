import { getCapabilityDefinitions } from "@/server/capabilities/capability-registry";
import { resolveMainAgentToolDefinition } from "@/server/tools/main-agent-tool-registry";

import type { MainAgentProgressEvent, MainAgentProgressSink } from "./main-agent-stream-projection";
import type { TaskBrief } from "./task-contract";
import type { ControlPlaneStore } from "./conversation-turn-types";

export function createMainAgentProgressWriter(input: {
  projectId: string;
  teacherMessageId: string;
  projectIntentEpoch: number;
  controlPlaneStore: ControlPlaneStore;
  getTaskBrief: () => TaskBrief | undefined;
}): MainAgentProgressSink {
  const runId = `turn:${input.teacherMessageId}`;
  let toolSequence = 0;
  const activeTools = new Map<string, ActiveToolProjection>();
  let pendingText = "";
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let writeChain = Promise.resolve();
  const enqueue = (progress: MainAgentProgressEvent) => {
    writeChain = writeChain.then(async () => {
      try {
        const taskBrief = input.getTaskBrief();
        const event = progressEventToAgentEvent(progress, {
          projectId: input.projectId,
          taskId: taskBrief?.taskId ?? `conversation-turn:${input.teacherMessageId}`,
          runId,
          intentEpoch: taskBrief?.intentEpoch ?? input.projectIntentEpoch,
        }, activeTools, () => ++toolSequence);
        if (event) await input.controlPlaneStore.appendEvent(event);
      } catch {
        // Progress projection must never become a second execution or failure path.
      }
    });
  };
  const flushText = () => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = undefined;
    if (!pendingText) return;
    const delta = pendingText;
    pendingText = "";
    enqueue({ type: "text_delta", delta });
  };
  return async (progress) => {
    if (progress.type === "text_delta") {
      pendingText += progress.delta;
      if (pendingText.length >= 256) flushText();
      else if (!flushTimer) flushTimer = setTimeout(flushText, 100);
      return;
    }
    flushText();
    enqueue(progress);
    await writeChain;
  };
}

type ActiveToolProjection = {
  activityId: string;
  startedAt: string;
  purpose?: string;
  inputSummary?: string[];
  expectedOutput?: string;
};

function progressEventToAgentEvent(
  progress: MainAgentProgressEvent,
  scope: { projectId: string; taskId: string; runId: string; intentEpoch: number },
  activeTools: Map<string, ActiveToolProjection>,
  nextToolSequence: () => number,
): Parameters<ControlPlaneStore["appendEvent"]>[0] | null {
  const base = { eventId: crypto.randomUUID(), ...scope, occurredAt: new Date().toISOString() };
  if (progress.type === "response_started") {
    return { ...base, kind: "text_started", visibility: "teacher", payload: { status: "running" } };
  }
  if (progress.type === "text_delta") {
    return { ...base, kind: "text_delta", visibility: "teacher", payload: { text: progress.delta } };
  }
  if (progress.type === "step_started") {
    const activityId = `${scope.runId}:tool:${nextToolSequence()}`;
    activeTools.set(progress.toolName, {
      activityId,
      startedAt: base.occurredAt,
      ...(progress.purpose ? { purpose: progress.purpose } : {}),
      ...(progress.inputSummary?.length ? { inputSummary: [...progress.inputSummary] } : {}),
      ...(progress.expectedOutput ? { expectedOutput: progress.expectedOutput } : {}),
    });
    return {
      ...base,
      kind: "tool_started",
      visibility: "teacher",
      payload: {
        activityId,
        label: `正在${capabilityTeacherLabel(progress.toolName)}`,
        status: "running",
        ...(progress.purpose ? { purpose: progress.purpose } : {}),
        ...(progress.inputSummary?.length ? { inputSummary: [...progress.inputSummary] } : {}),
        ...(progress.expectedOutput ? { expectedOutput: progress.expectedOutput } : {}),
        startedAt: base.occurredAt,
      },
    };
  }
  if (progress.type === "step_observed") return observedProgressEvent(progress, base, scope, activeTools, nextToolSequence);
  if (progress.type === "response_completed") {
    return {
      ...base,
      kind: "activity_updated",
      visibility: "internal",
      payload: {
        activityId: `${scope.runId}:response-metrics`,
        label: "Main Agent response metrics",
        status: "completed",
        usage: progress.usage,
        telemetry: progress.telemetry,
      },
    };
  }
  return {
    ...base,
    kind: "activity_updated",
    visibility: "teacher",
    payload: { activityId: `${scope.runId}:response`, label: progress.summary, status: "failed" },
  };
}

function observedProgressEvent(
  progress: Extract<MainAgentProgressEvent, { type: "step_observed" }>,
  base: { eventId: string; projectId: string; taskId: string; runId: string; intentEpoch: number; occurredAt: string },
  scope: { runId: string },
  activeTools: Map<string, ActiveToolProjection>,
  nextToolSequence: () => number,
): Parameters<ControlPlaneStore["appendEvent"]>[0] {
  const active = activeTools.get(progress.toolName);
  const activityId = active?.activityId ?? `${scope.runId}:tool:${nextToolSequence()}`;
  activeTools.delete(progress.toolName);
  const status = progress.status === "succeeded" ? "succeeded"
    : progress.status === "needs_input" ? "blocked"
    : progress.status;
  return {
    ...base,
    kind: "tool_observed",
    visibility: "teacher",
    payload: {
      activityId,
      label: toolObservationLabel(progress.toolName, progress.status, progress.summary),
      status,
      ...(progress.observationId ? { observationId: progress.observationId } : {}),
      ...(progress.reasonCodes[0] ? { reasonCode: progress.reasonCodes[0] } : {}),
      ...(progress.nextAction ? { nextAction: progress.nextAction } : {}),
      ...(progress.artifactRefs?.length ? { artifactRefs: structuredClone(progress.artifactRefs) } : {}),
      ...(progress.summary ? { observationSummary: progress.summary } : {}),
      ...(active?.purpose ? { purpose: active.purpose } : {}),
      ...(active?.inputSummary?.length ? { inputSummary: [...active.inputSummary] } : {}),
      ...(active?.expectedOutput ? { expectedOutput: active.expectedOutput } : {}),
      ...(active?.startedAt ? {
        startedAt: active.startedAt,
        finishedAt: base.occurredAt,
        durationMs: Math.max(0, Date.parse(base.occurredAt) - Date.parse(active.startedAt)),
      } : {}),
    },
  };
}

export function capabilityTeacherLabel(toolName: string) {
  try {
    return resolveMainAgentToolDefinition(toolName).label;
  } catch {
    return getCapabilityDefinitions().find((definition) => definition.id === toolName)?.userLabel
      ?? "执行当前步骤";
  }
}

function toolObservationLabel(
  toolName: string,
  status: Extract<MainAgentProgressEvent, { type: "step_observed" }>["status"],
  summary?: string,
) {
  if (summary?.trim()) return summary.trim();
  const label = capabilityTeacherLabel(toolName);
  if (status === "succeeded") return `${label}已完成，正在判断下一步`;
  if (status === "repair" || status === "inconclusive") return `${label}需要调整，正在重新规划`;
  if (status === "needs_input" || status === "blocked") return `${label}暂时无法继续`;
  return `${label}未完成，已保存失败位置`;
}
