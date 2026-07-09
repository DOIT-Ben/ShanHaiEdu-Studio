export type TextareaHeightPlan = {
  rows: number;
  minRows: number;
  maxRows: number;
  overflowY: "hidden" | "auto";
};

export type ComposerQuickReply = {
  label: string;
  prompt: string;
  recommended?: boolean;
};

export type ComposerAttachmentStatus =
  | "pending_upload"
  | "uploading"
  | "uploaded"
  | "pending_parse"
  | "readable"
  | "parsed"
  | "parse_failed"
  | "unsupported";

export type ComposerAttachmentKind = "plain_text" | "markdown" | "spreadsheet_text" | "structured_text" | "unsupported";

export type ComposerAttachmentCard = {
  fileName: string;
  fileTypeLabel: string;
  status: ComposerAttachmentStatus;
  teacherLabel: string;
  canUseAsReference: boolean;
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
    parsed: "已读取，可作为材料参考",
    parse_failed: "解析失败，请重试或换一个文件",
    unsupported: "暂不支持这种文件",
  };

  return {
    status,
    teacherLabel: labels[status],
    understood: status === "readable" || status === "parsed",
  };
}

export function getComposerAttachmentKind(file: { name: string; type?: string }): ComposerAttachmentKind {
  const fileName = file.name.toLowerCase();
  const fileType = (file.type ?? "").toLowerCase();

  if (fileName.endsWith(".md") || fileName.endsWith(".markdown") || fileType.includes("markdown")) return "markdown";
  if (fileName.endsWith(".csv") || fileType.includes("csv")) return "spreadsheet_text";
  if (fileName.endsWith(".json")) return "structured_text";
  if (fileName.endsWith(".txt") || fileName.endsWith(".text") || fileType.startsWith("text/")) return "plain_text";

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

export function getGeneratingLabel(state: GeneratingState): string {
  const labels: Record<GeneratingState, string> = {
    generating: "正在生成回复",
    streaming: "正在继续写出回复",
    saving_artifact: "正在保存成果",
  };
  return labels[state];
}
