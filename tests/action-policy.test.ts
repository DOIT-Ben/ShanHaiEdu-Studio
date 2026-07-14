import { describe, expect, it } from "vitest";
import { actionRiskForTool, createPendingDecisionForAction, evaluateActionPolicy } from "@/server/guards/action-policy";
import type { IntentGrant } from "@/server/conversation/task-contract";

const grant: IntentGrant = {
  schemaVersion: "intent-grant.v1", taskId: "task-1", projectId: "project-1", intentEpoch: 0,
  standardWorkAuthorized: true, intensity: "standard", budgetPolicyVersion: "v1-standard",
  maxCostCredits: null, maxExternalProviderCalls: 3, requiredCheckpoints: [], expiresAt: null,
};

describe("V1-9R2 ActionPolicy", () => {
  it("counts only real external calls as generation budget risk", () => {
    expect(actionRiskForTool({ adapterKind: "provider", sideEffectLevel: "external_call" })).toBe("external_generation");
    expect(actionRiskForTool({ adapterKind: "package", sideEffectLevel: "package_write" })).toBe("internal");
    expect(actionRiskForTool({ adapterKind: "internal_capability", sideEffectLevel: "artifact_write" })).toBe("internal");
  });

  it("allows standard reversible internal and generation work under the bound task grant", () => {
    expect(evaluateActionPolicy({ risk: "internal", intentGrant: grant })).toEqual({ kind: "allow", reason: "within_task_grant" });
    expect(evaluateActionPolicy({ risk: "external_generation", intentGrant: grant })).toEqual({ kind: "allow", reason: "within_task_grant" });
  });

  it("requires one HumanGate for missing authorization and every real risk", () => {
    expect(evaluateActionPolicy({ risk: "external_generation" })).toEqual({ kind: "human_gate", reason: "missing_grant" });
    for (const risk of ["budget_upgrade", "highest_intensity", "publish", "permission_change", "destructive", "material_choice"] as const) {
      expect(evaluateActionPolicy({ risk, intentGrant: grant })).toMatchObject({ kind: "human_gate" });
    }
  });

  it("does not allow a grant to cross a project, intent epoch, or undisclosed budget boundary", () => {
    expect(evaluateActionPolicy({
      risk: "external_generation",
      intentGrant: grant,
      expectedScope: { projectId: "project-2", intentEpoch: 0, intensity: "standard" },
    })).toEqual({ kind: "human_gate", reason: "grant_scope_mismatch" });
    expect(evaluateActionPolicy({
      risk: "external_generation",
      intentGrant: { ...grant, budgetPolicyVersion: null, maxCostCredits: null, maxExternalProviderCalls: null },
    })).toEqual({ kind: "human_gate", reason: "budget_not_disclosed" });
    expect(evaluateActionPolicy({
      risk: "external_generation",
      intentGrant: { ...grant, budgetPolicyVersion: "v1-stale" },
    })).toEqual({ kind: "human_gate", reason: "budget_not_disclosed" });
  });

  it("allows external calls below the disclosed task limit and gates the first call beyond it", () => {
    expect(evaluateActionPolicy({
      risk: "external_generation",
      intentGrant: grant,
      externalProviderCallsUsed: 2,
    })).toEqual({ kind: "allow", reason: "within_task_grant" });
    expect(evaluateActionPolicy({
      risk: "external_generation",
      intentGrant: grant,
      externalProviderCallsUsed: 3,
    })).toEqual({ kind: "human_gate", reason: "budget_upgrade" });
  });

  it("turns every blocking policy reason into one typed, action-bound pending decision", () => {
    const cases = [
      ["external_generation", undefined, "missing_grant", "authorization"],
      ["external_generation", { ...grant, budgetPolicyVersion: null, maxCostCredits: null, maxExternalProviderCalls: null }, "budget_not_disclosed", "budget_disclosure"],
      ["budget_upgrade", grant, "budget_upgrade", "budget_upgrade"],
      ["highest_intensity", grant, "highest_intensity", "highest_intensity"],
      ["publish", grant, "publish", "publish"],
      ["permission_change", grant, "permission_change", "permission_change"],
      ["destructive", grant, "destructive", "destructive"],
      ["material_choice", grant, "material_choice", "material_choice"],
    ] as const;

    for (const [risk, intentGrant, reason, kind] of cases) {
      const decision = evaluateActionPolicy({ risk, intentGrant });
      expect(decision).toEqual({ kind: "human_gate", reason });
      if (decision.kind !== "human_gate") throw new Error("Expected a HumanGate policy decision.");
      expect(createPendingDecisionForAction({
        action: risk,
        decision,
        actionId: `human:project-1:${risk}:message-1`,
        actorUserId: "teacher-a",
        projectId: "project-1",
        taskId: "task-1",
        intentEpoch: 2,
        planId: `${risk}:plan-1`,
        intentGrant,
      })).toMatchObject({
        schemaVersion: "pending-decision.v1",
        status: "pending",
        kind,
        reasonCode: reason,
        actorUserId: "teacher-a",
        projectId: "project-1",
        taskId: "task-1",
        intentEpoch: 2,
        actionId: `human:project-1:${risk}:message-1`,
      });
    }
  });
});
