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
  | "parsed"
  | "parse_failed"
  | "unsupported";

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
  return [...replies]
    .filter((reply) => reply.label.trim() && reply.prompt.trim())
    .sort((left, right) => Number(Boolean(right.recommended)) - Number(Boolean(left.recommended)))
    .slice(0, 3)
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
    parsed: "已解析，可作为材料参考",
    parse_failed: "解析失败，请重试或换一个文件",
    unsupported: "暂不支持这种文件",
  };

  return {
    status,
    teacherLabel: labels[status],
    understood: status === "parsed",
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
