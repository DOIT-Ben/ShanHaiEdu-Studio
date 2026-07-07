import type { AgentRuntimeTask } from "./types";

export type RuntimeTaskGuidance = {
  label: string;
  requiredFields: string[];
  checklist: string[];
};

export const taskGuidance: Record<AgentRuntimeTask, RuntimeTaskGuidance> = {
  requirement_spec: {
    label: "需求规格说明书",
    requiredFields: ["项目概述", "用户目标", "教材信息", "交付范围", "质量约束", "后续节点输入说明"],
    checklist: ["年级、学科、课题和课时是否清楚。", "交付范围是否明确区分文本产物和后续文件能力。", "缺失教材时是否写明会影响可信度。"],
  },
  textbook_evidence: {
    label: "教材证据包",
    requiredFields: ["教材版本", "页码或页段", "知识点", "关键例题或情境", "依据摘要", "与教学目标关系"],
    checklist: ["教材版本和页段是否可追溯。", "证据是否直接服务本课教学目标。", "缺少教材原文时是否提示待补充。"],
  },
  lesson_plan: {
    label: "公开课教案",
    requiredFields: ["教材依据", "教学目标", "教学重点", "教学难点", "教学流程", "导入设计", "学生活动", "板书设计", "课堂总结", "教师讲稿要点"],
    checklist: ["教学重点和教学难点是否区分清楚。", "学生活动是否可观察、可追问。", "课堂总结是否回到本课核心概念。"],
  },
  ppt_outline: {
    label: "PPT 大纲与逐页脚本",
    requiredFields: ["建议页数", "页面类型配比", "逐页脚本", "每页教学目标", "学生活动", "主视觉需求"],
    checklist: ["每页是否只承载一个教学动作。", "页面节奏是否匹配课堂时长。", "主视觉需求是否服务教学而非装饰。"],
  },
  intro_video_plan: {
    label: "导入视频方案",
    requiredFields: ["独立主题", "开场钩子", "课程锚点", "课堂落点问题", "脚本", "分镜摘要", "图片提示词", "旁白建议"],
    checklist: ["是否不提前讲解知识结论。", "课程锚点是否能自然接回课堂。", "视频是否只承担吸引和设问，不替代授课。"],
  },
  final_delivery_checklist: {
    label: "最终交付清单",
    requiredFields: ["需求规格", "教材证据", "教案", "PPT 大纲", "导入视频方案", "教师讲稿", "检查清单", "未完成文件能力标记"],
    checklist: ["已完成文本产物是否全部列齐。", "PPTX、图片文件、视频成片未真实生成时是否不得标记为已完成。", "教师课前核对事项是否可执行。"],
  },
};
