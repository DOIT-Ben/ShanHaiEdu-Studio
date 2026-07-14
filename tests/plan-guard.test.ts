import { describe, expect, it } from "vitest";
import { evaluateToolPlan } from "@/server/guards/plan-guard";
import type { IntentGrant } from "@/server/conversation/task-contract";

const taskGrant: IntentGrant = {
  schemaVersion: "intent-grant.v1", taskId: "task-1", projectId: "project-1", intentEpoch: 0,
  standardWorkAuthorized: true, intensity: "standard", budgetPolicyVersion: null,
  maxCostCredits: null, maxExternalProviderCalls: null, requiredCheckpoints: [], expiresAt: null,
};

describe("PlanGuard", () => {
  it("requires an exact HumanGate action for the PPT sample asset batch", () => {
    expect(evaluateToolPlan({ capabilityId: "ppt_sample_assets", hasHumanConfirmation: false }).status).toBe("needs_confirmation");
    expect(evaluateToolPlan({
      capabilityId: "ppt_sample_assets",
      hasHumanConfirmation: true,
      expectedActionId: "human:project-1:ppt_sample_assets:message-1",
      confirmedActionId: "human:project-1:ppt_sample_assets:message-1",
    }).status).toBe("allowed");
  });

  it("blocks unknown capability ids", () => {
    const result = evaluateToolPlan({ capabilityId: "unknown", hasHumanConfirmation: true, confirmedActionId: "human:p:unknown:m" });

    expect(result.status).toBe("blocked");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("requires confirmation for coze_ppt without confirmation", () => {
    const result = evaluateToolPlan({ capabilityId: "coze_ppt", hasHumanConfirmation: false });

    expect(result.status).toBe("needs_confirmation");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("requires confirmation for package capabilities without confirmation", () => {
    const result = evaluateToolPlan({ capabilityId: "final_package", hasHumanConfirmation: false });

    expect(result.status).toBe("needs_confirmation");
    expect(result.reason).toContain("package");
  });

  it("allows reversible package work under a bound task grant without a node confirmation", () => {
    const result = evaluateToolPlan({
      capabilityId: "final_package",
      intentGrant: taskGrant,
      expectedScope: { projectId: "project-1", intentEpoch: 0, intensity: "standard" },
    });

    expect(result.status).toBe("allowed");
  });

  it("does not treat capability requiresConfirmation metadata as human confirmation", () => {
    const result = evaluateToolPlan({ capabilityId: "coze_ppt", requiresConfirmation: true } as any);

    expect(result.status).toBe("needs_confirmation");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("requires a confirmed action id for external capabilities", () => {
    const result = evaluateToolPlan({ capabilityId: "coze_ppt", hasHumanConfirmation: true });

    expect(result.status).toBe("needs_confirmation");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("rejects a confirmed action id that does not match the expected pending action", () => {
    const result = evaluateToolPlan({
      capabilityId: "coze_ppt",
      hasHumanConfirmation: true,
      expectedActionId: "human:project-1:coze_ppt:message-1",
      confirmedActionId: "human:other-project:coze_ppt:old-message",
    });

    expect(result.status).toBe("needs_confirmation");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("allows coze_ppt when human confirmation is present", () => {
    const result = evaluateToolPlan({
      capabilityId: "coze_ppt",
      hasHumanConfirmation: true,
      expectedActionId: "human:project-1:coze_ppt:message-1",
      confirmedActionId: "human:project-1:coze_ppt:message-1",
    });

    expect(result.status).toBe("allowed");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("allows package capabilities when human confirmation is present", () => {
    const result = evaluateToolPlan({
      capabilityId: "final_package",
      hasHumanConfirmation: true,
      expectedActionId: "human:project-1:final_package:message-1",
      confirmedActionId: "human:project-1:final_package:message-1",
    });

    expect(result.status).toBe("allowed");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("allows safe internal capabilities without HumanGate", () => {
    const result = evaluateToolPlan({
      capabilityId: "requirement_spec",
      intentGrant: taskGrant,
      expectedScope: { projectId: "project-1", intentEpoch: 0, intensity: "standard" },
    });

    expect(result.status).toBe("allowed");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("allows requirement_spec with a matching human confirmation", () => {
    const result = evaluateToolPlan({
      capabilityId: "requirement_spec",
      hasHumanConfirmation: true,
      expectedActionId: "human:project-1:requirement_spec:message-1",
      confirmedActionId: "human:project-1:requirement_spec:message-1",
    });

    expect(result.status).toBe("allowed");
    expect(result.reason.length).toBeGreaterThan(0);
  });
});
