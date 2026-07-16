import type { IntentGrant, PendingDecision, PendingDecisionKind, TaskBrief } from "@/server/conversation/task-contract";
import type { ToolDefinition } from "@/server/tools/tool-types";
import { resolveStandardTaskBudget, STANDARD_TASK_BUDGET_POLICY_VERSION } from "./task-budget-policy";

export type ActionRiskKind = "internal" | "external_generation" | "budget_upgrade" | "highest_intensity" | "publish" | "permission_change" | "destructive";
export type ActionPolicyDecision =
  | { kind: "allow"; reason: "within_task_grant" }
  | { kind: "human_gate"; reason: "missing_grant" | "grant_scope_mismatch" | "budget_not_disclosed" | "expired_grant" | "budget_upgrade" | "highest_intensity" | "publish" | "permission_change" | "destructive" };

export const STANDARD_BUDGET_POLICY_VERSION = STANDARD_TASK_BUDGET_POLICY_VERSION;

export function actionRiskForTool(
  tool: Pick<ToolDefinition, "adapterKind" | "sideEffectLevel">,
): Extract<ActionRiskKind, "internal" | "external_generation"> {
  return tool.adapterKind === "provider" || tool.sideEffectLevel === "external_call"
    ? "external_generation"
    : "internal";
}

export function discloseStandardTaskBudget(grant: IntentGrant, taskBrief: TaskBrief): IntentGrant {
  const budget = resolveStandardTaskBudget(taskBrief);
  return {
    ...grant,
    budgetPolicyVersion: budget.policyVersion,
    maxCostCredits: null,
    maxExternalProviderCalls: budget.maxExternalProviderCalls,
  };
}

export function evaluateActionPolicy(input: {
  risk: ActionRiskKind;
  intentGrant?: IntentGrant;
  expectedScope?: Pick<IntentGrant, "projectId" | "intentEpoch" | "intensity">;
  externalProviderCallsUsed?: number;
  now?: string;
}): ActionPolicyDecision {
  const grant = input.intentGrant;
  if (!grant?.standardWorkAuthorized) return { kind: "human_gate", reason: "missing_grant" };
  if (input.expectedScope && (
    grant.projectId !== input.expectedScope.projectId ||
    grant.intentEpoch !== input.expectedScope.intentEpoch ||
    grant.intensity !== input.expectedScope.intensity
  )) return { kind: "human_gate", reason: "grant_scope_mismatch" };
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= Date.parse(input.now ?? new Date().toISOString())) return { kind: "human_gate", reason: "expired_grant" };
  switch (input.risk) {
    case "internal":
      return { kind: "allow", reason: "within_task_grant" };
    case "external_generation":
      if (!isSupportedBudgetPolicyVersion(grant.budgetPolicyVersion) || !hasDisclosedBudgetLimit(grant)) {
        return { kind: "human_gate", reason: "budget_not_disclosed" };
      }
      if (typeof grant.maxExternalProviderCalls === "number" &&
          (input.externalProviderCallsUsed ?? 0) >= grant.maxExternalProviderCalls) {
        return { kind: "human_gate", reason: "budget_upgrade" };
      }
      return { kind: "allow", reason: "within_task_grant" };
    case "budget_upgrade": return { kind: "human_gate", reason: "budget_upgrade" };
    case "highest_intensity": return { kind: "human_gate", reason: "highest_intensity" };
    case "publish": return { kind: "human_gate", reason: "publish" };
    case "permission_change": return { kind: "human_gate", reason: "permission_change" };
    case "destructive": return { kind: "human_gate", reason: "destructive" };
  }
}

export function createPendingDecisionForAction(input: {
  action: ActionRiskKind;
  decision: Extract<ActionPolicyDecision, { kind: "human_gate" }>;
  actionId: string;
  actorUserId: string;
  projectId: string;
  taskId: string;
  intentEpoch: number;
  planId: string;
  intentGrant?: IntentGrant;
  disclosedBudget?: Pick<IntentGrant, "budgetPolicyVersion" | "maxCostCredits" | "maxExternalProviderCalls">;
}): PendingDecision {
  const { kind, ...content } = describeActionPolicyHumanGate(input.decision.reason);
  const budget = input.disclosedBudget ?? input.intentGrant;
  return {
    schemaVersion: "pending-decision.v1",
    decisionId: `decision:${input.actionId}`,
    status: "pending",
    kind,
    reasonCode: input.decision.reason,
    question: content.question,
    impactSummary: content.impactSummary,
    options: [
      { id: "confirm", label: "确认继续", recommended: true },
      { id: "cancel", label: "暂不继续", recommended: false },
    ],
    actorUserId: input.actorUserId,
    projectId: input.projectId,
    taskId: input.taskId,
    intentEpoch: input.intentEpoch,
    planId: input.planId,
    actionId: input.actionId,
    budgetPolicyVersion: budget?.budgetPolicyVersion ?? null,
    maxCostCredits: budget?.maxCostCredits ?? null,
    maxExternalProviderCalls: budget?.maxExternalProviderCalls ?? null,
    expiresAt: input.intentGrant?.expiresAt ?? null,
  };
}

function hasDisclosedBudgetLimit(grant: IntentGrant) {
  return (typeof grant.maxCostCredits === "number" && grant.maxCostCredits >= 0) ||
    (typeof grant.maxExternalProviderCalls === "number" && grant.maxExternalProviderCalls > 0);
}

function isSupportedBudgetPolicyVersion(value: string | null) {
  return value === STANDARD_BUDGET_POLICY_VERSION;
}

export function describeActionPolicyHumanGate(reason: Extract<ActionPolicyDecision, { kind: "human_gate" }> ["reason"]): {
  kind: PendingDecisionKind;
  question: string;
  impactSummary: string;
} {
  const kind = pendingDecisionKindFor(reason);
  return { kind, ...pendingDecisionContentFor(kind) };
}

function pendingDecisionKindFor(reason: Extract<ActionPolicyDecision, { kind: "human_gate" }> ["reason"]): PendingDecisionKind {
  switch (reason) {
    case "missing_grant":
    case "grant_scope_mismatch":
    case "expired_grant":
      return "authorization";
    case "budget_not_disclosed":
      return "budget_disclosure";
    case "budget_upgrade":
      return "budget_upgrade";
    case "highest_intensity":
      return "highest_intensity";
    case "publish":
      return "publish";
    case "permission_change":
      return "permission_change";
    case "destructive":
      return "destructive";
  }
}

function pendingDecisionContentFor(kind: PendingDecisionKind) {
  switch (kind) {
    case "authorization":
      return { question: "当前操作还没有有效授权，是否确认继续？", impactSummary: "确认后仅执行当前任务范围内的操作。" };
    case "budget_disclosure":
      return { question: "当前操作的费用规则尚未披露，是否先确认费用范围？", impactSummary: "确认前不会发起付费生成。" };
    case "budget_upgrade":
      return { question: "该操作会超过当前费用范围，是否确认升级？", impactSummary: "确认后会按升级后的费用范围继续。" };
    case "highest_intensity":
      return { question: "该操作需要最高生成强度，是否确认？", impactSummary: "确认后会使用更高的生成额度。" };
    case "publish":
      return { question: "该操作会对外发布，是否确认？", impactSummary: "确认后内容可能被外部访问。" };
    case "permission_change":
      return { question: "该操作会改变成员权限，是否确认？", impactSummary: "确认后访问范围会立即变化。" };
    case "destructive":
      return { question: "该操作会覆盖或删除现有内容，是否确认？", impactSummary: "确认后可能无法恢复原内容。" };
    case "material_choice":
      return { question: "当前存在会实质改变交付的方向选择，是否采用推荐方案？", impactSummary: "确认后将按推荐方向继续。" };
  }
}
