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
  { key: "ppt_draft", title: "PPT 大纲", status: "not_started", order: 4, upstreamNodeKeys: ["lesson_plan"] },
  { key: "intro_video_plan", title: "导入方案", status: "not_started", order: 5, upstreamNodeKeys: ["lesson_plan"] },
  { key: "image_prompts", title: "图片提示词", status: "not_started", order: 6, upstreamNodeKeys: ["ppt_draft", "intro_video_plan"] },
  { key: "video_storyboard", title: "视频分镜", status: "not_started", order: 7, upstreamNodeKeys: ["intro_video_plan", "image_prompts"] },
  { key: "final_delivery", title: "最终交付", status: "not_started", order: 8, upstreamNodeKeys: ["lesson_plan", "ppt_draft", "intro_video_plan"] },
];

export const FIRST_WORKFLOW_NODE_KEY = DEFAULT_WORKFLOW_NODES[0].key;
