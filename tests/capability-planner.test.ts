import { describe, expect, it } from "vitest";
import { isExplorationOnlyRequest, planCapabilityForRequest, planDeliveryForRequest } from "@/server/capabilities/capability-planner";
import type { CapabilityAvailabilityEntry } from "@/server/capabilities/capability-availability";
import { v19rRealFailureDialogue } from "./fixtures/v1-9r-real-failure-dialogue.fixture";

function availabilityEntry(input: Partial<CapabilityAvailabilityEntry> & Pick<CapabilityAvailabilityEntry, "capabilityId" | "status">): CapabilityAvailabilityEntry {
  return {
    capabilityId: input.capabilityId,
    status: input.status,
    requiresConfirmation: input.requiresConfirmation ?? true,
    missingApprovedInputs: input.missingApprovedInputs ?? [],
    reasonForModel: input.reasonForModel ?? `status=${input.status}`,
    reasonForUser: input.reasonForUser ?? "这一步暂时不能执行，请先完善或确认前置成果。",
  };
}

const fullDeliveryCapabilityIds = [
  "requirement_spec",
  "lesson_plan",
  "ppt_outline",
  "ppt_design",
  "ppt_sample_assets",
  "ppt_key_samples",
  "ppt_full_assets",
  "ppt_full_deck",
  "image_asset",
  "knowledge_anchor_extract",
  "creative_theme_generate",
  "video_script_generate",
  "storyboard_generate",
  "asset_brief_generate",
  "asset_image_generate",
  "video_segment_plan",
  "video_segment_generate",
  "video_narration_generate",
  "concat_only_assemble",
  "final_package",
];

describe("M54-B CapabilityPlanner", () => {
  it("plans a page-scoped repair only when the teacher explicitly names a PPT page", () => {
    const plan = planCapabilityForRequest({
      userMessage: "请调整 PPT 第 6 页的标题和布局",
      availableArtifactKinds: ["pptx_artifact", "ppt_design_draft", "image_prompts"],
    });

    expect(plan).toMatchObject({
      capabilityId: "ppt_page_repair",
      expectedArtifactKind: "pptx_artifact",
      requiresConfirmation: true,
    });
    expect(plan?.missingInputs).toEqual([]);
  });

  it("does not create a tool plan for casual chat", () => {
    const plan = planCapabilityForRequest({ userMessage: "你好", availableArtifactKinds: [] });

    expect(plan).toBeNull();
  });

  it("does not require routine confirmation before starting a complete one-sentence PPT task", () => {
    const plan = planCapabilityForRequest({
      userMessage: v19rRealFailureDialogue.messages[0],
      availableArtifactKinds: [],
      intentGrant: { standardWorkAuthorized: true },
    });

    expect(plan).toMatchObject({
      capabilityId: "requirement_spec",
      requiresConfirmation: false,
      expectedArtifactKind: "requirement_spec",
    });
    expect(plan?.nextSuggestedCapabilities).toContain("ppt_design");
    expect(plan?.missingInputs).toEqual([]);
  });

  it("does not downgrade an explicit local video-script redirect to exploration", () => {
    const userMessage = "改道：仍然只做局部视频脚本，但独立创意改成无人灯塔的错误信号；不要沿用机械信标方案。";
    expect(isExplorationOnlyRequest(userMessage)).toBe(false);
    expect(planCapabilityForRequest({
      userMessage,
      availableArtifactKinds: [],
      projectContext: { grade: "五年级", subject: "数学", topic: "百分数" },
      intentGrant: { standardWorkAuthorized: true },
    })).toMatchObject({
      capabilityId: "requirement_spec",
      missingInputs: [],
      requiresConfirmation: false,
    });
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

  it("plans PPT design before Coze PPT when only a PPT outline already exists", () => {
    const plan = planCapabilityForRequest({
      userMessage: "根据现有大纲生成 PPTX",
      availableArtifactKinds: ["ppt_draft"],
    });

    expect(plan).toMatchObject({
      capabilityId: "ppt_design",
      requiresConfirmation: true,
      expectedArtifactKind: "ppt_design_draft",
    });
  });

  it("can plan Coze PPT when a four-layer PPT design draft already exists", () => {
    const plan = planCapabilityForRequest({
      userMessage: "根据现有设计稿生成 PPTX 文件",
      availableArtifactKinds: ["ppt_design_draft"],
    });

    expect(plan).toMatchObject({
      capabilityId: "coze_ppt",
      requiresConfirmation: true,
      expectedArtifactKind: "pptx_artifact",
    });
  });

  it("routes a quality editable PPT through samples, full assets, and the full deck tool", () => {
    const base = { userMessage: "根据现有设计稿生成高质量可编辑 PPTX 文件", availableArtifactKinds: ["ppt_design_draft"] };
    expect(planCapabilityForRequest(base)?.capabilityId).toBe("ppt_sample_assets");
    expect(planCapabilityForRequest({ ...base, availableArtifactKinds: [...base.availableArtifactKinds, "image_prompts"] })?.capabilityId).toBe("ppt_key_samples");
    expect(planCapabilityForRequest({ ...base, availableArtifactKinds: [...base.availableArtifactKinds, "image_prompts", "image_prompts"] })?.capabilityId).toBe("ppt_full_assets");
    expect(planCapabilityForRequest({ ...base, availableArtifactKinds: [...base.availableArtifactKinds, "image_prompts", "image_prompts", "image_prompts"] })?.capabilityId).toBe("ppt_full_deck");
  });

  it("collects missing inputs for vague courseware requests", () => {
    const plan = planCapabilityForRequest({ userMessage: "帮我做一个课件", availableArtifactKinds: [] });

    expect(plan).toMatchObject({
      capabilityId: "requirement_spec",
      requiresConfirmation: false,
    });
    expect(plan?.missingInputs).toEqual(["grade", "subject", "topic"]);
  });

  it("uses reliable project defaults instead of asking for grade, subject, and topic again", () => {
    const plan = planCapabilityForRequest({
      userMessage: "帮我做一份约 10 页的公开课课件，默认信息都可以修改",
      availableArtifactKinds: [],
      projectContext: { grade: "五年级", subject: "数学", topic: "百分数" },
      intentGrant: { standardWorkAuthorized: true },
    });

    expect(plan).toMatchObject({
      capabilityId: "requirement_spec",
      missingInputs: [],
      requiresConfirmation: false,
      inputDraft: { teacherGoal: expect.stringContaining("约 10 页") },
    });
  });

  it("recognizes a junior-high grade as a valid task fact without restricting Tool planning", () => {
    const plan = planCapabilityForRequest({
      userMessage: "帮我做七年级语文《春》的课件",
      availableArtifactKinds: [],
      intentGrant: { standardWorkAuthorized: true },
    });

    expect(plan).toMatchObject({
      capabilityId: "requirement_spec",
      requiresConfirmation: false,
    });
    expect(plan?.missingInputs).not.toContain("grade");
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
    expect(plan?.steps.map((step) => step.capabilityId)).toEqual(fullDeliveryCapabilityIds);
    expect(plan?.steps.map((step) => step.status)).toEqual([
      "awaiting_confirmation",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
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
      ["ppt_design", "pending"],
      ["ppt_sample_assets", "pending"],
      ["ppt_key_samples", "pending"],
      ["ppt_full_assets", "pending"],
      ["ppt_full_deck", "pending"],
      ["image_asset", "pending"],
      ["knowledge_anchor_extract", "pending"],
      ["creative_theme_generate", "pending"],
      ["video_script_generate", "pending"],
      ["storyboard_generate", "pending"],
      ["asset_brief_generate", "pending"],
      ["asset_image_generate", "pending"],
      ["video_segment_plan", "pending"],
      ["video_segment_generate", "pending"],
      ["video_narration_generate", "pending"],
      ["concat_only_assemble", "pending"],
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

    expect(toolPlan?.capabilityId).toBe("ppt_design");
    expect(plan?.currentStepId).toBe("ppt_design");
    expect(plan?.steps.map((step) => [step.capabilityId, step.status])).toEqual([
      ["requirement_spec", "succeeded"],
      ["lesson_plan", "succeeded"],
      ["ppt_outline", "succeeded"],
      ["ppt_design", "awaiting_confirmation"],
      ["ppt_sample_assets", "pending"],
      ["ppt_key_samples", "pending"],
      ["ppt_full_assets", "pending"],
      ["ppt_full_deck", "pending"],
      ["image_asset", "pending"],
      ["knowledge_anchor_extract", "pending"],
      ["creative_theme_generate", "pending"],
      ["video_script_generate", "pending"],
      ["storyboard_generate", "pending"],
      ["asset_brief_generate", "pending"],
      ["asset_image_generate", "pending"],
      ["video_segment_plan", "pending"],
      ["video_segment_generate", "pending"],
      ["video_narration_generate", "pending"],
      ["concat_only_assemble", "pending"],
      ["final_package", "pending"],
    ]);
  });

  it("marks an unavailable capability as not confirmable in fallback planning", () => {
    const plan = planCapabilityForRequest({
      userMessage: "根据现有设计稿生成 PPTX 文件",
      availableArtifactKinds: ["ppt_design_draft"],
      capabilityAvailability: [
        availabilityEntry({
          capabilityId: "coze_ppt",
          status: "provider_unavailable",
          reasonForUser: "这项生成能力暂时不可用，可以稍后重试或先继续完善已确认内容。",
        }),
      ],
    });

    expect(plan).toMatchObject({
      capabilityId: "coze_ppt",
      requiresConfirmation: false,
      reasonForUser: "这项生成能力暂时不可用，可以稍后重试或先继续完善已确认内容。",
    });
    expect(plan?.internalReason).toContain("capability_unavailable:provider_unavailable");
    expect(JSON.stringify(plan)).not.toMatch(/providerUnavailable|runtimeKind|debug|schema|storage|local path|token/i);
  });
});
