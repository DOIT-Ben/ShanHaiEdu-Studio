import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { EvidenceBinding } from "./ppt-quality-types";

export type PptDesignCandidatePagePlan = {
  pageNumber: number;
  objectiveIds: string[];
  narrativeJob: string;
  teachingAction: string;
  takeawayTitle: string;
  primaryVisualBrief: string;
};

export type PptDesignCandidateInput = {
  schemaVersion: "ppt-design-candidate.v1";
  taskBriefDigest: string;
  goalSummary: string;
  brief: {
    grade: string;
    subject: string;
    topic: string;
    audience: string;
    useCase: "public_lesson" | "competition_lesson" | "ordinary_lesson";
    targetSlideCount: number;
  };
  evidenceBindings: EvidenceBinding[];
  objectives: Array<{ objectiveId: string; statement: string; evidenceRefs: string[] }>;
  narrative: {
    openingTension: string;
    learningProgression: string[];
    closingResolution: string;
  };
  pagePlans: PptDesignCandidatePagePlan[];
  downstreamUse: "production_design_expansion";
};

export type PptDesignCandidate = PptDesignCandidateInput & {
  candidateDigest: string;
};

export type PptDesignCandidateValidation = {
  valid: boolean;
  issues: string[];
};

const digestPattern = /^[a-f0-9]{64}$/;
const pageRangePattern = /第\s*\d+\s*(?:-|—|–|~|～|至|到)\s*\d+\s*页/i;

export function createPptDesignCandidateProjection(input: PptDesignCandidateInput): {
  candidate: PptDesignCandidate;
} {
  const semantic = structuredClone(input);
  const candidate: PptDesignCandidate = {
    ...semantic,
    candidateDigest: hashRunInput(semantic),
  };
  const validation = validatePptDesignCandidate(candidate);
  if (!validation.valid) {
    throw new Error(`ppt_design_candidate_invalid:${validation.issues.join(",")}`);
  }
  return { candidate };
}

export function validatePptDesignCandidate(input: PptDesignCandidate): PptDesignCandidateValidation {
  const issues: string[] = [];
  if (!isRecord(input) || input.schemaVersion !== "ppt-design-candidate.v1") {
    return { valid: false, issues: ["schema_version_invalid"] };
  }
  if (!digestPattern.test(input.taskBriefDigest)) issues.push("task_brief_digest_invalid");
  requireText(input.goalSummary, "goal_summary_missing", issues);
  if (!isRecord(input.brief)) issues.push("brief_missing");
  if (!Number.isInteger(input.brief?.targetSlideCount) || input.brief.targetSlideCount < 1 || input.brief.targetSlideCount > 60) {
    issues.push("target_slide_count_invalid");
  }
  for (const value of [input.brief?.grade, input.brief?.subject, input.brief?.topic, input.brief?.audience]) {
    requireText(value, "brief_semantics_incomplete", issues);
  }

  const evidenceIds = validateEvidenceBindings(input.evidenceBindings, issues);
  const objectiveIds = validateObjectives(input.objectives, evidenceIds, issues);
  validateNarrative(input.narrative, issues);
  validatePages(input, objectiveIds, issues);
  if (input.downstreamUse !== "production_design_expansion") issues.push("downstream_use_invalid");

  const { candidateDigest: _digest, ...semantic } = input;
  if (!digestPattern.test(input.candidateDigest) || hashRunInput(semantic) !== input.candidateDigest) {
    issues.push("candidate_digest_invalid");
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

function validateEvidenceBindings(bindings: EvidenceBinding[], issues: string[]) {
  const evidenceIds = new Set<string>();
  if (!Array.isArray(bindings) || bindings.length === 0) {
    issues.push("evidence_bindings_missing");
    return evidenceIds;
  }
  for (const binding of bindings) {
    if (!isRecord(binding) || !binding.evidenceId?.trim() || evidenceIds.has(binding.evidenceId)) issues.push("evidence_binding_id_invalid");
    else evidenceIds.add(binding.evidenceId);
    if (!binding.sourceArtifactId?.trim() || !digestPattern.test(binding.digest ?? "")) issues.push("evidence_binding_source_invalid");
    if (!Array.isArray(binding.claims) || binding.claims.length === 0 || binding.claims.some((claim) => !claim.trim())) issues.push("evidence_binding_claims_missing");
  }
  return evidenceIds;
}

function validateObjectives(
  objectives: PptDesignCandidate["objectives"],
  evidenceIds: Set<string>,
  issues: string[],
) {
  const objectiveIds = new Set<string>();
  if (!Array.isArray(objectives) || objectives.length === 0) {
    issues.push("objectives_missing");
    return objectiveIds;
  }
  for (const objective of objectives) {
    if (!objective.objectiveId?.trim() || objectiveIds.has(objective.objectiveId)) issues.push("objective_id_invalid");
    else objectiveIds.add(objective.objectiveId);
    requireText(objective.statement, "objective_statement_missing", issues);
    if (!objective.evidenceRefs?.length || objective.evidenceRefs.some((ref) => !evidenceIds.has(ref))) issues.push("objective_evidence_invalid");
  }
  return objectiveIds;
}

function validateNarrative(narrative: PptDesignCandidate["narrative"], issues: string[]) {
  if (!isRecord(narrative)) {
    issues.push("narrative_missing");
    return;
  }
  requireText(narrative.openingTension, "narrative_incomplete", issues);
  requireText(narrative.closingResolution, "narrative_incomplete", issues);
  if (!Array.isArray(narrative.learningProgression) || narrative.learningProgression.length === 0 || narrative.learningProgression.some((step) => !step.trim())) {
    issues.push("learning_progression_missing");
  }
}

function validatePages(input: PptDesignCandidate, objectiveIds: Set<string>, issues: string[]) {
  const pages = Array.isArray(input.pagePlans) ? input.pagePlans : [];
  if (pages.length !== input.brief?.targetSlideCount) issues.push("page_count_mismatch");
  const narrativeJobs = new Set<string>();
  pages.forEach((page, index) => {
    if (page.pageNumber !== index + 1) issues.push("page_number_not_contiguous");
    const requiredText = [page.narrativeJob, page.teachingAction, page.takeawayTitle, page.primaryVisualBrief];
    if (requiredText.some((value) => typeof value !== "string" || !value.trim())) issues.push(`page_semantics_incomplete:${page.pageNumber}`);
    if (requiredText.some((value) => pageRangePattern.test(value))) issues.push(`page_range_compression_forbidden:${page.pageNumber}`);
    if (!page.objectiveIds?.length || page.objectiveIds.some((id) => !objectiveIds.has(id))) issues.push(`page_objective_invalid:${page.pageNumber}`);
    const normalizedJob = String(page.narrativeJob ?? "").replace(/\s+/g, " ").trim();
    if (normalizedJob && narrativeJobs.has(normalizedJob)) issues.push(`page_narrative_job_duplicate:${page.pageNumber}`);
    else if (normalizedJob) narrativeJobs.add(normalizedJob);
  });
}

function requireText(value: unknown, issue: string, issues: string[]) {
  if (typeof value !== "string" || !value.trim()) issues.push(issue);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
