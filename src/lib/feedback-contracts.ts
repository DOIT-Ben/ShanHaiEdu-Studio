export type FeedbackCategory =
  | "visual"
  | "bug"
  | "content_quality"
  | "confusing"
  | "feature_request"
  | "performance"
  | "other";

export type FeedbackSeverity = "normal" | "affected" | "blocked";

export type FeedbackOrigin = "global" | "profile" | "message_helpful" | "message_unhelpful";

export type FeedbackClientContext = {
  userAgent?: string;
  language?: string;
  viewport?: {
    width: number;
    height: number;
  };
};

export type FeedbackMetadata = {
  category: FeedbackCategory;
  description: string;
  severity?: FeedbackSeverity;
  idempotencyKey: string;
  origin: FeedbackOrigin;
  projectId?: string;
  messageId?: string;
  pageRoute: string;
  clientContext: FeedbackClientContext;
};

export type FeedbackSubmissionResponse = {
  feedbackId: string;
  receiptCode: string;
  status: "submitted";
  reused?: boolean;
};

export type FeedbackOpenInput = {
  origin: FeedbackOrigin;
  projectId?: string;
  messageId?: string;
};

export type OpenFeedback = (input: FeedbackOpenInput) => void;

export type FeedbackCategoryOption = {
  id: FeedbackCategory;
  label: string;
  placeholder: string;
  chips: readonly string[];
};

export const feedbackCategoryOptions = [
  {
    id: "visual",
    label: "页面不好看",
    placeholder: "哪个位置看起来不协调？可以说说文字、颜色、间距、布局或手机显示。",
    chips: ["文字层级不清楚", "间距或对齐不舒服", "手机上显示有问题"],
  },
  {
    id: "bug",
    label: "功能异常",
    placeholder: "你刚才做了什么？哪个按钮或步骤没有按预期工作？",
    chips: ["按钮没有反应", "操作后结果不对", "页面卡住无法继续"],
  },
  {
    id: "content_quality",
    label: "生成结果不对",
    placeholder: "哪部分内容不准确、不完整或不适合课堂？你期待怎样的结果？",
    chips: ["内容不准确", "结果不完整", "不适合真实课堂"],
  },
  {
    id: "confusing",
    label: "不知道怎么操作",
    placeholder: "你停在哪一步？你原本以为下一步应该是什么？",
    chips: ["不知道下一步做什么", "提示看不懂", "找不到需要的入口"],
  },
  {
    id: "feature_request",
    label: "希望增加功能",
    placeholder: "你希望系统帮你完成什么任务？现在用什么方式替代？",
    chips: ["希望减少操作步骤", "希望增加新的产物", "希望支持新的材料类型"],
  },
  {
    id: "performance",
    label: "加载慢或卡顿",
    placeholder: "哪一步最慢？大约等待了多久？最后是否成功？",
    chips: ["打开页面很慢", "生成等待太久", "操作时明显卡顿"],
  },
  {
    id: "other",
    label: "其他反馈",
    placeholder: "请描述你遇到的情况和期待的改进。",
    chips: ["有一处体验不舒服", "希望流程更清楚"],
  },
] as const satisfies readonly FeedbackCategoryOption[];

export const feedbackSeverityOptions = [
  { id: "normal", label: "一般" },
  { id: "affected", label: "影响使用" },
  { id: "blocked", label: "完全无法继续" },
] as const satisfies ReadonlyArray<{ id: FeedbackSeverity; label: string }>;
