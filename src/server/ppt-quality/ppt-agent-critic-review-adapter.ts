import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import type { AgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import type { ArtifactRecord, SubmitPptFullDeckReviewInput, SubmitPptSampleReviewInput } from "@/server/workbench/types";
import type { PptKeySampleCandidate } from "./ppt-asset-types";
import { validatePptKeySampleCandidate } from "./ppt-key-sample-candidate";
import type { PptFullDeckCandidate } from "./ppt-production-types";
import { validatePptFullDeckCandidate } from "./ppt-full-deck-candidate";

export type PptAgentCriticReview =
  | { kind: "sample"; submission: SubmitPptSampleReviewInput }
  | { kind: "full_deck"; submission: SubmitPptFullDeckReviewInput };

export function adaptPptAgentCriticReview(input: {
  projectId: string;
  intentEpoch: number;
  envelope: AgentToolInvocationEnvelope;
  artifact: ArtifactRecord;
  structuredOutput: Record<string, unknown>;
}): PptAgentCriticReview {
  assertBinding(input);
  const output = input.structuredOutput;
  if (output.recommendation !== "pass" && output.recommendation !== "rework_required" && output.recommendation !== "blocked") {
    throw new Error("ppt_critic_review_inconclusive");
  }
  const findings = parseFindings(output.findings, input.artifact.id);
  if (output.recommendation === "pass" && findings.length > 0) throw new Error("ppt_critic_pass_has_findings");
  if (output.recommendation !== "pass" && findings.length === 0) throw new Error("ppt_critic_failure_missing_page_findings");

  if (input.envelope.arguments.stage === "ppt_sample_review") {
    const candidate = input.artifact.structuredContent.pptKeySampleCandidate as PptKeySampleCandidate | undefined;
    if (!candidate || !validatePptKeySampleCandidate(candidate)) throw new Error("ppt_sample_candidate_invalid");
    const pages = new Set(candidate.samplePageIds);
    assertFindingPages(findings, pages);
    return {
      kind: "sample",
      submission: {
        candidateDigest: candidate.candidateDigest,
        reviewSource: "critic",
        reviewerMessageId: input.envelope.sourceMessageId,
        qa: candidate.samplePageIds.map((pageId) => sampleQa(pageId, findings)),
      },
    };
  }

  if (input.envelope.arguments.stage === "ppt_full_review") {
    const candidate = input.artifact.structuredContent.pptFullDeckCandidate as PptFullDeckCandidate | undefined;
    if (!candidate || !validatePptFullDeckCandidate(candidate)) throw new Error("ppt_full_candidate_invalid");
    const pages = new Set(candidate.pageIds);
    assertFindingPages(findings, pages);
    return {
      kind: "full_deck",
      submission: {
        candidateDigest: candidate.candidateDigest,
        reviewSource: "critic",
        reviewerMessageId: input.envelope.sourceMessageId,
        qa: candidate.pageIds.map((pageId) => fullDeckQa(pageId, findings)),
      },
    };
  }

  throw new Error("ppt_critic_stage_invalid");
}

function assertBinding(input: Parameters<typeof adaptPptAgentCriticReview>[0]) {
  if (input.envelope.toolId !== "delivery_critic.review" || input.envelope.arguments.domain !== "ppt") throw new Error("ppt_critic_tool_binding_invalid");
  if (input.envelope.projectId !== input.projectId || input.envelope.intentEpoch !== input.intentEpoch) throw new Error("ppt_critic_project_binding_invalid");
  const target = input.envelope.reviewTargetRef;
  if (!target || target.artifactId !== input.artifact.id || target.version !== input.artifact.version || target.kind !== input.artifact.kind) {
    throw new Error("ppt_critic_artifact_binding_invalid");
  }
  const digest = hashArtifactDraft({
    nodeKey: input.artifact.nodeKey,
    kind: input.artifact.kind,
    title: input.artifact.title,
    summary: input.artifact.summary,
    markdownContent: input.artifact.markdownContent,
    structuredContent: input.artifact.structuredContent,
  });
  if (target.digest !== digest) throw new Error("ppt_critic_digest_binding_invalid");
}

type Finding = { pageId: string; dimensionId: "design" | "visual" | "provenance" | "readability"; message: string };

function parseFindings(value: unknown, artifactId: string): Finding[] {
  if (!Array.isArray(value)) throw new Error("ppt_critic_findings_invalid");
  return value.map((entry) => {
    if (!isRecord(entry) || !isRecord(entry.locator) || entry.locator.kind !== "page" || entry.locator.parentArtifactId !== artifactId) {
      throw new Error("ppt_critic_page_locator_invalid");
    }
    const dimensionId = entry.dimensionId;
    if (dimensionId !== "design" && dimensionId !== "visual" && dimensionId !== "provenance" && dimensionId !== "readability") {
      throw new Error("ppt_critic_dimension_missing");
    }
    if (typeof entry.locator.pageId !== "string" || typeof entry.minimalFix !== "string" || !entry.minimalFix.trim()) {
      throw new Error("ppt_critic_finding_invalid");
    }
    return { pageId: entry.locator.pageId, dimensionId, message: entry.minimalFix.trim() };
  });
}

function assertFindingPages(findings: Finding[], pages: Set<string>) {
  if (findings.some((finding) => !pages.has(finding.pageId))) throw new Error("ppt_critic_page_outside_candidate");
}

function sampleQa(pageId: string, findings: Finding[]): SubmitPptSampleReviewInput["qa"][number] {
  const pageFindings = findings.filter((finding) => finding.pageId === pageId);
  return {
    pageId,
    design: pageFindings.some((finding) => finding.dimensionId === "design") ? "failed" : "passed",
    visual: pageFindings.some((finding) => finding.dimensionId === "visual") ? "failed" : "passed",
    provenance: pageFindings.some((finding) => finding.dimensionId === "provenance") ? "failed" : "passed",
    findings: pageFindings.map((finding) => finding.message),
  };
}

function fullDeckQa(pageId: string, findings: Finding[]): SubmitPptFullDeckReviewInput["qa"][number] {
  const pageFindings = findings.filter((finding) => finding.pageId === pageId);
  return {
    ...sampleQa(pageId, findings),
    readability: pageFindings.some((finding) => finding.dimensionId === "readability") ? "failed" : "passed",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
