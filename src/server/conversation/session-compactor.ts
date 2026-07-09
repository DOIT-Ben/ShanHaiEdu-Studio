import { validateSessionSummary, type SummaryValidationResult } from "./summary-validator";

type SessionCompactorArtifact = {
  id?: string;
  title: string;
  kind: string;
  status: string;
  isApproved: boolean;
};

type SessionCompactorInput = {
  teacherGoal: string;
  recentMessages: { role: string; content: string }[];
  artifacts: SessionCompactorArtifact[];
  guardrails?: string[];
};

export function buildDeterministicSessionSummary(input: {
  teacherGoal: string;
  recentMessages: { role: string; content: string }[];
  artifacts: { title: string; kind: string; status: string; isApproved: boolean }[];
  guardrails?: string[];
}): string {
  const guardrails = input.guardrails?.length ? input.guardrails : ["不得把未完成产物写成已完成"];
  return [
    "## Objective",
    `- ${input.teacherGoal || "继续当前备课项目。"}`,
    "",
    "## Workflow State",
    `- 最近消息 ${input.recentMessages.length} 条。`,
    "",
    "## Artifact State",
    ...input.artifacts.map((artifact) => `- ${artifact.title}：${artifact.kind}，状态 ${artifact.status}，approved=${artifact.isApproved}`),
    "",
    "## Open Decisions",
    "- 若存在 needs_review 产物，需要教师确认后继续。",
    "",
    "## Guardrails",
    ...guardrails.map((guardrail) => `- ${guardrail}`),
  ].join("\n");
}

export function compactSessionWithValidation(input: SessionCompactorInput): {
  summary: string;
  validation: SummaryValidationResult;
} {
  const summary = buildDeterministicSessionSummary(input);
  const validation = validateSessionSummary({
    summaryMarkdown: summary,
    artifacts: input.artifacts.map((artifact, index) => ({
      id: artifact.id ?? `artifact-${index + 1}`,
      title: artifact.title,
      kind: artifact.kind,
      status: artifact.status,
      isApproved: artifact.isApproved,
    })),
    guardrails: input.guardrails ?? ["不得把未完成产物写成已完成"],
  });

  return { summary, validation };
}
