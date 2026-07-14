export type ValidationAuthority = "deterministic";

export type ValidationOverallStatus = "passed" | "failed" | "inconclusive";

export type ValidationGateStatus = "passed" | "failed" | "inconclusive" | "warning";

export type ValidationDomain = "lesson" | "ppt" | "video" | "package" | "generic";

export type TargetLocator =
  | { kind: "artifact"; artifactKind: string; artifactId?: string }
  | { kind: "input"; artifactKind: string }
  | { kind: "tool"; toolId: string }
  | { kind: "page"; pageId: string; parentArtifactId: string }
  | { kind: "asset"; assetId: string; parentArtifactId: string; ownerUnitId?: string }
  | { kind: "shot"; shotId: string; parentArtifactId: string }
  | {
      kind: "track";
      trackId: string;
      trackType: "narration" | "caption" | "overlay" | "music" | "effects";
      parentArtifactId: string;
      timeRangeMs?: { start: number; end: number };
    }
  | { kind: "timeline"; timelineId: string; parentArtifactId: string; timeRangeMs: { start: number; end: number } }
  | {
      kind: "frame_range";
      parentArtifactId: string;
      parentShotId: string;
      timeRangeMs: { start: number; end: number };
      frameRefs: string[];
    };

export type ValidationTarget = {
  kind: "artifact" | "artifact_draft" | "tool_execution";
  targetId?: string;
  targetVersion?: number;
  targetDigest?: string;
};

export type ValidationGateResult = {
  gateId: string;
  validatorId: string;
  validatorVersion: string;
  status: ValidationGateStatus;
  evidenceRefs: string[];
  locators: TargetLocator[];
  responsibleStage: string;
  reasonCode?: string;
};

export type ValidationReport = {
  reportId: string;
  reportDigest: string;
  authority: ValidationAuthority;
  domain: ValidationDomain;
  stage: string;
  target: ValidationTarget;
  contract: {
    id: string;
    version: string;
  };
  inputHash?: string;
  intentEpoch?: number;
  overallStatus: ValidationOverallStatus;
  gates: ValidationGateResult[];
  createdAt: string;
};

export type CreateValidationReportInput = Omit<ValidationReport, "authority" | "reportDigest"> & {
  authority?: ValidationAuthority;
};

export type CriticScore = 95 | 80 | 60 | 30 | "not_scorable";

export type CriticSeverity = "blocker" | "major" | "minor";

export type QualityTarget = {
  artifactId: string;
  artifactVersion: number;
  artifactDigest: string;
  productionPath: string;
};

export type CriticDimensionResult = {
  dimensionId: string;
  score: CriticScore;
  evidenceRefs: string[];
  rationale: string;
};

export type CriticFinding = {
  findingId: string;
  severity: CriticSeverity;
  locator: TargetLocator;
  evidenceRefs: string[];
  responsibleStage: string;
  minimalFix: string;
  invalidatesDownstream: boolean;
};

export type EffectiveRubricTarget = "ppt_final" | "video_shot" | "video_final";

export type EffectiveRubric = {
  id: string;
  version: string;
  digest: string;
  target: EffectiveRubricTarget;
  domain: "ppt" | "video";
  dimensions: Array<{
    dimensionId: string;
    weight: number;
    required: boolean;
  }>;
  thresholds: {
    passTotal: number;
    repairMinTotal: number;
    passMinDimension: number;
    blockBelowDimension: number;
  };
};

export type CriticReport = {
  reportId: string;
  reportDigest: string;
  authority: "advisory_semantic";
  status: "complete" | "inconclusive";
  domain: "ppt" | "video";
  stage: string;
  target: QualityTarget;
  validationReportRefs: Array<{ reportId: string; digest: string }>;
  effectiveRubric: { id: string; version: string; digest: string };
  inputHash?: string;
  targetLocators: TargetLocator[];
  dimensions: CriticDimensionResult[];
  findings: CriticFinding[];
  recommendation: "pass" | "repair" | "block";
  createdAt: string;
};

export type CreateCriticReportInput = Omit<CriticReport, "authority" | "reportDigest">;

export type QualityDecision = {
  decisionId: string;
  decisionDigest: string;
  authority: "deterministic_policy";
  domain: "ppt" | "video";
  stage: string;
  target: QualityTarget;
  outcome: "pass" | "repair" | "block";
  weightedScore: number | null;
  reasonCodes: string[];
  nextAction: "continue_downstream" | "await_teacher_approval" | "repair_unit" | "repair_upstream" | "regenerate_evidence";
  repairTargets: TargetLocator[];
  deliveryEligibility: "not_eligible" | "preview_only" | "unit_candidate" | "final_candidate";
  validationReportDigests: string[];
  criticReportDigest: string | null;
  rubricDigest: string;
  inputHash: string | null;
  createdAt: string;
};
