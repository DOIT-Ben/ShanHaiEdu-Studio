export type TextareaHeightPlan = {
  rows: number;
  minRows: number;
  maxRows: number;
  overflowY: "hidden" | "auto";
};

export type ComposerQuickReply = {
  label: string;
  prompt: string;
  actionId?: string;
  recommended?: boolean;
};

export type ComposerAttachmentStatus =
  | "pending_upload"
  | "uploading"
  | "uploaded"
  | "pending_parse"
  | "readable"
  | "readable_truncated"
  | "parsed"
  | "visual_reference"
  | "needs_manual_summary"
  | "parse_failed"
  | "unsupported";

export type ComposerAttachmentKind = "plain_text" | "markdown" | "spreadsheet_text" | "structured_text" | "image_reference" | "rich_document" | "unsupported";

export type ComposerToolMenuItem = {
  label: string;
  description: string;
  enabled: boolean;
  action?: "attach_file";
};

export type ComposerAttachmentCard = {
  fileName: string;
  fileTypeLabel: string;
  status: ComposerAttachmentStatus;
  teacherLabel: string;
  canUseAsReference: boolean;
};

export type ComposerAttachmentSubmissionSnapshot = {
  value: string;
  reference: string | null;
};

export type GeneratingState = "generating" | "streaming" | "saving_artifact";

export function getTextareaHeightPlan(value: string, options: { minRows?: number; maxRows?: number } = {}): TextareaHeightPlan {
  const minRows = options.minRows ?? 1;
  const maxRows = options.maxRows ?? 8;
  const visualRows = value.split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 48)), 0);
  const rows = Math.min(maxRows, Math.max(minRows, visualRows));

  return {
    rows,
    minRows,
    maxRows,
    overflowY: visualRows > maxRows ? "auto" : "hidden",
  };
}

export function normalizeQuickReplies(replies: ComposerQuickReply[]): ComposerQuickReply[] {
  return replies
    .filter((reply) => reply.label.trim() && reply.prompt.trim())
    .map((reply) => ({
      label: reply.label.trim(),
      prompt: reply.prompt.trim(),
      actionId: reply.actionId?.trim() || undefined,
      recommended: reply.recommended || undefined,
    }));
}

export function applyQuickReplyToDraft(prompt: string): { draft: string; shouldSend: false } {
  return {
    draft: prompt,
    shouldSend: false,
  };
}

export function normalizeAttachmentStatus(status: ComposerAttachmentStatus): { status: ComposerAttachmentStatus; teacherLabel: string; understood: boolean } {
  const labels: Record<ComposerAttachmentStatus, string> = {
    pending_upload: "待上传",
    uploading: "上传中",
    uploaded: "已上传，待解析",
    pending_parse: "待解析",
    readable: "已读取，可作为材料参考",
    readable_truncated: "已读取前 12000 字，可作为材料参考",
    parsed: "已读取，可作为材料参考",
    visual_reference: "截图已记录，请在输入框补充可见文字或画面要点",
    needs_manual_summary: "请摘取关键内容或另存为文本后使用",
    parse_failed: "解析失败，请重试或换一个文件",
    unsupported: "暂不支持这种文件",
  };

  return {
    status,
    teacherLabel: labels[status],
    understood: status === "readable" || status === "readable_truncated" || status === "parsed",
  };
}

export function getComposerAttachmentKind(file: { name: string; type?: string }): ComposerAttachmentKind {
  const fileName = file.name.toLowerCase();
  const fileType = (file.type ?? "").toLowerCase();

  if (/\.(png|jpg|jpeg|webp)$/i.test(fileName)) return "image_reference";
  if (/\.(pdf|doc|docx)$/i.test(fileName)) return "rich_document";
  if (fileName.endsWith(".md") || fileName.endsWith(".markdown") || fileType.includes("markdown")) return "markdown";
  if (fileName.endsWith(".csv") || fileType.includes("csv")) return "spreadsheet_text";
  if (fileName.endsWith(".json")) return "structured_text";
  if (fileName.endsWith(".txt") || fileName.endsWith(".text") || fileType.startsWith("text/")) return "plain_text";
  if (fileType.startsWith("image/")) return "image_reference";
  if (fileType === "application/pdf") return "rich_document";

  return "unsupported";
}

export function buildComposerAttachmentCard(input: {
  fileName: string;
  mimeType?: string;
  status: ComposerAttachmentStatus;
}): ComposerAttachmentCard {
  const kind = getComposerAttachmentKind({ name: input.fileName, type: input.mimeType });
  const typeLabels: Record<ComposerAttachmentKind, string> = {
    plain_text: "文本资料",
    markdown: "Markdown 文本",
    spreadsheet_text: "表格文本",
    structured_text: "结构化文本",
    image_reference: "图片参考",
    rich_document: "文档资料",
    unsupported: "暂不支持",
  };
  const normalized = normalizeAttachmentStatus(input.status);

  return {
    fileName: input.fileName,
    fileTypeLabel: typeLabels[kind],
    status: normalized.status,
    teacherLabel: normalized.teacherLabel,
    canUseAsReference: normalized.understood,
  };
}

export function hasCompletedComposerAttachmentSubmission(input: {
  snapshot: ComposerAttachmentSubmissionSnapshot | null;
  value: string;
  reference: string | null;
  composerSubmitting: boolean;
}): boolean {
  if (!input.snapshot || input.composerSubmitting) return false;
  return input.value !== input.snapshot.value || input.reference !== input.snapshot.reference;
}

export function getGeneratingLabel(state: GeneratingState): string {
  const labels: Record<GeneratingState, string> = {
    generating: "正在生成回复",
    streaming: "正在继续写出回复",
    saving_artifact: "正在保存成果",
  };
  return labels[state];
}

export function buildWelcomePromptSuggestions(): ComposerQuickReply[] {
  return normalizeQuickReplies([
    {
      label: "公开课目标",
      prompt: "请帮我设计一节公开课：五年级数学百分数，目标是让学生理解百分数和生活情境的关系。",
      recommended: true,
    },
    {
      label: "教案和课件",
      prompt: "请根据我的教学主题生成一版教案结构和 PPT 大纲，先列出每页要讲什么。",
    },
    {
      label: "导入视频",
      prompt: "请为这节课设计一个 30 秒导入视频方案，包含画面、旁白和课堂提问。",
    },
    {
      label: "检查优化",
      prompt: "请检查这节课的目标、活动和评价是否一致，并给出可以直接修改的建议。",
    },
  ]);
}

export function getComposerToolMenuItems(): ComposerToolMenuItem[] {
  return [
    {
      label: "添加文本资料",
      description: "读取小型文本、Markdown、CSV 或 JSON 文件作为本轮参考。",
      enabled: true,
      action: "attach_file",
    },
    {
      label: "粘贴截图参考",
      description: "可直接在输入框粘贴截图；文字仍需手动补充。",
      enabled: false,
    },
    {
      label: "继续排队生成",
      description: "发送按钮会在项目忙碌时显示加入队列。",
      enabled: false,
    },
    {
      label: "自动读取 PDF/DOCX",
      description: "暂未接通，请先摘取关键内容或另存为文本。",
      enabled: false,
    },
    {
      label: "实时逐字输出",
      description: "暂未接通，当前展示生成、排队和保存状态。",
      enabled: false,
    },
  ];
}
