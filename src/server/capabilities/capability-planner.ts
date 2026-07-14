import { getCapabilityDefinition } from "./capability-registry";
import type { CapabilityAvailabilityEntry } from "./capability-availability";
import type { CapabilityId, CapabilityToolPlan, DeliveryPlan } from "./types";

export type CapabilityPlannerInput = {
  userMessage: string;
  availableArtifactKinds: string[];
  intentGrant?: { standardWorkAuthorized: boolean };
  projectContext?: {
    grade?: string | null;
    subject?: string | null;
    topic?: string | null;
  };
  capabilityAvailability?: CapabilityAvailabilityEntry[];
};

const fullDeliveryStepIds: CapabilityId[] = [
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
  "concat_only_assemble",
  "final_package",
];

export function planCapabilityForRequest(input: CapabilityPlannerInput): CapabilityToolPlan | null {
  const text = input.userMessage.trim();
  if (isCasualChat(text) || isExplorationOnlyRequest(text)) return null;

  if (wantsPptPageRepair(text)) {
    const required = ["pptx_artifact", "ppt_design_draft", "image_prompts"];
    const missing = required.filter((kind) => !input.availableArtifactKinds.includes(kind));
    return buildPlan("ppt_page_repair", text, missing, [], required, input.capabilityAvailability, input.intentGrant);
  }

  if (wantsFullDelivery(text)) {
    const capabilityId = firstMissingDeliveryStep(fullDeliveryStepIds, input.availableArtifactKinds);
    const nextSuggestedCapabilities = fullDeliveryStepIds.slice(fullDeliveryStepIds.indexOf(capabilityId) + 1, fullDeliveryStepIds.indexOf(capabilityId) + 2);
    return buildPlan(
      capabilityId,
      text,
      normalizeSingleSubjectGap(missingLessonInputs(text, input.projectContext)),
      nextSuggestedCapabilities,
      artifactKindsBefore(fullDeliveryStepIds, capabilityId),
      input.capabilityAvailability,
      input.intentGrant,
    );
  }

  if (wantsPpt(text)) {
    const missingInputs = normalizePptMissingInputs(missingLessonInputs(text, input.projectContext));
    const hasRequirementSpec = input.availableArtifactKinds.includes("requirement_spec");
    const hasPptOutline = input.availableArtifactKinds.includes("ppt_draft") || input.availableArtifactKinds.includes("ppt_outline");
    const hasPptDesign = input.availableArtifactKinds.includes("ppt_design_draft");
    const wantsConcretePptx = /pptx|文件|下载|生成\s*ppt/i.test(text);
    const wantsQualityPpt = /精品|高质量|可编辑|样张|正式/.test(text);
    const imageBundleCount = input.availableArtifactKinds.filter((kind) => kind === "image_prompts").length;

    if (hasPptDesign && wantsConcretePptx && wantsQualityPpt) {
      if (imageBundleCount === 0) return buildPlan("ppt_sample_assets", text, [], ["ppt_key_samples"], ["ppt_design_draft"], input.capabilityAvailability, input.intentGrant);
      if (imageBundleCount === 1) return buildPlan("ppt_key_samples", text, [], ["ppt_full_assets"], ["ppt_design_draft", "image_prompts"], input.capabilityAvailability, input.intentGrant);
      if (imageBundleCount === 2) return buildPlan("ppt_full_assets", text, [], ["ppt_full_deck"], ["ppt_design_draft", "image_prompts"], input.capabilityAvailability, input.intentGrant);
      return buildPlan("ppt_full_deck", text, [], [], ["ppt_design_draft", "image_prompts"], input.capabilityAvailability, input.intentGrant);
    }

    if (hasPptDesign && wantsConcretePptx) {
      return buildPlan("coze_ppt", text, [], [], ["ppt_design_draft"], input.capabilityAvailability, input.intentGrant);
    }

    if (hasPptOutline && wantsConcretePptx) {
      return buildPlan("ppt_design", text, [], ["coze_ppt"], ["ppt_draft"], input.capabilityAvailability, input.intentGrant);
    }

    if (!hasRequirementSpec) {
      return buildPlan("requirement_spec", text, missingInputs, ["ppt_outline", "ppt_design"], [], input.capabilityAvailability, input.intentGrant);
    }

    return buildPlan("ppt_outline", text, missingInputs, ["ppt_design"], [], input.capabilityAvailability, input.intentGrant);
  }

  if (wantsLessonPlan(text)) {
    return buildPlan("lesson_plan", text, normalizeSingleSubjectGap(missingLessonInputs(text, input.projectContext)), ["ppt_outline"], [], input.capabilityAvailability, input.intentGrant);
  }

  if (wantsRequirementSpec(text)) {
    return buildPlan("requirement_spec", text, normalizeSingleSubjectGap(missingLessonInputs(text, input.projectContext)), ["lesson_plan", "ppt_outline"], [], input.capabilityAvailability, input.intentGrant);
  }

  return null;
}

export function planDeliveryForRequest(input: CapabilityPlannerInput): DeliveryPlan | null {
  const text = input.userMessage.trim();
  if (isCasualChat(text) || isExplorationOnlyRequest(text) || !wantsFullDelivery(text)) return null;

  const currentStepId = firstMissingDeliveryStep(fullDeliveryStepIds, input.availableArtifactKinds);
  const currentPlan = planCapabilityForRequest(input);
  if (!currentPlan || currentPlan.missingInputs.length > 0) return null;
  const completedStepIds = completedDeliveryStepIds(fullDeliveryStepIds, input.availableArtifactKinds);

  return {
    id: `delivery:${stablePlanSegment(text)}`,
    title: "公开课完整交付计划",
    summary: "我会先整理需求，再按顺序生成教案、PPT、课堂素材和最终交付包。",
    currentStepId,
    steps: fullDeliveryStepIds.map((capabilityId) => {
      const capability = getCapabilityDefinition(capabilityId);
      return {
        id: capabilityId,
        capabilityId,
        artifactKind: capability.artifactKind,
        title: capability.userLabel,
        teacherDescription: capability.description,
        status: completedStepIds.has(capabilityId) ? "succeeded" : capabilityId === currentStepId ? "awaiting_confirmation" : "pending",
        requiresConfirmation: capability.requiresConfirmation,
      };
    }),
  };
}

function firstMissingDeliveryStep(stepIds: CapabilityId[], availableArtifactKinds: string[]): CapabilityId {
  const completedStepIds = completedDeliveryStepIds(stepIds, availableArtifactKinds);
  return stepIds.find((capabilityId) => !completedStepIds.has(capabilityId)) ?? "final_package";
}

function completedDeliveryStepIds(stepIds: CapabilityId[], availableArtifactKinds: string[]): Set<CapabilityId> {
  const remainingArtifactKinds = [...availableArtifactKinds];
  const completedStepIds = new Set<CapabilityId>();

  for (const capabilityId of stepIds) {
    const artifactKind = getCapabilityDefinition(capabilityId).artifactKind;
    const artifactIndex = remainingArtifactKinds.indexOf(artifactKind);
    if (artifactIndex === -1) continue;
    completedStepIds.add(capabilityId);
    remainingArtifactKinds.splice(artifactIndex, 1);
  }

  return completedStepIds;
}

function artifactKindsBefore(stepIds: CapabilityId[], capabilityId: CapabilityId): string[] {
  return stepIds
    .slice(0, Math.max(0, stepIds.indexOf(capabilityId)))
    .map((stepId) => getCapabilityDefinition(stepId).artifactKind);
}

function buildPlan(
  capabilityId: CapabilityId,
  userMessage: string,
  missingInputs: string[],
  nextSuggestedCapabilities: CapabilityId[],
  upstreamAvailable: string[],
  capabilityAvailability?: CapabilityAvailabilityEntry[],
  intentGrant?: { standardWorkAuthorized: boolean },
): CapabilityToolPlan {
  const capability = getCapabilityDefinition(capabilityId);
  const availability = capabilityAvailability?.find((entry) => entry.capabilityId === capabilityId);
  if (availability && availability.status !== "available") {
    return {
      planId: `${capabilityId}:${stablePlanSegment(userMessage)}`,
      capabilityId,
      reasonForUser: availability.reasonForUser,
      internalReason: `planned_from_user_message:${capabilityId};capability_unavailable:${availability.status}`,
      inputDraft: {
        teacherGoal: userMessage,
        upstreamAvailable,
      },
      missingInputs: availability.missingApprovedInputs.length > 0 ? availability.missingApprovedInputs : missingInputs,
      upstreamPlan: [],
      nextSuggestedCapabilities,
      requiresConfirmation: false,
      expectedArtifactKind: capability.artifactKind,
    };
  }
  return {
    planId: `${capabilityId}:${stablePlanSegment(userMessage)}`,
    capabilityId,
    reasonForUser: missingInputs.length > 0
      ? "我还需要补齐关键信息，才能开始生成。"
      : `我可以先为你${capability.userLabel}。`,
    internalReason: `planned_from_user_message:${capabilityId}`,
    inputDraft: {
      teacherGoal: userMessage,
      upstreamAvailable,
    },
    missingInputs,
    upstreamPlan: [],
    nextSuggestedCapabilities,
    requiresConfirmation: missingInputs.length === 0 && capability.requiresConfirmation && !intentGrant?.standardWorkAuthorized,
    expectedArtifactKind: capability.artifactKind,
  };
}

function isCasualChat(text: string): boolean {
  return ["你好", "您好", "hi", "hello", "在吗", "谢谢"].includes(text.toLowerCase());
}

export function isExplorationOnlyRequest(text: string): boolean {
  const explicitDeliverable = /完整材料包|交付包|最终整包|需求规格|教案|PPT|课件|课堂图片|导入视频|视频脚本|分镜|资产说明|片段规划|课程锚点/i.test(text);
  const explicitExecution = /帮我做|请做|制作|生成|做一个|做份|完成|输出/.test(text);
  return /聊聊|想法|创意|怎么设计|怎么上/.test(text) && !explicitDeliverable && !explicitExecution;
}

function wantsPpt(text: string): boolean {
  return /ppt|PPT|课件|幻灯片/.test(text);
}

function wantsPptPageRepair(text: string): boolean {
  return /第\s*\d{1,2}\s*页/.test(text) && /PPT|课件|幻灯片/.test(text) && /调整|修改|返修|重做|优化/.test(text);
}

function wantsLessonPlan(text: string): boolean {
  return /教案|教学设计/.test(text);
}

function wantsRequirementSpec(text: string): boolean {
  return /备课|公开课|需求|整理|视频脚本|分镜|资产说明|片段规划|课程锚点/.test(text);
}

function wantsFullDelivery(text: string): boolean {
  const wantsPackage = /完整|材料包|交付包|全套|一套/.test(text);
  const wantsMultipleAssets = /(教案|教学设计)/.test(text) && /ppt|PPT|课件|幻灯片/.test(text) && /(图片|素材|视频|导入)/.test(text);
  return wantsPackage || wantsMultipleAssets;
}

function missingLessonInputs(text: string, projectContext: CapabilityPlannerInput["projectContext"]): string[] {
  const missing: string[] = [];
  if (!projectContext?.grade && !/[一二三四五六1-6]年级/.test(text)) missing.push("grade");
  if (!projectContext?.subject && !/数学|语文|英语|科学|道德与法治/.test(text)) missing.push("subject");
  if (!projectContext?.topic && !/百分数|分数|小数|周长|面积|乘法|除法|课题/.test(text)) missing.push("topic");
  return missing;
}

function normalizePptMissingInputs(missingInputs: string[]): string[] {
  return normalizeSingleSubjectGap(missingInputs);
}

function normalizeSingleSubjectGap(missingInputs: string[]): string[] {
  if (missingInputs.length === 1 && missingInputs[0] === "subject") return [];
  return missingInputs;
}

function stablePlanSegment(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "draft";
}
