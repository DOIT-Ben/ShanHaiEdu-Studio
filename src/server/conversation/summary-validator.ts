export type SummaryValidationArtifact = {
  id: string;
  title: string;
  kind: string;
  status: string;
  isApproved: boolean;
};

export type SummaryValidationResult = { status: "passed" | "failed"; errors: string[] };

function hasPositiveCompletionClaim(summaryMarkdown: string): boolean {
  const completionClaimPattern = /已完成|可下载|最终完成|交付完成|已生成|生成成功|已产出|已打包|真实.{0,8}文件|下载核对/;
  const negatedOrProhibitedCompletionPattern = /(不把|不能|不得|禁止)[^\n。；;]*(已完成|可下载|最终完成|交付完成)/;

  return summaryMarkdown
    .split(/[\r\n。；;，,、！!？?]+/)
    .some((segment) => completionClaimPattern.test(segment) && !negatedOrProhibitedCompletionPattern.test(segment));
}

function normalizeForMatch(text: string): string {
  return text
    .replace(/[\s，。；;：:、,.!！?？-]/g, "")
    .trim();
}

function buildGuardrailVariants(guardrail: string): string[] {
  const normalizedGuardrail = normalizeForMatch(guardrail);
  const variants = new Set<string>([normalizedGuardrail]);

  if (normalizedGuardrail.startsWith("不得把")) {
    variants.add(normalizedGuardrail.replace(/^不得把/, "不把"));
    variants.add(normalizedGuardrail.replace(/^不得把/, "不能把"));
    variants.add(normalizedGuardrail.replace(/^不得把/, "禁止把"));
  } else if (normalizedGuardrail.startsWith("不得")) {
    variants.add(normalizedGuardrail.replace(/^不得/, "不能"));
    variants.add(normalizedGuardrail.replace(/^不得/, "禁止"));
    variants.add(normalizedGuardrail.replace(/^不得/, "不要"));
  }

  return Array.from(variants).filter(Boolean);
}

function hasNegatedGuardrailContext(normalizedSummary: string, variants: string[]): boolean {
  return variants.some((variant) => {
    const index = normalizedSummary.indexOf(variant);
    if (index < 0) return false;
    const prefix = normalizedSummary.slice(Math.max(0, index - 16), index);
    const suffix = normalizedSummary.slice(index + variant.length);
    return /删除约束|删除|移除|去掉|不需要保留|无需保留|不用保留|不是$/.test(prefix) ||
      /已删除|不再约束|无需执行|不用执行|允许|例外|除外/.test(suffix);
  });
}

function hasGuardrail(summaryMarkdown: string, guardrail: string): boolean {
  const normalizedSummary = normalizeForMatch(summaryMarkdown);
  const guardrailVariants = buildGuardrailVariants(guardrail);
  if (guardrailVariants.length === 0) return true;
  if (!normalizedSummary) return false;
  if (hasNegatedGuardrailContext(normalizedSummary, guardrailVariants)) return false;
  return guardrailVariants.some((variant) => normalizedSummary.includes(variant));
}

export function validateSessionSummary(input: {
  summaryMarkdown: string;
  artifacts: SummaryValidationArtifact[];
  guardrails: string[];
}): SummaryValidationResult {
  const errors: string[] = [];
  const hasCompletionClaim = hasPositiveCompletionClaim(input.summaryMarkdown);
  const hasUnfinishedArtifact = input.artifacts.some((artifact) => artifact.status !== "approved" || !artifact.isApproved);

  if (hasCompletionClaim && hasUnfinishedArtifact) {
    errors.push("摘要不能把未完成产物写成已完成。");
  }

  if (/长期偏好|以后都|每次都/.test(input.summaryMarkdown) && !/待审批|未写入长期记忆/.test(input.summaryMarkdown)) {
    errors.push("摘要不能把临时偏好直接写成长期记忆。");
  }

  const missingGuardrails = input.guardrails.filter((guardrail) => !hasGuardrail(input.summaryMarkdown, guardrail));
  if (missingGuardrails.length > 0) {
    errors.push(`摘要丢失关键约束：${missingGuardrails.join("；")}`);
  }

  return { status: errors.length > 0 ? "failed" : "passed", errors };
}
