import type { MainAgentTurn } from "@/server/capabilities/types";
import {
  discloseStandardTaskBudget,
  STANDARD_BUDGET_POLICY_VERSION,
} from "@/server/guards/action-policy";
import type { ConversationMessageRecord, ProjectRecord } from "@/server/workbench/types";

import type { MainAgentProgressSink } from "./main-agent-stream-projection";
import type { MainAgentTaskIntakeDecision, MainConversationAgent } from "./main-conversation-agent";
import { runWithProviderCallTraceBinding } from "@/server/provider-ledger/provider-call-trace";
import { hasValidTaskBrief, type IntentGrant, type TaskBrief } from "./task-contract";
import { createTaskBriefFromProposal } from "./task-intake";
import type { PreAgentControlDecision } from "./turn-intake-control";
import type { ControlPlaneStore } from "./conversation-turn-types";

export async function resolveActiveTaskBrief(input: {
  messages: ConversationMessageRecord[];
  message: ConversationMessageRecord;
  project: ProjectRecord;
  agent: MainConversationAgent;
  forceProposal?: boolean;
  onProgress?: MainAgentProgressSink;
  activeTask?: TaskBrief;
  turnJobId: string | null;
}): Promise<{
  taskBrief?: TaskBrief;
  precomputedTurn?: MainAgentTurn;
  control?: PreAgentControlDecision;
  replacementProposal?: Parameters<typeof createTaskBriefFromProposal>[0]["proposal"];
}> {
  const { messages, message, project } = input;
  const messageTaskBrief = message.metadata.taskBrief;
  if (!input.forceProposal && isTaskBrief(messageTaskBrief) &&
      messageTaskBrief.projectId === project.id &&
      messageTaskBrief.intentEpoch === (project.intentEpoch ?? 0) &&
      messageTaskBrief.sourceMessageId === message.id) {
    return { taskBrief: messageTaskBrief };
  }
  if (!input.forceProposal &&
      (isTaskControlMessage(message.content) || typeof message.metadata.confirmedActionId === "string")) {
    const active = findTaskBriefForIntent(messages, project.id, project.intentEpoch ?? 0);
    return active ? { taskBrief: active } : {};
  }

  let decision: MainAgentTaskIntakeDecision;
  if (input.agent.intakeTask) {
    decision = await runWithProviderCallTraceBinding({
      projectId: project.id,
      taskId: input.activeTask?.taskId,
      teacherMessageId: message.id,
      turnJobId: input.turnJobId,
      intentEpoch: project.intentEpoch ?? 0,
      phase: "intake",
    }, () => input.agent.intakeTask!({
      userMessage: message.content,
      responseStyle: message.metadata.responseStyle === "concise" ? "concise" : "pragmatic",
      generationIntensity: project.generationIntensity ?? "standard",
      projectContext: { grade: project.grade, subject: project.subject, topic: project.lessonTopic },
      activeTask: input.activeTask,
      recentMessages: messages.map((candidate) => ({ role: candidate.role, content: candidate.content })).slice(-8),
      onProgress: input.onProgress,
    }));
  } else {
    throw new Error("Main Agent structured task intake is required.");
  }

  if (decision.kind === "control") {
    return { control: decision.control, replacementProposal: decision.replacementProposal };
  }
  if (decision.kind !== "task") return { ...(decision.turn ? { precomputedTurn: decision.turn } : {}) };
  const projectConstraints = [project.grade, project.subject, project.lessonTopic]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());
  return {
    taskBrief: createTaskBriefFromProposal({
      proposal: {
        ...decision.proposal,
        goal: message.content.trim(),
        constraints: [...new Set([...decision.proposal.constraints, ...projectConstraints])],
      },
      taskId: `task:${message.id}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      generationIntensity: project.generationIntensity ?? "standard",
      sourceMessageId: message.id,
      context: {
        grade: project.grade,
        subject: project.subject,
        textbookVersion: project.textbookVersion,
        lessonTopic: project.lessonTopic,
      },
    }),
  };
}

export function createStandardIntentGrant(brief: TaskBrief): IntentGrant {
  return discloseStandardTaskBudget({
    schemaVersion: "intent-grant.v1",
    taskId: brief.taskId,
    projectId: brief.projectId,
    intentEpoch: brief.intentEpoch,
    standardWorkAuthorized: true,
    intensity: brief.generationIntensity,
    budgetPolicyVersion: STANDARD_BUDGET_POLICY_VERSION,
    maxCostCredits: null,
    maxExternalProviderCalls: null,
    requiredCheckpoints: [],
    expiresAt: null,
  }, brief);
}

export function ensureStandardTaskBudgetDisclosure(grant: IntentGrant, brief: TaskBrief): IntentGrant {
  if (!grant.standardWorkAuthorized || grant.maxCostCredits !== null) return grant;
  const needsTaskScopedDisclosure =
    (grant.budgetPolicyVersion === STANDARD_BUDGET_POLICY_VERSION && grant.maxExternalProviderCalls === null) ||
    (grant.budgetPolicyVersion === "v1-standard" && grant.maxExternalProviderCalls === 3);
  return needsTaskScopedDisclosure
    ? discloseStandardTaskBudget({
        ...grant,
        budgetPolicyVersion: STANDARD_BUDGET_POLICY_VERSION,
        maxExternalProviderCalls: null,
      }, brief)
    : grant;
}

export async function resolveQueuedTaskBriefBinding(input: {
  message: ConversationMessageRecord;
  project: ProjectRecord;
  controlPlaneStore: ControlPlaneStore;
}): Promise<TaskBrief | undefined> {
  const candidate = input.message.metadata.taskBrief;
  if (candidate === undefined) return undefined;
  if (!isTaskBrief(candidate) || !hasValidTaskBrief(candidate) || candidate.projectId !== input.project.id ||
      candidate.intentEpoch !== (input.project.intentEpoch ?? 0) || candidate.sourceMessageId !== input.message.id) {
    throw new Error("queued_task_brief_binding_invalid");
  }
  const aggregate = await input.controlPlaneStore.getTaskAggregate(candidate.projectId, candidate.intentEpoch);
  if (!aggregate || aggregate.taskBrief.taskId !== candidate.taskId || aggregate.taskBrief.digest !== candidate.digest ||
      !["active", "paused_recovery"].includes(aggregate.status)) {
    throw new Error("queued_task_brief_binding_invalid");
  }
  return candidate;
}

export function findTaskBriefForIntent(
  messages: ConversationMessageRecord[],
  projectId: string,
  intentEpoch: number,
) {
  for (const candidate of [...messages].reverse()) {
    const brief = candidate.metadata.taskBrief;
    if (isTaskBrief(brief) && brief.projectId === projectId && brief.intentEpoch === intentEpoch) return brief;
  }
  return undefined;
}

export function resolveActiveIntentGrant(
  messages: ConversationMessageRecord[],
  brief: TaskBrief,
): IntentGrant | undefined {
  for (const message of [...messages].reverse()) {
    const grant = message.metadata.intentGrant;
    if (!isIntentGrant(grant) || grant.projectId !== brief.projectId || grant.taskId !== brief.taskId ||
        grant.intentEpoch !== brief.intentEpoch) continue;
    return {
      ...grant,
      maxExternalProviderCalls: typeof grant.maxExternalProviderCalls === "number"
        ? grant.maxExternalProviderCalls
        : null,
    };
  }
  return undefined;
}

function isTaskControlMessage(content: string) {
  const normalized = content.trim();
  if (/^(继续|确定|确认|开始|暂停|恢复|取消|确认开始|继续下一步|继续推进|按这个计划推进|确认需求并生成大纲)(?:[，,].*)?[。.!！]?$/.test(normalized)) return true;
  return /^(?:继续|恢复|接着)(?:刚才|之前|当前|上次|这个|该)(?!.*(?:新的|改成|改做|换成|转为|只做|不要做|不做)).{0,80}$/.test(normalized);
}

function isTaskBrief(value: unknown): value is TaskBrief {
  return typeof value === "object" && value !== null && (value as TaskBrief).schemaVersion === "task-brief.v1";
}

function isIntentGrant(value: unknown): value is IntentGrant {
  return typeof value === "object" && value !== null &&
    (value as IntentGrant).schemaVersion === "intent-grant.v1" &&
    typeof (value as IntentGrant).standardWorkAuthorized === "boolean";
}
