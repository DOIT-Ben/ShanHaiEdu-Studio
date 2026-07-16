import type { GenerationIntensity } from "@/server/generation-intensity/generation-intensity-policy";

import { createTaskBrief, type TaskBrief } from "./task-contract";

export type TaskBriefProposal = {
  goal: string;
  requestedOutputs: string[];
  constraints: string[];
  excludedOutputs: string[];
};

export type CreateTaskBriefFromProposalInput = {
  proposal: TaskBriefProposal;
  projectId: string;
  taskId: string;
  intentEpoch: number;
  sourceMessageId: string;
  generationIntensity: GenerationIntensity;
};

export function proposeDeterministicTaskBriefFixture(
  content: string,
  project: { grade?: string | null; subject?: string | null; lessonTopic?: string | null },
): TaskBriefProposal | null {
  const goal = content.trim();
  if (!goal || isPureConversationFixture(goal)) return null;
  const taskScope = inferTaskScopeFixture(goal);
  const explicitDelivery = hasExplicitDeliveryIntentFixture(goal);
  if (!explicitDelivery && taskScope.requestedOutputs.length === 0) return null;
  return {
    goal,
    requestedOutputs: taskScope.requestedOutputs.length > 0
      ? taskScope.requestedOutputs
      : ["requirement_spec"],
    constraints: [project.grade, project.subject, project.lessonTopic]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => value.trim()),
    excludedOutputs: taskScope.excludedOutputs,
  };
}

export function createTaskBriefFromProposal(input: CreateTaskBriefFromProposalInput): TaskBrief {
  const proposal = validateTaskBriefProposal(input.proposal);
  const projectId = requireText(input.projectId, "projectId");
  const taskId = requireText(input.taskId, "taskId");
  const sourceMessageId = requireText(input.sourceMessageId, "sourceMessageId");
  if (!Number.isInteger(input.intentEpoch) || input.intentEpoch < 0) {
    throw new Error("Task intake intentEpoch must be a non-negative integer.");
  }
  if (!isGenerationIntensity(input.generationIntensity)) {
    throw new Error("Task intake generationIntensity is invalid.");
  }

  const requested = new Set(proposal.requestedOutputs);
  const overlap = proposal.excludedOutputs.filter((output) => requested.has(output));
  if (overlap.length > 0) {
    throw new Error(`Task intake output cannot be both requested and excluded: ${overlap.join(", ")}`);
  }

  return createTaskBrief({
    taskId,
    projectId,
    intentEpoch: input.intentEpoch,
    goal: proposal.goal,
    requestedOutputs: proposal.requestedOutputs,
    constraints: proposal.constraints,
    excludedOutputs: proposal.excludedOutputs,
    generationIntensity: input.generationIntensity,
    sourceMessageId,
  });
}

export function validateTaskBriefProposal(value: TaskBriefProposal): TaskBriefProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Task intake proposal must be an object.");
  }
  const goal = requireText(value.goal, "proposal.goal");
  const requestedOutputs = normalizeTextArray(value.requestedOutputs, "proposal.requestedOutputs");
  if (requestedOutputs.length === 0) {
    throw new Error("Task intake proposal requires at least one requested output.");
  }
  return {
    goal,
    requestedOutputs,
    constraints: normalizeTextArray(value.constraints, "proposal.constraints"),
    excludedOutputs: normalizeTextArray(value.excludedOutputs, "proposal.excludedOutputs"),
  };
}

function normalizeTextArray(value: string[], field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Task intake ${field} must be a string array.`);
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))].sort();
}

function isGenerationIntensity(value: string): value is GenerationIntensity {
  return value === "standard" || value === "enhanced" || value === "deep" || value === "extreme";
}

function requireText(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Task intake ${field} is required.`);
  return normalized;
}

function isPureConversationFixture(content: string) {
  return /^(?:你好|您好|嗨|在吗|谢谢|好的|知道了|明白了|你是谁|你能做什么)[。.!！?？]*$/i.test(content.trim());
}

function hasExplicitDeliveryIntentFixture(content: string) {
  return /(?:请|帮我|需要|想要|我要|给我|替我|把).{0,48}(?:做|制作|生成|整理|准备|完成|交付|形成|改写|输出)|(?:做|制作|生成|整理|准备|完成|交付|形成|输出).{0,48}(?:成果|方案|内容|资料|材料|成品|一套)/i.test(content);
}

function inferTaskScopeFixture(goal: string): { requestedOutputs: string[]; excludedOutputs: string[] } {
  const negativeClauses = [...goal.matchAll(/(?:不(?:做|要|生成|需要|包含|打包)|不要|无需)[^，,。；;！!\n]*/gi)]
    .map((match) => match[0]);
  const positiveGoal = negativeClauses.reduce((text, clause) => text.replace(clause, " "), goal);
  const excludedOutputs = inferOutputsFromTextFixture(negativeClauses.join(" "), true);
  const requestedOutputs = inferOutputsFromTextFixture(positiveGoal, false)
    .filter((output) => !excludedOutputs.includes(output));
  return { requestedOutputs, excludedOutputs };
}

function inferOutputsFromTextFixture(text: string, includeVideoWhenScriptMentioned: boolean): string[] {
  const hasVideoScript = /视频脚本|导入脚本/i.test(text);
  return [
    /教案/i.test(text) ? "lesson_plan" : null,
    /PPT|课件/i.test(text) ? "ppt" : null,
    hasVideoScript ? "video_script" : null,
    /图片|图像|素材图|生图|视觉图/i.test(text) ? "image" : null,
    /成片/i.test(text) || (includeVideoWhenScriptMentioned ? /视频/i.test(text) : /视频/i.test(text) && !hasVideoScript) ? "video" : null,
    /材料包|交付包|整包|打包/i.test(text) ? "package" : null,
  ].filter((value): value is string => Boolean(value));
}
