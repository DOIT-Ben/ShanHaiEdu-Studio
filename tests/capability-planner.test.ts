import { describe, expect, it } from "vitest";
import { planCapabilityForRequest, planDeliveryForRequest } from "@/server/capabilities/capability-planner";

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

  it("builds a full delivery plan for one-sentence material package requests", () => {
    const plan = planDeliveryForRequest({
      userMessage: "帮我做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频",
      availableArtifactKinds: [],
    });

    expect(plan).toMatchObject({
      title: "公开课完整交付计划",
      currentStepId: "requirement_spec",
    });
    expect(plan?.steps.map((step) => step.capabilityId)).toEqual([
      "requirement_spec",
      "lesson_plan",
      "ppt_outline",
      "coze_ppt",
      "image_asset",
      "intro_video",
      "final_package",
    ]);
    expect(plan?.steps.map((step) => step.status)).toEqual([
      "awaiting_confirmation",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("does not build a delivery plan for vague requests with missing inputs", () => {
    const plan = planDeliveryForRequest({ userMessage: "帮我做一个完整材料包", availableArtifactKinds: [] });

    expect(plan).toBeNull();
  });

  it("keeps lesson plan as the next full-delivery step when requirements already exist", () => {
    const toolPlan = planCapabilityForRequest({
      userMessage: "帮我继续做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频",
      availableArtifactKinds: ["requirement_spec"],
    });
    const plan = planDeliveryForRequest({
      userMessage: "帮我继续做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频",
      availableArtifactKinds: ["requirement_spec"],
    });

    expect(toolPlan?.capabilityId).toBe("lesson_plan");
    expect(plan?.currentStepId).toBe("lesson_plan");
    expect(plan?.steps.map((step) => [step.capabilityId, step.status])).toEqual([
      ["requirement_spec", "succeeded"],
      ["lesson_plan", "awaiting_confirmation"],
      ["ppt_outline", "pending"],
      ["coze_ppt", "pending"],
      ["image_asset", "pending"],
      ["intro_video", "pending"],
      ["final_package", "pending"],
    ]);
  });

  it("does not treat a PPT outline draft as a completed PPTX delivery step", () => {
    const toolPlan = planCapabilityForRequest({
      userMessage: "帮我继续做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频",
      availableArtifactKinds: ["requirement_spec", "lesson_plan", "ppt_draft"],
    });
    const plan = planDeliveryForRequest({
      userMessage: "帮我继续做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频",
      availableArtifactKinds: ["requirement_spec", "lesson_plan", "ppt_draft"],
    });

    expect(toolPlan?.capabilityId).toBe("coze_ppt");
    expect(plan?.currentStepId).toBe("coze_ppt");
    expect(plan?.steps.map((step) => [step.capabilityId, step.status])).toEqual([
      ["requirement_spec", "succeeded"],
      ["lesson_plan", "succeeded"],
      ["ppt_outline", "succeeded"],
      ["coze_ppt", "awaiting_confirmation"],
      ["image_asset", "pending"],
      ["intro_video", "pending"],
      ["final_package", "pending"],
    ]);
  });
});
