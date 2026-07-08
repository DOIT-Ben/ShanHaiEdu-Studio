import { describe, expect, it } from "vitest";
import { planCapabilityForRequest } from "@/server/capabilities/capability-planner";

describe("M54-B CapabilityPlanner", () => {
  it("does not create a tool plan for casual chat", () => {
    const plan = planCapabilityForRequest({ userMessage: "你好", availableArtifactKinds: [] });

    expect(plan).toBeNull();
  });

  it("plans requirement specification before PPT outline when no confirmed requirement exists", () => {
    const plan = planCapabilityForRequest({
      userMessage: "帮我做五年级数学百分数 PPT",
      availableArtifactKinds: [],
    });

    expect(plan).toMatchObject({
      capabilityId: "requirement_spec",
      requiresConfirmation: true,
      expectedArtifactKind: "requirement_spec",
    });
    expect(plan?.nextSuggestedCapabilities).toContain("coze_ppt");
    expect(plan?.missingInputs).toEqual([]);
  });

  it("plans PPT outline after a requirement specification exists", () => {
    const plan = planCapabilityForRequest({
      userMessage: "帮我做五年级数学百分数 PPT 大纲",
      availableArtifactKinds: ["requirement_spec"],
    });

    expect(plan).toMatchObject({
      capabilityId: "ppt_outline",
      requiresConfirmation: true,
      expectedArtifactKind: "ppt_draft",
    });
  });

  it("can plan Coze PPT when a PPT outline already exists", () => {
    const plan = planCapabilityForRequest({
      userMessage: "根据现有大纲生成 PPTX",
      availableArtifactKinds: ["ppt_draft"],
    });

    expect(plan).toMatchObject({
      capabilityId: "coze_ppt",
      requiresConfirmation: true,
      expectedArtifactKind: "ppt_draft",
    });
  });

  it("collects missing inputs for vague courseware requests", () => {
    const plan = planCapabilityForRequest({ userMessage: "帮我做一个课件", availableArtifactKinds: [] });

    expect(plan).toMatchObject({
      capabilityId: "requirement_spec",
      requiresConfirmation: false,
    });
    expect(plan?.missingInputs).toEqual(["grade", "subject", "topic"]);
  });
});
