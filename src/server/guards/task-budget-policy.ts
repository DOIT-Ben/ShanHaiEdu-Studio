import type { TaskBrief, TaskRequestedOutput } from "@/server/conversation/task-contract";

export const STANDARD_TASK_BUDGET_POLICY_VERSION = "v1-standard-task-scope.v1";

export type StandardTaskBudget = {
  policyVersion: typeof STANDARD_TASK_BUDGET_POLICY_VERSION;
  maxExternalProviderCalls: number;
  maxToolRounds: number;
};

const MAX_STANDARD_VIDEO_SHOTS = 15;
const baseTaskToolRounds = 1;
const outputBudgets = {
  lesson_plan: { externalProviderCalls: 0, toolRounds: 1 },
  ppt: { externalProviderCalls: 2, toolRounds: 12 },
  image: { externalProviderCalls: 1, toolRounds: 1 },
  video_script: { externalProviderCalls: 0, toolRounds: 4 },
  video: { externalProviderCalls: 1 + MAX_STANDARD_VIDEO_SHOTS, toolRounds: 10 + MAX_STANDARD_VIDEO_SHOTS },
  package: { externalProviderCalls: 0, toolRounds: 1 },
} as const;

const packageOutputs = ["lesson_plan", "ppt", "image", "video", "package"] as const;

export function resolveStandardTaskBudget(taskBrief: Pick<TaskBrief, "requestedOutputs" | "excludedOutputs">): StandardTaskBudget {
  const outputs = new Set(taskBrief.requestedOutputs);
  const excluded = new Set(taskBrief.excludedOutputs);
  if (outputs.has("package")) {
    for (const output of packageOutputs) {
      if (!excluded.has(output)) outputs.add(output);
    }
  }
  if (outputs.has("video")) outputs.delete("video_script");

  let maxExternalProviderCalls = 0;
  let maxToolRounds = baseTaskToolRounds;
  for (const [output, budget] of Object.entries(outputBudgets)) {
    if (!outputs.has(output as TaskRequestedOutput) || excluded.has(output as TaskRequestedOutput)) continue;
    maxExternalProviderCalls += budget.externalProviderCalls;
    maxToolRounds += budget.toolRounds;
  }

  return {
    policyVersion: STANDARD_TASK_BUDGET_POLICY_VERSION,
    maxExternalProviderCalls,
    maxToolRounds,
  };
}

export function resolveBudgetUpgrade(input: {
  taskBrief: Pick<TaskBrief, "requestedOutputs" | "excludedOutputs">;
  currentMaxExternalProviderCalls: number | null | undefined;
}): StandardTaskBudget {
  const standard = resolveStandardTaskBudget(input.taskBrief);
  const current = Math.max(0, input.currentMaxExternalProviderCalls ?? 0);
  const increments = Math.max(1, Math.ceil(current / Math.max(1, standard.maxExternalProviderCalls)) + 1);
  return {
    policyVersion: standard.policyVersion,
    maxExternalProviderCalls: current + standard.maxExternalProviderCalls,
    maxToolRounds: standard.maxToolRounds * increments,
  };
}
