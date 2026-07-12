import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type {
  CreateCriticReportInput,
  CriticDimensionResult,
  CriticFinding,
  CriticReport,
  EffectiveRubric,
  EffectiveRubricTarget,
  TargetLocator,
} from "./quality-types";

const SCORE_VALUES = new Set<unknown>([95, 80, 60, 30, "not_scorable"]);
const VALIDATOR_ONLY_FIELDS = new Set([
  "artifactTruth",
  "validationStatus",
  "validationGates",
  "lineageStatus",
  "fileHash",
  "slideCount",
  "providerRequestEvidence",
  "approved",
]);

const rubricDefinitions: Record<EffectiveRubricTarget, Omit<EffectiveRubric, "digest">> = {
  ppt_final: {
    id: "ppt.final.v1",
    version: "1.0.0",
    target: "ppt_final",
    domain: "ppt",
    dimensions: [
      { dimensionId: "ppt.accuracy", weight: 20, required: true },
      { dimensionId: "ppt.learning_narrative", weight: 15, required: true },
      { dimensionId: "ppt.page_teaching_action", weight: 15, required: true },
      { dimensionId: "ppt.visual_explanation", weight: 15, required: true },
      { dimensionId: "ppt.readability_accessibility", weight: 15, required: true },
      { dimensionId: "ppt.layout_rhythm_consistency", weight: 10, required: true },
      { dimensionId: "ppt.editability_asset_truth", weight: 10, required: true },
    ],
    thresholds: { passTotal: 85, repairMinTotal: 75, passMinDimension: 70, blockBelowDimension: 50 },
  },
  video_shot: {
    id: "video.shot.v1",
    version: "1.0.0",
    target: "video_shot",
    domain: "video",
    dimensions: [
      { dimensionId: "video.shot_intent", weight: 20, required: true },
      { dimensionId: "video.motion_and_composition", weight: 20, required: true },
      { dimensionId: "video.continuity", weight: 20, required: true },
      { dimensionId: "video.readability", weight: 15, required: true },
      { dimensionId: "video.audio_caption", weight: 15, required: true },
      { dimensionId: "video.safety", weight: 10, required: true },
    ],
    thresholds: { passTotal: 80, repairMinTotal: 70, passMinDimension: 65, blockBelowDimension: 50 },
  },
  video_final: {
    id: "video.final.v1",
    version: "1.0.0",
    target: "video_final",
    domain: "video",
    dimensions: [
      { dimensionId: "video.accuracy_boundary", weight: 20, required: true },
      { dimensionId: "video.creative_hook", weight: 15, required: true },
      { dimensionId: "video.narrative_motion", weight: 15, required: true },
      { dimensionId: "video.continuity", weight: 15, required: true },
      { dimensionId: "video.readability_caption", weight: 10, required: true },
      { dimensionId: "video.voice_music_sound", weight: 10, required: true },
      { dimensionId: "video.technical_composition", weight: 10, required: true },
      { dimensionId: "video.course_anchor", weight: 5, required: true },
    ],
    thresholds: { passTotal: 85, repairMinTotal: 75, passMinDimension: 70, blockBelowDimension: 50 },
  },
};

export function resolveEffectiveRubric(target: EffectiveRubricTarget): EffectiveRubric {
  const definition = structuredClone(rubricDefinitions[target]);
  if (!definition) throw new Error(`Unknown quality rubric target: ${target}`);
  return { ...definition, digest: hashRunInput(definition) };
}

export function createCriticReport(input: CreateCriticReportInput): CriticReport {
  assertNoValidatorOnlyFields(input);
  assertCriticInput(input);
  const normalized = normalizeCriticInput(input);
  const semanticPayload = {
    authority: "advisory_semantic" as const,
    status: normalized.status,
    domain: normalized.domain,
    stage: normalized.stage,
    target: normalized.target,
    validationReportRefs: normalized.validationReportRefs,
    effectiveRubric: normalized.effectiveRubric,
    inputHash: normalized.inputHash,
    targetLocators: normalized.targetLocators,
    dimensions: normalized.dimensions,
    findings: normalized.findings,
    recommendation: normalized.recommendation,
  };
  return {
    ...normalized,
    authority: "advisory_semantic",
    reportDigest: hashRunInput(semanticPayload),
  };
}

export function hasValidCriticReportDigest(report: CriticReport): boolean {
  const { authority: _authority, reportDigest, ...input } = report;
  return createCriticReport(input).reportDigest === reportDigest;
}

export function parseCriticReportPayload(value: unknown): CriticReport {
  assertNoValidatorOnlyFields(value);
  if (!isRecord(value)) throw new Error("Critic payload must be an object.");
  const allowed = new Set([
    "reportId", "createdAt", "status", "domain", "stage", "target", "validationReportRefs",
    "effectiveRubric", "inputHash", "targetLocators", "dimensions", "findings", "recommendation",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Unknown Critic payload field: ${key}`);
  }
  return createCriticReport(value as CreateCriticReportInput);
}

function normalizeCriticInput(input: CreateCriticReportInput): CreateCriticReportInput {
  return {
    ...structuredClone(input),
    validationReportRefs: [...input.validationReportRefs].sort((a, b) => `${a.reportId}:${a.digest}`.localeCompare(`${b.reportId}:${b.digest}`)),
    targetLocators: [...input.targetLocators].sort(compareLocator),
    dimensions: [...input.dimensions].sort((a, b) => a.dimensionId.localeCompare(b.dimensionId)),
    findings: [...input.findings].sort((a, b) => a.findingId.localeCompare(b.findingId)),
  };
}

function assertCriticInput(input: CreateCriticReportInput) {
  if (!input.reportId?.trim() || !input.stage?.trim()) throw new Error("Critic report identity and stage are required.");
  if (!Number.isInteger(input.target.artifactVersion) || input.target.artifactVersion < 1) throw new Error("Critic target version is invalid.");
  if (!input.target.artifactId?.trim() || !input.target.artifactDigest?.trim() || !input.target.productionPath?.trim()) throw new Error("Critic target is incomplete.");
  if (!input.effectiveRubric.id?.trim() || !input.effectiveRubric.version?.trim() || !input.effectiveRubric.digest?.trim()) throw new Error("Effective rubric ref is incomplete.");
  for (const dimension of input.dimensions) assertDimension(dimension);
  for (const finding of input.findings) assertFinding(finding);
  for (const locator of input.targetLocators) assertLocator(locator);
}

function assertDimension(dimension: CriticDimensionResult) {
  if (!dimension.dimensionId?.trim() || !SCORE_VALUES.has(dimension.score)) throw new Error("Critic dimension is invalid.");
  if (!dimension.rationale?.trim()) throw new Error("Critic dimension rationale is required.");
  if (dimension.score !== "not_scorable" && dimension.evidenceRefs.length === 0) throw new Error("Scored Critic dimension requires evidence.");
}

function assertFinding(finding: CriticFinding) {
  if (!finding.findingId?.trim() || !finding.responsibleStage?.trim() || !finding.minimalFix?.trim()) throw new Error("Critic finding is incomplete.");
  if (!['blocker', 'major', 'minor'].includes(finding.severity)) throw new Error("Critic finding severity is invalid.");
  if (finding.evidenceRefs.length === 0) throw new Error("Critic finding requires evidence.");
  assertLocator(finding.locator);
}

function assertLocator(locator: TargetLocator) {
  if (!isRecord(locator) || typeof locator.kind !== "string") throw new Error("Target locator is invalid.");
  if ("timeRangeMs" in locator && locator.timeRangeMs) {
    const range = locator.timeRangeMs;
    if (!isRecord(range) || !Number.isFinite(range.start) || !Number.isFinite(range.end) || Number(range.start) < 0 || Number(range.end) <= Number(range.start)) {
      throw new Error("Target locator time range is invalid.");
    }
  }
  if (locator.kind === "frame_range" && locator.frameRefs.length === 0) throw new Error("Frame range locator requires frame evidence.");
}

function assertNoValidatorOnlyFields(value: unknown, path = "critic") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoValidatorOnlyFields(entry, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (VALIDATOR_ONLY_FIELDS.has(key)) throw new Error(`Critic cannot write validator-only field: ${path}.${key}`);
    assertNoValidatorOnlyFields(entry, `${path}.${key}`);
  }
}

function compareLocator(a: TargetLocator, b: TargetLocator) {
  return hashRunInput(a).localeCompare(hashRunInput(b));
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
