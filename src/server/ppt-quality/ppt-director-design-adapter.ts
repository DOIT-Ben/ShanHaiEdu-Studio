import type { SaveArtifactDraft } from "@/server/capabilities/types";
import { validateJsonSchemaValue } from "@/server/tools/json-schema-value-validator";
import { createPptDirectorOutputSchema } from "@/server/tools/ppt-director-contract";
import { validatePptDesignPackage } from "./ppt-design-validator";
import type { EvidenceBinding, PptDesignPackage, PptPageSpec } from "./ppt-quality-types";

export type PptDirectorPlanBinding = {
  invocationId: string;
  projectId: string;
  intentEpoch: number;
  structuredOutput: Record<string, unknown>;
  approvedArtifactRefs: Array<{ artifactId: string; kind: string; version: number; digest: string }>;
};

type DirectorOutput = ReturnType<typeof asDirectorOutput>;

export function adaptPptDirectorOutputToDesignArtifact(input: {
  invocationId: string;
  structuredOutput: Record<string, unknown>;
  approvedArtifactRefs: Array<{ artifactId: string; kind: string; version: number; digest: string }>;
}): SaveArtifactDraft {
  const validation = validateJsonSchemaValue(input.structuredOutput, createPptDirectorOutputSchema());
  if (!validation.valid) {
    throw new Error(`ppt_director_contract_invalid:${validation.issues.join(",")}`);
  }
  const output = asDirectorOutput(input.structuredOutput);
  if (output.decision !== "plan" && output.decision !== "repair") {
    throw new Error(`ppt_director_not_actionable:${output.decision}`);
  }
  const boundEvidence = bindEvidenceAuthority(output, input.approvedArtifactRefs);
  if (
    !output.self_check.all_objectives_covered ||
    !output.self_check.page_numbers_continuous ||
    !output.self_check.all_assets_bound ||
    output.self_check.violations.length > 0
  ) {
    throw new Error(`ppt_director_self_check_failed:${output.self_check.violations.join(",")}`);
  }

  assertObjectiveCoverage(output);
  const designPackage = toPptDesignPackage(output, boundEvidence);
  const structural = validatePptDesignPackage(designPackage);
  if (!structural.valid) {
    throw new Error(structural.issues.map((issue) => issue.code).join(","));
  }
  return {
    nodeKey: "ppt_design_draft",
    kind: "ppt_design_draft",
    title: `${designPackage.brief.topic}逐页课件设计`,
    summary: output.summary,
    markdownContent: renderTeacherReviewMarkdown(designPackage),
    structuredContent: {
      capabilityId: "ppt_design",
      generationMode: "model_generated",
      providerStatus: "real",
      runtimeKind: "openai",
      directorInvocationId: input.invocationId,
      pptDesignPackage: designPackage,
    },
  };
}

function bindEvidenceAuthority(
  output: DirectorOutput,
  approvedArtifactRefs: Array<{ artifactId: string; kind: string; version: number; digest: string }>,
): EvidenceBinding[] {
  return output.evidence_bindings.map((binding) => {
    const matches = approvedArtifactRefs.filter((ref) => ref.kind === binding.source_artifact_kind);
    if (matches.length !== 1) throw new Error("ppt_director_evidence_binding_invalid");
    const authority = matches[0];
    if (
      !authority.artifactId.trim() ||
      !Number.isInteger(authority.version) || authority.version < 1 ||
      !/^[a-f0-9]{64}$/i.test(authority.digest)
    ) throw new Error("ppt_director_evidence_binding_invalid");
    return {
      evidenceId: binding.evidence_id,
      sourceArtifactId: authority.artifactId,
      sourceArtifactVersion: authority.version,
      sourceType: binding.source_type,
      pageRefs: binding.page_refs,
      claims: binding.claims,
      digest: authority.digest.toLowerCase(),
    };
  });
}

function toPptDesignPackage(output: DirectorOutput, boundEvidence: EvidenceBinding[]): PptDesignPackage {
  const rationaleByPage = Object.fromEntries(
    output.sample_plan.rationales.map((entry) => [entry.page_id, entry.rationale]),
  );
  return {
    schemaVersion: "ppt-design-package.v1",
    productionPath: "ppt_quality_asset_assembly",
    brief: {
      grade: output.presentation_brief.grade,
      subject: output.presentation_brief.subject,
      topic: output.presentation_brief.topic,
      audience: output.presentation_brief.audience,
      useCase: output.presentation_brief.use_case,
      targetSlideCount: output.presentation_brief.target_slide_count,
      objectiveIds: output.presentation_brief.objective_ids,
      evidenceRefs: output.presentation_brief.evidence_refs,
    },
    evidenceBindings: boundEvidence,
    objectives: output.learning_objectives.map((entry) => ({
      objectiveId: entry.objective_id,
      statement: entry.statement,
      evidenceRefs: entry.evidence_refs,
    })),
    narrative: {
      communicationJob: output.communication_job,
      openingTension: output.deck_narrative.opening_tension,
      learningProgression: output.deck_narrative.learning_progression,
      closingResolution: output.deck_narrative.closing_resolution,
      pageCount: output.deck_narrative.page_count,
    },
    visualSystem: {
      profileId: output.visual_system.profile_id,
      palette: output.visual_system.palette,
      materialLanguage: output.visual_system.material_language,
      lighting: output.visual_system.lighting,
      camera: output.visual_system.camera,
      typography: {
        titleMinPt: output.visual_system.typography.title_min_pt,
        bodyMinPt: output.visual_system.typography.body_min_pt,
        fontFamily: output.visual_system.typography.font_family,
      },
      layoutFamilies: output.visual_system.layout_families,
    },
    pageSpecs: output.page_specs.map(toPageSpec),
    samplePlan: {
      samplePageIds: output.sample_plan.sample_page_ids,
      rationaleByPage,
      requiredRiskCoverage: output.sample_plan.required_risk_coverage,
    },
  };
}

function toPageSpec(page: DirectorOutput["page_specs"][number]): PptPageSpec {
  return {
    pageId: page.page_id,
    pageNumber: page.page_number,
    objectiveIds: page.objective_ids,
    narrativeJob: page.narrative_job,
    teachingAction: page.teaching_action,
    studentAction: page.student_action,
    takeawayTitle: page.takeaway_title,
    primaryVisualType: page.primary_visual_type,
    primaryVisualBrief: page.primary_visual_brief,
    visibleTextBudget: {
      maxLines: page.visible_text_budget.max_lines,
      maxCharacters: page.visible_text_budget.max_characters,
      minFontPt: page.visible_text_budget.min_font_pt,
    },
    aiScene: {
      assetId: page.ai_scene.asset_id,
      brief: page.ai_scene.brief,
      forbiddenContentExcluded: page.ai_scene.forbidden_content_excluded,
    },
    aiAssets: page.ai_assets.map((asset) => ({
      assetId: asset.asset_id,
      role: asset.role,
      promptBrief: asset.prompt_brief,
      containsEmbeddedText: asset.contains_embedded_text,
      containsExactMath: asset.contains_exact_math,
    })),
    editableMath: page.editable_math.map((layer) => ({
      layerId: layer.layer_id,
      role: layer.role,
      exactContent: layer.exact_content,
    })),
    editableText: page.editable_text.map((layer) => ({
      layerId: layer.layer_id,
      role: layer.role,
      text: layer.text,
    })),
    layoutFamily: page.layout_family,
    layoutConstraints: page.layout_constraints,
    composition: {
      canvasWidth: 1920,
      canvasHeight: 1080,
      layers: page.composition.layers.map((layer) => ({
        layerId: layer.layer_id,
        layerKind: layer.layer_kind,
        sourceId: layer.source_id,
        x: layer.x,
        y: layer.y,
        width: layer.width,
        height: layer.height,
        zIndex: layer.z_index,
      })),
    },
    altText: page.alt_text,
    readingOrder: page.reading_order,
    nonColorCoding: page.non_color_coding,
    mediaAccessibility: {
      captionsRequired: page.media_accessibility.captions_required,
      transcriptRequired: page.media_accessibility.transcript_required,
    },
    transitionFromPrevious: page.transition_from_previous,
    presenterNote: page.presenter_note,
    acceptanceChecks: page.acceptance_checks,
    riskLevel: page.risk_level,
  };
}

function assertObjectiveCoverage(output: DirectorOutput): void {
  const pageIds = new Set(output.page_specs.map((page) => page.page_id));
  const coverage = new Map(output.learning_objective_coverage.map((entry) => [entry.objective_id, entry.page_ids]));
  for (const objective of output.learning_objectives) {
    const coveredPages = coverage.get(objective.objective_id);
    if (!coveredPages?.length || coveredPages.some((pageId) => !pageIds.has(pageId))) {
      throw new Error("ppt_director_objective_coverage_invalid");
    }
  }
}

function renderTeacherReviewMarkdown(input: PptDesignPackage): string {
  return [
    `# ${input.brief.topic}逐页课件设计`,
    "",
    "## 叙事主线",
    input.narrative.communicationJob,
    "",
    "## 逐页设计",
    ...input.pageSpecs.flatMap((page) => [
      `### ${page.pageNumber}. ${page.takeawayTitle}`,
      `- 学习推进：${page.narrativeJob}`,
      `- 教师动作：${page.teachingAction}`,
      `- 学生活动：${page.studentAction}`,
      `- 主视觉：${page.primaryVisualBrief}`,
      "",
    ]),
    "## 样张计划",
    input.samplePlan.samplePageIds.map((pageId) => `${pageId}：${input.samplePlan.rationaleByPage[pageId]}`).join("\n"),
  ].join("\n");
}

function asDirectorOutput(value: Record<string, unknown>) {
  return value as unknown as {
    decision: "plan" | "repair" | "needs_input" | "blocked";
    summary: string;
    communication_job: string;
    presentation_brief: {
      grade: string; subject: string; topic: string; audience: string;
      use_case: "public_lesson" | "competition_lesson" | "ordinary_lesson";
      target_slide_count: number; objective_ids: string[]; evidence_refs: string[];
    };
    evidence_bindings: Array<{
      evidence_id: string; source_artifact_kind: string;
      source_type: "textbook" | "curriculum_standard" | "teacher_material";
      page_refs: string[]; claims: string[];
    }>;
    learning_objectives: Array<{ objective_id: string; statement: string; evidence_refs: string[] }>;
    deck_narrative: {
      opening_tension: string; learning_progression: string[]; closing_resolution: string;
      page_count: number; page_count_rationale: string;
    };
    learning_objective_coverage: Array<{ objective_id: string; concepts: string[]; page_ids: string[] }>;
    visual_system: {
      profile_id: string; palette: string[]; material_language: string; lighting: string; camera: string;
      typography: { title_min_pt: number; body_min_pt: number; font_family: string };
      layout_families: PptDesignPackage["visualSystem"]["layoutFamilies"];
    };
    page_specs: Array<{
      page_id: string; page_number: number; objective_ids: string[]; narrative_job: string;
      teaching_action: string; student_action: string; takeaway_title: string;
      primary_visual_type: PptPageSpec["primaryVisualType"]; primary_visual_brief: string;
      visible_text_budget: { max_lines: number; max_characters: number; min_font_pt: number };
      ai_scene: { asset_id: string; brief: string; forbidden_content_excluded: PptPageSpec["aiScene"]["forbiddenContentExcluded"] };
      ai_assets: Array<{ asset_id: string; role: string; prompt_brief: string; contains_embedded_text: boolean; contains_exact_math: boolean }>;
      editable_math: Array<{ layer_id: string; role: string; exact_content: string }>;
      editable_text: Array<{ layer_id: string; role: string; text: string }>;
      layout_family: PptPageSpec["layoutFamily"]; layout_constraints: string[];
      composition: { canvas_width: 1920; canvas_height: 1080; layers: Array<{
        layer_id: string; layer_kind: PptPageSpec["composition"]["layers"][number]["layerKind"];
        source_id: string; x: number; y: number; width: number; height: number; z_index: number;
      }> };
      alt_text: string; reading_order: string[]; non_color_coding: string[];
      media_accessibility: { captions_required: boolean; transcript_required: boolean };
      transition_from_previous: string | null; presenter_note: string; acceptance_checks: string[];
      risk_level: PptPageSpec["riskLevel"];
    }>;
    sample_plan: {
      sample_page_ids: string[];
      rationales: Array<{ page_id: string; rationale: string }>;
      required_risk_coverage: PptDesignPackage["samplePlan"]["requiredRiskCoverage"];
    };
    self_check: {
      all_objectives_covered: boolean; page_numbers_continuous: boolean;
      all_assets_bound: boolean; violations: string[];
    };
  };
}
