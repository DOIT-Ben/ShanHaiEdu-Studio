import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { EvidenceBinding } from "./ppt-quality-types";
import { omitObjectKeys } from "@/server/contracts/object-projection";

export type PptDesignCandidatePagePlan = {
  pageNumber: number;
  objectiveIds: string[];
  narrativeJob: string;
  teachingAction: string;
  takeawayTitle: string;
  primaryVisualBrief: string;
};

export type PptDesignCandidateSemanticEvidence = {
  evidenceId: string;
  pageRefs: string[];
  claims: string[];
};

export type PptDesignSemanticCandidate = {
  schemaVersion: "ppt-design-semantic-candidate.v1";
  goalSummary: string;
  brief: {
    grade: string;
    subject: string;
    topic: string;
    audience: string;
    useCase: "public_lesson" | "competition_lesson" | "ordinary_lesson";
    targetSlideCount: number;
  };
  evidenceBindings: PptDesignCandidateSemanticEvidence[];
  objectives: Array<{ objectiveId: string; statement: string; evidenceRefs: string[] }>;
  narrative: {
    openingTension: string;
    learningProgression: string[];
    closingResolution: string;
  };
  pagePlans: PptDesignCandidatePagePlan[];
  downstreamUse: "production_design_expansion";
};

export type PptDesignCandidateV1Input = {
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

export type PptDesignCandidateInput = PptDesignCandidateV1Input;

export type PptDesignCandidateEvidenceBindingV2 = EvidenceBinding & {
  sourceArtifactVersion: number;
};

export type PptDesignCandidateV2Input = Omit<
  PptDesignCandidateV1Input,
  "schemaVersion" | "evidenceBindings"
> & {
  schemaVersion: "ppt-design-candidate.v2";
  evidenceBindings: PptDesignCandidateEvidenceBindingV2[];
};

export type PptDesignCandidate = (PptDesignCandidateV1Input | PptDesignCandidateV2Input) & {
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

export function projectAuthoritativePptDesignCandidate(input: {
  semanticCandidate: unknown;
  taskBriefDigest: string;
  sourceArtifact: {
    artifactId: string;
    version: number;
    digest: string;
    sourceType: EvidenceBinding["sourceType"];
  };
}): { candidate: PptDesignCandidate } {
  const semantic = normalizePptDesignSemanticCandidate(input.semanticCandidate);
  if (!digestPattern.test(input.taskBriefDigest)) {
    throw new Error("ppt_design_task_binding_missing");
  }
  if (
    !input.sourceArtifact.artifactId.trim() ||
    !Number.isInteger(input.sourceArtifact.version) ||
    input.sourceArtifact.version < 1 ||
    !digestPattern.test(input.sourceArtifact.digest)
  ) {
    throw new Error("ppt_design_evidence_binding_missing");
  }
  const candidateInput: PptDesignCandidateV2Input = {
    ...semantic,
    schemaVersion: "ppt-design-candidate.v2",
    taskBriefDigest: input.taskBriefDigest,
    evidenceBindings: semantic.evidenceBindings.map((binding) => ({
      ...binding,
      sourceArtifactId: input.sourceArtifact.artifactId,
      sourceArtifactVersion: input.sourceArtifact.version,
      sourceType: input.sourceArtifact.sourceType,
      digest: input.sourceArtifact.digest,
    })),
  };
  const candidate: PptDesignCandidate = {
    ...candidateInput,
    candidateDigest: hashRunInput(candidateInput),
  };
  const validation = validatePptDesignCandidate(candidate);
  if (!validation.valid) {
    throw new Error(`ppt_design_candidate_invalid:${validation.issues.join(",")}`);
  }
  return { candidate };
}

export function normalizePptDesignSemanticCandidate(input: unknown): PptDesignSemanticCandidate {
  if (!isRecord(input)) throw new Error("ppt_design_candidate_semantics_invalid");
  if (!["ppt-design-semantic-candidate.v1", "ppt-design-candidate.v1", "ppt-design-candidate.v2"].includes(String(input.schemaVersion ?? ""))) {
    throw new Error("ppt_design_candidate_semantics_invalid:schema_version_invalid");
  }
  const bindings = Array.isArray(input.evidenceBindings)
    ? input.evidenceBindings.map((binding) => {
        if (!isRecord(binding)) return binding;
        return {
          evidenceId: binding.evidenceId,
          pageRefs: binding.pageRefs,
          claims: binding.claims,
        };
      })
    : input.evidenceBindings;
  const semantic = {
    schemaVersion: "ppt-design-semantic-candidate.v1" as const,
    goalSummary: input.goalSummary,
    brief: input.brief,
    evidenceBindings: bindings,
    objectives: input.objectives,
    narrative: input.narrative,
    pagePlans: input.pagePlans,
    downstreamUse: input.downstreamUse,
  } as unknown as PptDesignSemanticCandidate;
  const validation = validatePptDesignSemanticCandidate(semantic);
  if (!validation.valid) {
    throw new Error(`ppt_design_candidate_semantics_invalid:${validation.issues.join(",")}`);
  }
  return structuredClone(semantic);
}

export function validatePptDesignSemanticCandidate(input: PptDesignSemanticCandidate): PptDesignCandidateValidation {
  const issues: string[] = [];
  if (!isRecord(input) || input.schemaVersion !== "ppt-design-semantic-candidate.v1") {
    return { valid: false, issues: ["schema_version_invalid"] };
  }
  validateCandidateSemantics(input, issues);
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

export function validatePptDesignCandidate(input: PptDesignCandidate): PptDesignCandidateValidation {
  const issues: string[] = [];
  if (!isRecord(input) || (input.schemaVersion !== "ppt-design-candidate.v1" && input.schemaVersion !== "ppt-design-candidate.v2")) {
    return { valid: false, issues: ["schema_version_invalid"] };
  }
  if (!digestPattern.test(input.taskBriefDigest)) issues.push("task_brief_digest_invalid");
  validateCandidateSemantics(input, issues);
  if (input.schemaVersion === "ppt-design-candidate.v2" && input.evidenceBindings.some((binding) =>
    !Number.isInteger(binding.sourceArtifactVersion) || binding.sourceArtifactVersion < 1)) {
    issues.push("evidence_binding_version_invalid");
  }

  const semantic = omitObjectKeys(input, ["candidateDigest"]);
  if (!digestPattern.test(input.candidateDigest) || hashRunInput(semantic) !== input.candidateDigest) {
    issues.push("candidate_digest_invalid");
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

function validateCandidateSemantics(
  input: PptDesignSemanticCandidate | PptDesignCandidate,
  issues: string[],
) {
  requireText(input.goalSummary, "goal_summary_missing", issues);
  if (!isRecord(input.brief)) issues.push("brief_missing");
  if (!Number.isInteger(input.brief?.targetSlideCount) || input.brief.targetSlideCount < 1 || input.brief.targetSlideCount > 60) {
    issues.push("target_slide_count_invalid");
  }
  for (const value of [input.brief?.grade, input.brief?.subject, input.brief?.topic, input.brief?.audience]) {
    requireText(value, "brief_semantics_incomplete", issues);
  }
  const evidenceIds = "taskBriefDigest" in input
    ? validateEvidenceBindings(input.evidenceBindings, issues)
    : validateSemanticEvidenceBindings(input.evidenceBindings, issues);
  const objectiveIds = validateObjectives(input.objectives, evidenceIds, issues);
  validateNarrative(input.narrative, issues);
  validatePages(input, objectiveIds, issues);
  if (input.downstreamUse !== "production_design_expansion") issues.push("downstream_use_invalid");
}

function validateSemanticEvidenceBindings(
  bindings: PptDesignCandidateSemanticEvidence[],
  issues: string[],
) {
  const evidenceIds = new Set<string>();
  if (!Array.isArray(bindings) || bindings.length === 0) {
    issues.push("evidence_bindings_missing");
    return evidenceIds;
  }
  for (const binding of bindings) {
    if (!isRecord(binding) || typeof binding.evidenceId !== "string" || !binding.evidenceId.trim() || evidenceIds.has(binding.evidenceId)) {
      issues.push("evidence_binding_id_invalid");
    } else {
      evidenceIds.add(binding.evidenceId);
    }
    if (!Array.isArray(binding.pageRefs) || binding.pageRefs.length === 0 || binding.pageRefs.some((ref) => typeof ref !== "string" || !ref.trim())) {
      issues.push("evidence_binding_page_refs_invalid");
    }
    if (!Array.isArray(binding.claims) || binding.claims.length === 0 || binding.claims.some((claim) => typeof claim !== "string" || !claim.trim())) {
      issues.push("evidence_binding_claims_missing");
    }
  }
  return evidenceIds;
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

function validatePages(input: PptDesignSemanticCandidate | PptDesignCandidate, objectiveIds: Set<string>, issues: string[]) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
