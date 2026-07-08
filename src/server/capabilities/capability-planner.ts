import { getCapabilityDefinition } from "./capability-registry";
import type { CapabilityId, CapabilityToolPlan, DeliveryPlan } from "./types";

export type CapabilityPlannerInput = {
  userMessage: string;
  availableArtifactKinds: string[];
  projectContext?: {
    grade?: string | null;
    subject?: string | null;
    topic?: string | null;
  };
};

export function planCapabilityForRequest(input: CapabilityPlannerInput): CapabilityToolPlan | null {
  const text = input.userMessage.trim();
  if (isCasualChat(text) || isExplorationOnly(text)) return null;

  if (wantsPpt(text)) {
    const missingInputs = normalizePptMissingInputs(missingLessonInputs(text, input.projectContext));
    const hasRequirementSpec = input.availableArtifactKinds.includes("requirement_spec");
    const hasPptOutline = input.availableArtifactKinds.includes("ppt_draft") || input.availableArtifactKinds.includes("ppt_outline");
    const wantsConcretePptx = /pptx|文件|下载|生成\s*ppt/i.test(text);

    if (hasPptOutline && wantsConcretePptx) {
      return buildPlan("coze_ppt", text, [], [], ["ppt_outline"]);
    }

    if (!hasRequirementSpec) {
      return buildPlan("requirement_spec", text, missingInputs, ["ppt_outline", "coze_ppt"], []);
    }

    return buildPlan("ppt_outline", text, missingInputs, ["coze_ppt"], []);
  }

  if (wantsLessonPlan(text)) {
    return buildPlan("lesson_plan", text, normalizeSingleSubjectGap(missingLessonInputs(text, input.projectContext)), ["ppt_outline"], []);
  }

  if (wantsRequirementSpec(text)) {
    return buildPlan("requirement_spec", text, normalizeSingleSubjectGap(missingLessonInputs(text, input.projectContext)), ["lesson_plan", "ppt_outline"], []);
  }

  return null;
}

export function planDeliveryForRequest(input: CapabilityPlannerInput): DeliveryPlan | null {
  const text = input.userMessage.trim();
  if (isCasualChat(text) || isExplorationOnly(text) || !wantsFullDelivery(text)) return null;

  const firstStep = planCapabilityForRequest(input);
  if (!firstStep || firstStep.missingInputs.length > 0) return null;

  const stepIds: CapabilityId[] = [
    "requirement_spec",
    "lesson_plan",
    "ppt_outline",
    "coze_ppt",
    "image_asset",
    "intro_video",
    "final_package",
  ];

  return {
    id: `delivery:${stablePlanSegment(text)}`,
    title: "公开课完整交付计划",
    summary: "我会先整理需求，再按顺序生成教案、PPT、课堂素材和最终交付包。",
    currentStepId: firstStep.capabilityId,
    steps: stepIds.map((capabilityId) => {
      const capability = getCapabilityDefinition(capabilityId);
      return {
        id: capabilityId,
        capabilityId,
        artifactKind: capability.artifactKind,
        title: capability.userLabel,
        teacherDescription: capability.description,
        status: capabilityId === firstStep.capabilityId ? "awaiting_confirmation" : "pending",
        requiresConfirmation: capability.requiresConfirmation,
      };
    }),
  };
}

function buildPlan(
  capabilityId: CapabilityId,
  userMessage: string,
  missingInputs: string[],
  nextSuggestedCapabilities: CapabilityId[],
  upstreamAvailable: string[],
): CapabilityToolPlan {
  const capability = getCapabilityDefinition(capabilityId);
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
    requiresConfirmation: missingInputs.length === 0 && capability.requiresConfirmation,
    expectedArtifactKind: capability.artifactKind,
  };
}

function isCasualChat(text: string): boolean {
  return ["你好", "您好", "hi", "hello", "在吗", "谢谢"].includes(text.toLowerCase());
}

function isExplorationOnly(text: string): boolean {
  return /聊聊|想法|创意|怎么设计|怎么上/.test(text) && !/帮我做|生成|做一个|做份|输出/.test(text);
}

function wantsPpt(text: string): boolean {
  return /ppt|PPT|课件|幻灯片/.test(text);
}

function wantsLessonPlan(text: string): boolean {
  return /教案|教学设计/.test(text);
}

function wantsRequirementSpec(text: string): boolean {
  return /备课|公开课|需求|整理/.test(text);
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
