import type { createWorkbenchService } from "@/server/workbench/service";
import type { ConversationMessageRecord } from "@/server/workbench/types";

import type { PersistedTaskAggregate, createControlPlaneStore } from "./control-plane-store";
import type { SemanticContextSnapshot } from "./context-semantic-snapshot";
import { persistPendingDecisionStatus } from "./pending-decision-lifecycle";
import {
  withPendingDecisionStatus,
  type IntentGrant,
  type PendingDecision,
  type TaskBrief,
} from "./task-contract";

type WorkbenchService = ReturnType<typeof createWorkbenchService>;
type ControlPlaneStore = ReturnType<typeof createControlPlaneStore>;

export async function commitConversationTurnTaskState(input: {
  service: WorkbenchService;
  controlPlaneStore: ControlPlaneStore;
  projectId: string;
  triggerMessage: ConversationMessageRecord;
  taskBrief: TaskBrief;
  intentGrant: IntentGrant;
  confirmedPendingDecision?: PendingDecision;
  previousSnapshot?: SemanticContextSnapshot;
}) {
  const existingAggregate = await input.controlPlaneStore.getTaskAggregate(
    input.taskBrief.projectId,
    input.taskBrief.intentEpoch,
  );
  const resumesSameTask = existingAggregate?.status === "paused_recovery" &&
    existingAggregate.taskBrief.taskId === input.taskBrief.taskId &&
    existingAggregate.taskBrief.digest === input.taskBrief.digest;
  const nextPlan = existingAggregate ? {
    ...existingAggregate.plan,
    status: resumesSameTask ? "active" : existingAggregate.plan.status,
  } : {
    planId: `plan:${input.taskBrief.taskId}`,
    revision: 0,
    status: "active",
  };

  if (input.confirmedPendingDecision) {
    if (!existingAggregate || !resumesSameTask) {
      throw new Error("PendingDecision cannot resume a stale task aggregate.");
    }
    return commitConfirmedDecisionState(input, existingAggregate, nextPlan);
  }
  return commitRegularTaskState(input, existingAggregate, resumesSameTask, nextPlan);
}

async function commitConfirmedDecisionState(
  input: Parameters<typeof commitConversationTurnTaskState>[0] & { confirmedPendingDecision?: PendingDecision },
  existingAggregate: PersistedTaskAggregate,
  nextPlan: PersistedTaskAggregate["plan"],
) {
  const decision = input.confirmedPendingDecision;
  if (!decision) throw new Error("PendingDecision confirmation is required.");
  const triggerMessage = {
    ...input.triggerMessage,
    metadata: {
      ...input.triggerMessage.metadata,
      taskBrief: input.taskBrief,
      intentGrant: input.intentGrant,
    },
  };
  const committed = await persistPendingDecisionStatus({
    service: input.service,
    controlPlaneStore: input.controlPlaneStore,
    projectId: input.projectId,
    triggerMessage,
    taskBrief: input.taskBrief,
    aggregate: {
      taskBrief: input.taskBrief,
      intentGrant: input.intentGrant,
      plan: nextPlan,
      status: nextPlan.status,
      checkpoint: existingAggregate.checkpoint,
    },
    previousSnapshot: input.previousSnapshot,
    decision,
    status: "confirmed",
  });
  return {
    taskAggregate: committed.aggregate,
    taskEventSequence: committed.sequence,
    triggerMessage: {
      ...triggerMessage,
      metadata: {
        ...triggerMessage.metadata,
        pendingDecision: withPendingDecisionStatus(decision, "confirmed"),
      },
    },
  };
}

async function commitRegularTaskState(
  input: Parameters<typeof commitConversationTurnTaskState>[0],
  existingAggregate: PersistedTaskAggregate | null,
  resumesSameTask: boolean,
  nextPlan: PersistedTaskAggregate["plan"],
) {
  const resumesReActCheckpoint = resumesSameTask &&
    existingAggregate?.checkpoint?.schemaVersion === "react-checkpoint.v1";
  const taskAggregate = resumesSameTask && !resumesReActCheckpoint
    ? await input.controlPlaneStore.resumeTaskAggregate({
        taskBrief: input.taskBrief,
        intentGrant: input.intentGrant,
        plan: nextPlan,
      })
    : await input.controlPlaneStore.upsertTaskAggregate({
        taskBrief: input.taskBrief,
        intentGrant: input.intentGrant,
        plan: nextPlan,
        status: resumesSameTask ? "active" : existingAggregate?.status ?? "active",
        checkpoint: existingAggregate?.checkpoint ?? null,
      });
  const taskEvent = await input.controlPlaneStore.appendEvent({
    eventId: crypto.randomUUID(),
    projectId: input.taskBrief.projectId,
    taskId: input.taskBrief.taskId,
    runId: `turn:${input.triggerMessage.id}`,
    intentEpoch: input.taskBrief.intentEpoch,
    kind: existingAggregate ? "task_updated" : "task_created",
    visibility: "internal",
    occurredAt: new Date().toISOString(),
    payload: { taskBriefDigest: input.taskBrief.digest, planRevision: taskAggregate.plan.revision },
  });
  let taskEventSequence = taskEvent.sequence;
  if (!existingAggregate) {
    const scopeProjection = taskScopeTeacherProjection(input.taskBrief);
    const occurredAt = new Date().toISOString();
    const scopeEvent = await input.controlPlaneStore.appendEvent({
      eventId: crypto.randomUUID(),
      projectId: input.taskBrief.projectId,
      taskId: input.taskBrief.taskId,
      runId: `turn:${input.triggerMessage.id}`,
      intentEpoch: input.taskBrief.intentEpoch,
      kind: "activity_updated",
      visibility: "teacher",
      occurredAt,
      payload: {
        activityId: `turn:${input.triggerMessage.id}:task-scope`,
        label: "本轮目标已明确",
        status: "completed",
        purpose: input.taskBrief.goal,
        inputSummary: scopeProjection.inputSummary,
        expectedOutput: scopeProjection.expectedOutput,
        finishedAt: occurredAt,
      },
    });
    taskEventSequence = scopeEvent.sequence;
  }
  const triggerMessage = await input.service.updateMessageMetadata(input.projectId, input.triggerMessage.id, {
    ...input.triggerMessage.metadata,
    taskBrief: input.taskBrief,
    intentGrant: input.intentGrant,
  });
  return { taskAggregate, taskEventSequence, triggerMessage };
}

const taskOutputTeacherLabels: Record<string, string> = {
  requirement_spec: "需求规格",
  lesson_plan: "公开课教案",
  ppt: "可编辑 PPTX",
  ppt_outline: "PPT 结构候选",
  video_script: "视频脚本",
  image: "图片资产",
  video: "视频成片",
  package: "完整材料包",
};

function taskScopeTeacherProjection(taskBrief: TaskBrief) {
  const requested = [...new Set(taskBrief.requestedOutputs.map(taskOutputTeacherLabel))];
  const excluded = [...new Set(taskBrief.excludedOutputs.map(taskOutputTeacherLabel))];
  const requestedLabel = requested.join("、") || "当前任务成果";
  return {
    inputSummary: [
      `交付范围：${requestedLabel}`,
      ...(excluded.length ? [`明确不包含：${excluded.join("、")}`] : []),
    ],
    expectedOutput: `可继续审阅的${requestedLabel}`,
  };
}

function taskOutputTeacherLabel(output: string) {
  return taskOutputTeacherLabels[output] ?? output;
}
