import { BookOpen, ClipboardCheck, FileStack, Film, Image, PackageCheck, Presentation } from "lucide-react";
import type { ChatMessage, StepDefinition } from "@/lib/types";

export const steps: StepDefinition[] = [
  { key: "textbook_evidence", label: "教材证据", Icon: BookOpen },
  { key: "lesson_plan", label: "教案", Icon: ClipboardCheck },
  { key: "intro_video_plan", label: "导入方案", Icon: Film },
  { key: "ppt_draft", label: "PPT 草稿", Icon: Presentation },
  { key: "image_prompts", label: "图片提示词", Icon: Image },
  { key: "video_storyboard", label: "视频分镜", Icon: FileStack },
  { key: "final_delivery", label: "最终交付", Icon: PackageCheck },
];

export const chatMessages: ChatMessage[] = [
  {
    id: "m-1",
    speaker: "teacher",
    body: "请基于新版数学二年级上册第七单元“表内乘法（一）”，设计一节40分钟的公开课，包含教学目标、教学流程、课堂练习与板书设计。",
  },
  {
    id: "m-2",
    speaker: "assistant",
    title: "好的，我将为您生成完整的教学设计方案。",
    body: "我会先确认教材依据与教学目标，再继续生成 PPT 页面、导入活动和后续资源。",
    tone: "focus",
  },
  {
    id: "m-3",
    speaker: "assistant",
    title: "当前需要你确认",
    body: "推荐方案是“城市里的三角形力量”。它用桥梁、塔吊、屋顶三组生活画面制造悬念，最后通过“为什么这些地方都反复出现三角形”接回课堂观察任务。",
  },
];

