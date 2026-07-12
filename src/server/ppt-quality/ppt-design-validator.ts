import type { TargetLocator } from "@/server/quality/quality-types";
import type { PptDesignPackage, PptDesignValidationIssue, PptPageSpec } from "./ppt-quality-types";

const REQUIRED_AI_SCENE_EXCLUSIONS = ["text", "formula", "answer", "exact_countable_objects"] as const;
const REQUIRED_SAMPLE_RISKS = ["narrative", "layout", "math", "visual"] as const;
const PAGE_RANGE_PATTERN = /第\s*\d+\s*(?:-|—|–|~|～|至|到)\s*\d+\s*页/i;
const GENERIC_FIXTURE_PATTERN = /^(?:推进第\s*\d+\s*个独立学习动作|这一页要解决的问题\s*\d+|干净课堂场景，只提供空间、材质和注意焦点。|使用一个大主视觉解释当前数量关系，中心教学区保持干净并为可编辑层留出空间。|教师提出一个可观察问题并控制揭示顺序|学生观察、比较并用自己的语言解释)$/;

export type PptDesignValidationResult = {
  valid: boolean;
  issues: PptDesignValidationIssue[];
};

export function validatePptDesignPackage(input: PptDesignPackage): PptDesignValidationResult {
  const issues: PptDesignValidationIssue[] = [];
  const pageSpecs = Array.isArray(input.pageSpecs) ? input.pageSpecs : [];
  const evidenceIds = new Set(input.evidenceBindings.map((item) => item.evidenceId));
  const objectiveIds = new Set(input.objectives.map((item) => item.objectiveId));
  const pagesById = new Map<string, PptPageSpec>();

  if (input.schemaVersion !== "ppt-design-package.v1") {
    issues.push(issue("schema_version_invalid", "PPT design package schema version is not supported.", artifactLocator(), "ppt_page_design"));
  }
  if (input.productionPath !== "ppt_quality_asset_assembly") {
    issues.push(issue("production_path_invalid", "Quality package must use the quality asset assembly path.", artifactLocator(), "ppt_page_design"));
  }
  if (!input.evidenceBindings.length || input.brief.evidenceRefs.some((ref) => !evidenceIds.has(ref))) {
    issues.push(issue("evidence_binding_incomplete", "Approved evidence bindings are missing or unresolved.", { kind: "input", artifactKind: "textbook_evidence" }, "ppt_evidence"));
  }
  for (const objective of input.objectives) {
    if (!objective.evidenceRefs.length || objective.evidenceRefs.some((ref) => !evidenceIds.has(ref))) {
      issues.push(issue("objective_evidence_missing", `Objective ${objective.objectiveId} is not bound to evidence.`, artifactLocator(), "ppt_evidence"));
    }
  }

  if (input.brief.targetSlideCount !== pageSpecs.length) {
    issues.push(issue("target_slide_count_mismatch", "Target slide count does not match PageSpec count.", artifactLocator(), "ppt_page_design"));
  }
  if (input.narrative.pageCount !== pageSpecs.length) {
    issues.push(issue("narrative_page_count_mismatch", "Narrative page count does not match PageSpec count.", artifactLocator(), "ppt_narrative_outline"));
  }

  pageSpecs.forEach((page, index) => {
    const locator = pageLocator(page.pageId);
    if (pagesById.has(page.pageId)) {
      issues.push(issue("duplicate_page_id", `Duplicate pageId ${page.pageId}.`, locator, "ppt_page_design"));
    } else {
      pagesById.set(page.pageId, page);
    }
    if (page.pageNumber !== index + 1 || page.pageId !== `page_${String(page.pageNumber).padStart(2, "0")}`) {
      issues.push(issue("page_number_not_contiguous", `Page ${page.pageId} is not in the expected continuous order.`, locator, "ppt_page_design"));
    }
    if ([page.narrativeJob, page.teachingAction, page.studentAction, page.takeawayTitle, page.primaryVisualBrief].some((value) => PAGE_RANGE_PATTERN.test(value))) {
      issues.push(issue("page_range_compression_forbidden", "Each PageSpec must describe one page, not a page range.", locator, "ppt_page_design"));
    }
    requireText(page.teachingAction, "teaching_action_missing", "Teaching action is required.", locator, issues);
    requireText(page.studentAction, "student_action_missing", "Student action is required.", locator, issues);
    requireText(page.presenterNote, "presenter_note_missing", "Presenter note is required.", locator, issues);
    if (!page.acceptanceChecks.length) {
      issues.push(issue("acceptance_checks_missing", "Page acceptance checks are required.", locator, "ppt_page_design"));
    }
    if (
      !Array.isArray(page.layoutConstraints) || !page.layoutConstraints.length ||
      typeof page.altText !== "string" || !page.altText.trim() ||
      !Array.isArray(page.readingOrder) || !page.readingOrder.length ||
      !Array.isArray(page.nonColorCoding) || !page.nonColorCoding.length ||
      typeof page.mediaAccessibility?.captionsRequired !== "boolean" ||
      typeof page.mediaAccessibility?.transcriptRequired !== "boolean"
    ) {
      issues.push(issue("page_layout_accessibility_incomplete", "Layout constraints, alt text, reading order, non-color coding, and media accessibility are required.", locator, "ppt_page_design"));
    }
    if (page.objectiveIds.some((objectiveId) => !objectiveIds.has(objectiveId))) {
      issues.push(issue("page_objective_unknown", "Page references an unknown objective.", locator, "ppt_narrative_outline"));
    }
    if (!input.visualSystem.layoutFamilies.includes(page.layoutFamily)) {
      issues.push(issue("layout_family_not_in_visual_system", "Page layout family is not registered in the visual system.", locator, "ppt_visual_system"));
    }
    validateComposition(page, issues);
    if (REQUIRED_AI_SCENE_EXCLUSIONS.some((required) => !page.aiScene.forbiddenContentExcluded.includes(required))) {
      issues.push(issue("ai_scene_forbidden_content_policy_incomplete", "AI scene must exclude text, formulas, answers, and exact countable objects.", locator, "ppt_page_design"));
    }
    for (const asset of page.aiAssets) {
      const assetLocator: TargetLocator = { kind: "asset", assetId: asset.assetId, parentArtifactId: "ppt_design_package", ownerUnitId: page.pageId };
      if (asset.containsEmbeddedText) {
        issues.push(issue("ai_asset_embeds_text", "AI assets cannot embed student-visible text.", assetLocator, "ppt_page_design"));
      }
      if (asset.containsExactMath) {
        issues.push(issue("ai_asset_embeds_exact_math", "Exact math must be represented in editable layers.", assetLocator, "ppt_page_design"));
      }
    }
  });

  for (const objective of input.objectives) {
    if (!pageSpecs.some((page) => page.objectiveIds.includes(objective.objectiveId))) {
      issues.push(issue("objective_not_covered", `Objective ${objective.objectiveId} is not covered by any page.`, artifactLocator(), "ppt_narrative_outline"));
    }
  }

  validateSamplePlan(input, pagesById, issues);
  return { valid: issues.length === 0, issues };
}

/**
 * The structural contract accepts fixtures so lower-level composer tests stay isolated.
 * Provider spend uses this additional gate to reject the known generic test-design shape.
 */
export function validatePptDesignPackageForProviderProduction(input: PptDesignPackage): PptDesignValidationResult {
  const base = validatePptDesignPackage(input);
  const issues = [...base.issues];
  const jobs = new Map<string, string>();

  for (const page of input.pageSpecs ?? []) {
    const locator = pageLocator(page.pageId);
    const requiredPageFields = [
      page.narrativeJob,
      page.takeawayTitle,
      page.primaryVisualBrief,
      page.teachingAction,
      page.studentAction,
    ];
    if (requiredPageFields.some((value) => GENERIC_FIXTURE_PATTERN.test(value.trim()))) {
      issues.push(issue(
        "ppt_page_generic_placeholder",
        "Provider production requires a page-local teaching action, visual event, and audience-facing title rather than a generic placeholder PageSpec.",
        locator,
        "ppt_page_design",
      ));
    }

    const normalizedJob = page.narrativeJob.replace(/\s+/g, " ").trim();
    const previousPageId = jobs.get(normalizedJob);
    if (normalizedJob && previousPageId) {
      issues.push(issue(
        "ppt_page_teaching_job_duplicate",
        `Page teaching job duplicates ${previousPageId}; each page must advance a distinct learning action.`,
        locator,
        "ppt_narrative_outline",
      ));
    } else if (normalizedJob) {
      jobs.set(normalizedJob, page.pageId);
    }
  }

  return { valid: issues.length === 0, issues };
}

function validateComposition(page: PptPageSpec, issues: PptDesignValidationIssue[]): void {
  const locator = pageLocator(page.pageId);
  const composition = page.composition;
  if (!composition || composition.canvasWidth !== 1920 || composition.canvasHeight !== 1080 || !Array.isArray(composition.layers)) {
    issues.push(issue("page_composition_invalid", "Page composition must use a 1920x1080 canvas and explicit layers.", locator, "ppt_page_design"));
    return;
  }
  const requiredSources = [
    page.aiScene.assetId,
    ...page.aiAssets.map((asset) => asset.assetId),
    ...page.editableText.map((layer) => layer.layerId),
    ...page.editableMath.map((layer) => layer.layerId),
  ];
  const expectedKindBySource = new Map<string, PptPageSpec["composition"]["layers"][number]["layerKind"]>([
    [page.aiScene.assetId, "AI_SCENE"],
    ...page.aiAssets.map((asset) => [asset.assetId, "AI_ASSET"] as const),
    ...page.editableText.map((layer) => [layer.layerId, "EDITABLE_TEXT"] as const),
    ...page.editableMath.map((layer) => [layer.layerId, "EDITABLE_MATH"] as const),
  ]);
  const seenLayerIds = new Set<string>();
  for (const layer of composition.layers) {
    if (seenLayerIds.has(layer.layerId)) issues.push(issue("composition_layer_id_duplicate", "Composition layer IDs must be unique.", locator, "ppt_page_design"));
    seenLayerIds.add(layer.layerId);
    if (expectedKindBySource.get(layer.sourceId) !== layer.layerKind) issues.push(issue("composition_layer_source_invalid", "Composition layer source or kind is not declared by the PageSpec.", locator, "ppt_page_design"));
    if (layer.x < 0 || layer.y < 0 || layer.width <= 0 || layer.height <= 0 || layer.x + layer.width > 1920 || layer.y + layer.height > 1080 || !Number.isInteger(layer.zIndex)) {
      issues.push(issue("composition_layer_out_of_bounds", "Composition layers must have positive in-bounds geometry and an integer zIndex.", locator, "ppt_page_design"));
    }
  }
  const actualSources = new Set(composition.layers.map((layer) => layer.sourceId));
  if (requiredSources.some((sourceId) => !actualSources.has(sourceId))) {
    issues.push(issue("composition_required_layer_missing", "Every scene, asset, editable text, and editable math source needs a placement.", locator, "ppt_page_design"));
  }
}

function validateSamplePlan(
  input: PptDesignPackage,
  pagesById: Map<string, PptPageSpec>,
  issues: PptDesignValidationIssue[],
) {
  const sampleIds = [...new Set(input.samplePlan.samplePageIds)];
  const samplePages = sampleIds.map((id) => pagesById.get(id)).filter((page): page is PptPageSpec => Boolean(page));
  if (sampleIds.length < 3 || sampleIds.length > 4 || samplePages.length !== sampleIds.length) {
    issues.push(issue("sample_page_count_invalid", "Sample plan must reference 3-4 existing pages.", artifactLocator(), "ppt_sample_plan"));
  }
  if (new Set(samplePages.map((page) => page.layoutFamily)).size < 2) {
    issues.push(issue("sample_layout_coverage_insufficient", "Sample plan must cover at least two layout families.", artifactLocator(), "ppt_sample_plan"));
  }
  if (!samplePages.some((page) => page.riskLevel === "high")) {
    issues.push(issue("sample_high_risk_page_missing", "Sample plan must include at least one high-risk page.", artifactLocator(), "ppt_sample_plan"));
  }
  if (REQUIRED_SAMPLE_RISKS.some((risk) => !input.samplePlan.requiredRiskCoverage.includes(risk))) {
    issues.push(issue("sample_risk_coverage_incomplete", "Sample plan must cover narrative, layout, math, and visual risks.", artifactLocator(), "ppt_sample_plan"));
  }
  if (sampleIds.some((pageId) => !input.samplePlan.rationaleByPage[pageId]?.trim())) {
    issues.push(issue("sample_rationale_missing", "Every sample page needs a selection rationale.", artifactLocator(), "ppt_sample_plan"));
  }
}

function requireText(
  value: string,
  code: string,
  message: string,
  locator: TargetLocator,
  issues: PptDesignValidationIssue[],
) {
  if (!value.trim()) issues.push(issue(code, message, locator, "ppt_page_design"));
}

function issue(
  code: string,
  message: string,
  locator: TargetLocator,
  responsibleStage: PptDesignValidationIssue["responsibleStage"],
): PptDesignValidationIssue {
  return { code, message, locator, responsibleStage };
}

function pageLocator(pageId: string): TargetLocator {
  return { kind: "page", pageId, parentArtifactId: "ppt_design_package" };
}

function artifactLocator(): TargetLocator {
  return { kind: "artifact", artifactKind: "ppt_design_draft" };
}
