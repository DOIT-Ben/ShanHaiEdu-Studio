import { describe, expect, it } from "vitest";

import { createTaskBrief } from "@/server/conversation/task-contract";
import {
  resolveBudgetUpgrade,
  resolveStandardTaskBudget,
} from "@/server/guards/task-budget-policy";

describe("TaskBrief-scoped standard budget policy", () => {
  it("derives a smaller PPT budget and a bounded full-package budget from requested outputs", () => {
    const pptBudget = resolveStandardTaskBudget(taskBrief(["ppt"]));
    const packageBudget = resolveStandardTaskBudget(taskBrief(["lesson_plan", "ppt", "image", "video", "package"]));

    expect(pptBudget).toMatchObject({
      policyVersion: expect.stringMatching(/^v1-standard-task-scope\./),
      maxExternalProviderCalls: 2,
    });
    expect(packageBudget.maxExternalProviderCalls).toBeGreaterThanOrEqual(19);
    expect(packageBudget.maxToolRounds).toBeGreaterThanOrEqual(24);
    expect(packageBudget.maxExternalProviderCalls).toBeGreaterThan(pptBudget.maxExternalProviderCalls);
  });

  it("expands package-only scope to the same bounded production allowance", () => {
    const packageOnly = resolveStandardTaskBudget(taskBrief(["package"]));
    const explicitPackage = resolveStandardTaskBudget(taskBrief(["lesson_plan", "ppt", "image", "video", "package"]));

    expect(packageOnly).toEqual(explicitPackage);
  });

  it("proposes one additional task-scoped allowance when a real upgrade is required", () => {
    const brief = taskBrief(["ppt"]);
    const standard = resolveStandardTaskBudget(brief);
    const upgraded = resolveBudgetUpgrade({
      taskBrief: brief,
      currentMaxExternalProviderCalls: standard.maxExternalProviderCalls,
    });

    expect(upgraded.policyVersion).toBe(standard.policyVersion);
    expect(upgraded.maxExternalProviderCalls).toBe(standard.maxExternalProviderCalls * 2);
    expect(upgraded.maxToolRounds).toBe(standard.maxToolRounds * 2);
  });
});

function taskBrief(requestedOutputs: string[]) {
  return createTaskBrief({
    taskId: "task-budget",
    projectId: "project-budget",
    intentEpoch: 0,
    goal: "完成当前明确交付任务。",
    requestedOutputs,
    constraints: [],
    excludedOutputs: [],
    generationIntensity: "standard",
    sourceMessageId: "message-budget",
  });
}
