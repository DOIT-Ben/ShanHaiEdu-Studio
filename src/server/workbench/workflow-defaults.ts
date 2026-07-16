import type { WorkflowNodeKey, WorkflowNodeStatus } from "./types";

export type DefaultWorkflowNode = {
  key: WorkflowNodeKey;
  title: string;
  status: WorkflowNodeStatus;
  order: number;
  upstreamNodeKeys: WorkflowNodeKey[];
};

export const DEFAULT_WORKFLOW_NODES: DefaultWorkflowNode[] = [
  { key: "requirement_spec", title: "需求规格", status: "needs_review", order: 1, upstreamNodeKeys: [] },
  { key: "textbook_evidence", title: "教材证据", status: "not_started", order: 2, upstreamNodeKeys: ["requirement_spec"] },
  { key: "lesson_plan", title: "教案", status: "not_started", order: 3, upstreamNodeKeys: ["requirement_spec", "textbook_evidence"] },
  { key: "interactive_courseware_spec", title: "互动课件", status: "not_started", order: 20, upstreamNodeKeys: ["lesson_plan"] },
  { key: "ppt_draft", title: "PPT 大纲", status: "not_started", order: 4, upstreamNodeKeys: ["lesson_plan"] },
  { key: "ppt_design_draft", title: "PPT 设计稿", status: "not_started", order: 5, upstreamNodeKeys: ["ppt_draft"] },
  { key: "pptx_artifact", title: "PPTX 文件", status: "not_started", order: 6, upstreamNodeKeys: ["ppt_design_draft"] },
  { key: "intro_video_plan", title: "导入方案", status: "not_started", order: 7, upstreamNodeKeys: ["lesson_plan"] },
  { key: "knowledge_anchor_extract", title: "最小课程锚点", status: "not_started", order: 8, upstreamNodeKeys: ["requirement_spec"] },
  { key: "creative_theme_generate", title: "独立创意主题", status: "not_started", order: 9, upstreamNodeKeys: ["requirement_spec"] },
  { key: "video_script_generate", title: "视频脚本", status: "not_started", order: 10, upstreamNodeKeys: ["creative_theme_generate"] },
  { key: "storyboard_generate", title: "视频分镜", status: "not_started", order: 11, upstreamNodeKeys: ["video_script_generate"] },
  { key: "asset_brief_generate", title: "资产说明", status: "not_started", order: 12, upstreamNodeKeys: ["storyboard_generate"] },
  { key: "asset_image_generate", title: "资产图", status: "not_started", order: 13, upstreamNodeKeys: ["asset_brief_generate"] },
  { key: "video_segment_plan", title: "分镜视频计划", status: "not_started", order: 14, upstreamNodeKeys: ["storyboard_generate", "asset_image_generate"] },
  { key: "video_segment_generate", title: "分镜视频", status: "not_started", order: 15, upstreamNodeKeys: ["video_segment_plan", "asset_image_generate"] },
  { key: "video_narration_generate", title: "视频旁白与字幕", status: "not_started", order: 15, upstreamNodeKeys: ["video_script_generate"] },
  { key: "concat_only_assemble", title: "只拼接成片", status: "not_started", order: 16, upstreamNodeKeys: ["video_segment_generate", "storyboard_generate", "video_script_generate", "video_narration_generate"] },
  { key: "image_prompts", title: "图片提示词", status: "not_started", order: 17, upstreamNodeKeys: ["ppt_design_draft", "intro_video_plan"] },
  { key: "video_storyboard", title: "视频分镜", status: "not_started", order: 18, upstreamNodeKeys: ["intro_video_plan", "image_prompts"] },
  { key: "final_delivery", title: "最终交付", status: "not_started", order: 19, upstreamNodeKeys: ["requirement_spec", "lesson_plan", "ppt_design_draft", "pptx_artifact", "image_prompts", "concat_only_assemble"] },
];

export const FIRST_WORKFLOW_NODE_KEY = DEFAULT_WORKFLOW_NODES[0].key;
