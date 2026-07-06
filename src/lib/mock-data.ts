import {
  BookOpen,
  ClipboardCheck,
  FileStack,
  Film,
  Image,
  PackageCheck,
  Presentation,
} from "lucide-react";
import type { ArtifactItem, ProjectItem, StepDefinition, ChatMessage } from "@/lib/types";

export const projects: ProjectItem[] = [
  {
    id: "p-001",
    title: "认识三角形公开课",
    meta: "二年级 · 人教版 · 新授课",
    status: "active",
    currentStep: "导入视频策划卡",
    updatedAt: "今天 15:12",
  },
  {
    id: "p-002",
    title: "万以内加法一次进位",
    meta: "二年级 · 人教版 · 公开课",
    status: "review",
    currentStep: "PPT 草稿重审",
    updatedAt: "昨天 18:24",
  },
  {
    id: "p-003",
    title: "认识周长",
    meta: "三年级 · 北师大版 · 探究课",
    status: "done",
    currentStep: "最终交付完成",
    updatedAt: "07-04 20:10",
  },
];

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
    body: "我要做一节二年级数学公开课，课题是认识三角形，需要导入视频和 14 页左右 PPT。",
  },
  {
    id: "m-2",
    speaker: "assistant",
    title: "已理解：先确认教材与知识点",
    body: "我会先使用已确认的教材证据和教案，继续生成导入视频策划卡。导入视频只负责吸引学生进入情境，不会提前讲三角形定义。",
    tone: "focus",
  },
  {
    id: "m-3",
    speaker: "assistant",
    title: "当前需要你确认",
    body: "推荐方案是“城市里的三角形力量”。它用桥梁、塔吊、屋顶三组生活画面制造悬念，最后通过“为什么这些地方都反复出现三角形”接回课堂观察任务。",
  },
];

export const artifacts: ArtifactItem[] = [
  {
    key: "textbook-evidence",
    kind: "textbook_evidence",
    title: "教材证据包",
    status: "approved",
    summary: "人教版二年级下册，第 42-44 页，聚焦三角形初步认识。",
    updatedAt: "今天 14:20",
    reusable: true,
    sourceTitles: ["项目配置"],
    previewFields: [
      { label: "教材版本", value: "人教版二年级下册" },
      { label: "页码", value: "42-44 页" },
      { label: "知识点", value: "三角形的边、角和生活形态" },
    ],
    actions: { canCopy: true, canUseAsInput: true, canOpenDetail: true, canConfirm: false, canRegenerate: true },
    content: {
      "证据摘要": "教材通过生活物体引出三角形，适合先观察、再分类、最后表达特征。",
      "关键页码": ["42 页：生活物体观察", "43 页：图形分类", "44 页：练习迁移"],
    },
  },
  {
    key: "lesson-plan",
    kind: "lesson_plan",
    title: "教案",
    status: "approved",
    summary: "已确认教学目标、重难点、教学流程和板书设计。",
    updatedAt: "今天 14:38",
    reusable: true,
    sourceTitles: ["教材证据包"],
    previewFields: [
      { label: "教学目标", value: "会观察并描述三角形的基本特征。" },
      { label: "重难点", value: "从生活图形中抽象出三角形。" },
      { label: "板书", value: "三角形：三条边、三个角。" },
    ],
    actions: { canCopy: true, canUseAsInput: true, canOpenDetail: true, canConfirm: false, canRegenerate: true },
    content: {
      "教学流程": "情境导入、观察分类、动手围一围、表达归纳、练习迁移。",
      "板书设计": "三角形 = 三条边 + 三个角；生活中的三角形。",
    },
  },
  {
    key: "intro-video-plan",
    kind: "intro_video_plan",
    title: "导入视频策划卡",
    status: "needs_review",
    summary: "候选主题：为什么桥梁、塔吊和屋顶都爱三角形。",
    updatedAt: "今天 15:02",
    reusable: true,
    sourceTitles: ["教案"],
    previewFields: [
      { label: "独立主题", value: "城市里的三角形力量" },
      { label: "开场钩子", value: "同样的纸条，为什么三角形不容易变形？" },
      { label: "课程锚点", value: "三角形结构反复出现，引出本课观察任务。" },
    ],
    actions: { canCopy: true, canUseAsInput: true, canOpenDetail: true, canConfirm: true, canRegenerate: true },
    content: {
      "开场钩子": "一座桥、一台塔吊、一个屋顶快速切换，提出共同问题。",
      "吸睛点": "画面从城市远景切到学生熟悉的校园屋顶，让学生先猜共同点。",
      "课堂落点问题": "这些物体为什么都藏着三角形？",
    },
  },
  {
    key: "ppt-draft",
    kind: "ppt_draft",
    title: "PPT 草稿",
    status: "in_progress",
    summary: "预计 14 页，生活观察、操作探究、练习迁移比例已设定。",
    updatedAt: "生成中",
    reusable: false,
    sourceTitles: ["教案", "导入视频策划卡"],
    previewFields: [
      { label: "页数", value: "14 页" },
      { label: "页面配比", value: "观察 3 页、探究 5 页、练习 4 页、小结 2 页" },
      { label: "主视觉", value: "桥梁、塔吊、屋顶中的三角形结构" },
    ],
    actions: { canCopy: false, canUseAsInput: false, canOpenDetail: true, canConfirm: false, canRegenerate: false },
    content: {
      "逐页摘要": "第 1-3 页建立生活悬念；第 4-8 页动手围图形；第 9-12 页判断和迁移；第 13-14 页板书小结。",
    },
  },
  {
    key: "image-prompts",
    kind: "image_prompts",
    title: "图片提示词",
    status: "not_started",
    summary: "等待 PPT 草稿确认后生成。",
    updatedAt: "尚未开始",
    reusable: false,
    sourceTitles: ["PPT 草稿"],
    previewFields: [
      { label: "用途", value: "PPT 主视觉、角色图、导入视频参考图" },
      { label: "画幅", value: "16:9、4:3、竖版封面按需生成" },
    ],
    actions: { canCopy: false, canUseAsInput: false, canOpenDetail: true, canConfirm: false, canRegenerate: false },
    content: {
      "示例用途": "PPT 主视觉、课堂任务角色、导入视频首帧参考图。",
    },
  },
  {
    key: "video-storyboard",
    kind: "video_storyboard",
    title: "视频分镜",
    status: "blocked",
    summary: "需要先确认导入视频策划卡。",
    updatedAt: "今天 15:05",
    reusable: false,
    sourceTitles: ["导入视频策划卡"],
    previewFields: [
      { label: "恢复方式", value: "先确认一套导入视频方案。" },
      { label: "内容安全", value: "旧内容未丢失，确认后可继续。" },
    ],
    actions: { canCopy: false, canUseAsInput: false, canOpenDetail: true, canConfirm: false, canRegenerate: false },
    content: {
      "失败恢复": "先确认导入视频策划卡，再生成镜头编号、时长、画面主体、参考图和旁白切片。",
    },
  },
  {
    key: "final-delivery",
    kind: "final_delivery",
    title: "最终交付",
    status: "not_started",
    summary: "将汇总教案、PPTX、导入视频、讲稿和检查清单。",
    updatedAt: "尚未开始",
    reusable: false,
    sourceTitles: ["教案", "PPT 草稿", "视频分镜"],
    previewFields: [
      { label: "交付内容", value: "教案、PPT、导入视频、讲稿、检查清单" },
    ],
    actions: { canCopy: false, canUseAsInput: false, canOpenDetail: true, canConfirm: false, canRegenerate: false },
    content: {
      "交付包": "完成后集中展示教案、PPT、导入视频、讲稿和检查清单。",
    },
  },
];

