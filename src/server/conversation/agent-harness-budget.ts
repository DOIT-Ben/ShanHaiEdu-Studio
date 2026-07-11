export type AgentHarnessBudgetPolicy = {
  maxSameActionRepeat: number;
  maxConsecutiveFailures: number;
  maxRetryPerCapability: number;
  maxContextBudgetTokens: number;
  requiresHumanGateForSideEffects: boolean;
};

export type AgentHarnessBudgetEventStatus = "blocked" | "failed" | "retryable_failed" | "succeeded";

export type AgentHarnessBudgetEventKind =
  | "provider_unavailable"
  | "tool_failed"
  | "quality_gate_failed"
  | "blocked_by_policy"
  | "retry_exhausted"
  | "tool_succeeded";

export type AgentHarnessBudgetEvent = {
  capabilityId: string;
  actionKey: string;
  status: AgentHarnessBudgetEventStatus;
  kind: AgentHarnessBudgetEventKind;
  createdAt: string;
};

export type AgentHarnessBudgetDecisionReason =
  | "same_action_repeat_exhausted"
  | "consecutive_failures_exhausted"
  | "capability_retry_exhausted"
  | "context_budget_exhausted"
  | "human_gate_required";

export type AgentHarnessBudgetDecision = {
  allowed: boolean;
  reason?: AgentHarnessBudgetDecisionReason;
  teacherSafeSummary?: string;
};

export type EvaluateAgentHarnessBudgetInput = {
  capabilityId: string;
  actionKey: string;
  events: AgentHarnessBudgetEvent[];
  contextTokenEstimate?: number;
  isSideEffectful?: boolean;
  hasConfirmedHumanGate?: boolean;
  policy?: Partial<AgentHarnessBudgetPolicy>;
};

export type BuildAgentHarnessBudgetEventInput = {
  capabilityId: string;
  actionKey?: string;
  expectedArtifactKind?: string;
  status: AgentHarnessBudgetEventStatus;
  kind: AgentHarnessBudgetEventKind;
  createdAt?: string;
};

export const DEFAULT_AGENT_HARNESS_BUDGET_POLICY: AgentHarnessBudgetPolicy = {
  maxSameActionRepeat: 2,
  maxConsecutiveFailures: 3,
  maxRetryPerCapability: 2,
  maxContextBudgetTokens: 12_000,
  requiresHumanGateForSideEffects: true,
};

const failureStatuses = new Set<AgentHarnessBudgetEventStatus>(["blocked", "failed", "retryable_failed"]);
const retryStatuses = new Set<AgentHarnessBudgetEventStatus>(["failed", "retryable_failed"]);

export function evaluateAgentHarnessBudget(input: EvaluateAgentHarnessBudgetInput): AgentHarnessBudgetDecision {
  const policy = resolvePolicy(input.policy);
  const events = filterEventsAfterLatestRelevantSuccess(
    input.events.filter(isAgentHarnessBudgetEvent).filter((event) => event.kind !== "blocked_by_policy"),
    input.capabilityId,
    input.actionKey,
  );
  const reason = resolveBlockedReason(input, events, policy);

  if (reason) {
    return {
      allowed: false,
      reason,
      teacherSafeSummary: teacherSafeSummaryByReason[reason],
    };
  }

  return {
    allowed: true,
    teacherSafeSummary: "可以继续处理这一步。",
  };
}

export function buildAgentHarnessBudgetEvent(input: BuildAgentHarnessBudgetEventInput): AgentHarnessBudgetEvent {
  return {
    capabilityId: input.capabilityId,
    actionKey: input.actionKey ?? `${input.capabilityId}:${input.expectedArtifactKind ?? ""}`,
    status: input.status,
    kind: input.kind,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function readAgentHarnessBudgetEventsFromMessages(messages: Array<{ metadata?: unknown }>): AgentHarnessBudgetEvent[] {
  return messages.flatMap((message) => {
    if (!isRecord(message.metadata)) return [];

    const event = message.metadata.agentHarnessBudgetEvent;
    const events = message.metadata.agentHarnessBudgetEvents;
    const result: AgentHarnessBudgetEvent[] = [];

    if (isAgentHarnessBudgetEvent(event)) {
      result.push(event);
    }

    if (Array.isArray(events)) {
      result.push(...events.filter(isAgentHarnessBudgetEvent));
    }

    return result;
  });
}

function resolveBlockedReason(
  input: EvaluateAgentHarnessBudgetInput,
  events: AgentHarnessBudgetEvent[],
  policy: AgentHarnessBudgetPolicy,
): AgentHarnessBudgetDecisionReason | undefined {
  const sameActionFailureCount = events.filter((event) => event.actionKey === input.actionKey && failureStatuses.has(event.status)).length;
  if (sameActionFailureCount >= policy.maxSameActionRepeat) {
    return "same_action_repeat_exhausted";
  }

  if (countRecentConsecutiveFailures(events) >= policy.maxConsecutiveFailures) {
    return "consecutive_failures_exhausted";
  }

  const capabilityRetryCount = events.filter((event) => event.capabilityId === input.capabilityId && retryStatuses.has(event.status)).length;
  if (capabilityRetryCount >= policy.maxRetryPerCapability) {
    return "capability_retry_exhausted";
  }

  if ((input.contextTokenEstimate ?? 0) > policy.maxContextBudgetTokens) {
    return "context_budget_exhausted";
  }

  if (input.isSideEffectful && policy.requiresHumanGateForSideEffects && !input.hasConfirmedHumanGate) {
    return "human_gate_required";
  }

  return undefined;
}

function countRecentConsecutiveFailures(events: AgentHarnessBudgetEvent[]): number {
  const orderedEvents = [...events].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  let count = 0;

  for (let index = orderedEvents.length - 1; index >= 0; index -= 1) {
    if (!failureStatuses.has(orderedEvents[index].status)) break;
    count += 1;
  }

  return count;
}

function filterEventsAfterLatestRelevantSuccess(events: AgentHarnessBudgetEvent[], capabilityId: string, actionKey: string): AgentHarnessBudgetEvent[] {
  const orderedEvents = [...events].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  const latestSuccessIndex = findLastIndex(orderedEvents, (event) => {
    return event.status === "succeeded" && event.capabilityId === capabilityId && event.actionKey === actionKey;
  });

  return latestSuccessIndex === -1 ? orderedEvents : orderedEvents.slice(latestSuccessIndex + 1);
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }

  return -1;
}

function resolvePolicy(policy?: Partial<AgentHarnessBudgetPolicy>): AgentHarnessBudgetPolicy {
  return {
    ...DEFAULT_AGENT_HARNESS_BUDGET_POLICY,
    ...policy,
  };
}

function isAgentHarnessBudgetEvent(value: unknown): value is AgentHarnessBudgetEvent {
  if (!isRecord(value)) return false;
  return (
    typeof value.capabilityId === "string" &&
    typeof value.actionKey === "string" &&
    isAgentHarnessBudgetEventStatus(value.status) &&
    isAgentHarnessBudgetEventKind(value.kind) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt))
  );
}

function isAgentHarnessBudgetEventStatus(value: unknown): value is AgentHarnessBudgetEventStatus {
  return value === "blocked" || value === "failed" || value === "retryable_failed" || value === "succeeded";
}

function isAgentHarnessBudgetEventKind(value: unknown): value is AgentHarnessBudgetEventKind {
  return (
    value === "provider_unavailable" ||
    value === "tool_failed" ||
    value === "quality_gate_failed" ||
    value === "blocked_by_policy" ||
    value === "retry_exhausted" ||
    value === "tool_succeeded"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const teacherSafeSummaryByReason: Record<AgentHarnessBudgetDecisionReason, string> = {
  same_action_repeat_exhausted: "这一步已经多次没有完成，建议先调整材料或确认要求后再继续。",
  consecutive_failures_exhausted: "最近几步连续没有完成，建议先停下来核对前置材料。",
  capability_retry_exhausted: "这项处理已经多次尝试未完成，建议稍后重试或换一种处理方式。",
  context_budget_exhausted: "当前对话和材料较多，建议先整理关键要求后再继续。",
  human_gate_required: "这一步会实际生成或变更材料，需要教师确认后再继续。",
};
