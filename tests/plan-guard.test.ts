import { describe, expect, it } from "vitest";
import { evaluateToolPlan } from "@/server/guards/plan-guard";

describe("PlanGuard", () => {
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
    const result = evaluateToolPlan({ capabilityId: "requirement_spec" });

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
