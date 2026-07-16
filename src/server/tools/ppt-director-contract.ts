import type { JsonSchemaObject } from "./tool-types";

type JsonSchema = Record<string, unknown>;

const text = (minLength = 1): JsonSchema => ({ type: "string", minLength });
const textArray = (minItems = 0): JsonSchema => ({
  type: "array",
  minItems,
  items: text(),
});

export function createPptDirectorOutputSchema(): JsonSchemaObject {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      decision: { type: "string", enum: ["plan", "repair", "needs_input", "blocked"] },
      summary: text(),
      targetLocators: textArray(),
      nextToolIntents: textArray(),
      assumptions: textArray(),
      stopConditions: textArray(),
      communication_job: text(20),
      presentation_brief: presentationBriefSchema(),
      evidence_bindings: { type: "array", minItems: 1, items: evidenceBindingSchema() },
      learning_objectives: { type: "array", minItems: 1, items: learningObjectiveSchema() },
      deck_narrative: deckNarrativeSchema(),
      learning_objective_coverage: { type: "array", minItems: 1, items: objectiveCoverageSchema() },
      visual_system: visualSystemSchema(),
      page_specs: { type: "array", minItems: 1, items: pageSpecSchema() },
      asset_requests: { type: "array", items: assetRequestSchema() },
      sample_plan: samplePlanSchema(),
      self_check: selfCheckSchema(),
    },
    required: [
      "decision",
      "summary",
      "targetLocators",
      "nextToolIntents",
      "assumptions",
      "stopConditions",
      "communication_job",
      "presentation_brief",
      "evidence_bindings",
      "learning_objectives",
      "deck_narrative",
      "learning_objective_coverage",
      "visual_system",
      "page_specs",
      "asset_requests",
      "sample_plan",
      "self_check",
    ],
  };
}

function presentationBriefSchema(): JsonSchema {
  return objectSchema({
    grade: text(),
    subject: text(),
    topic: text(),
    audience: text(),
    use_case: { type: "string", enum: ["public_lesson", "competition_lesson", "ordinary_lesson"] },
    target_slide_count: { type: "integer", minimum: 1, maximum: 60 },
    objective_ids: textArray(1),
    evidence_refs: textArray(1),
  });
}

function evidenceBindingSchema(): JsonSchema {
  return objectSchema({
    evidence_id: text(),
    source_artifact_kind: text(),
    source_type: { type: "string", enum: ["textbook", "curriculum_standard", "teacher_material"] },
    page_refs: textArray(),
    claims: textArray(1),
  });
}

function learningObjectiveSchema(): JsonSchema {
  return objectSchema({
    objective_id: text(),
    statement: text(),
    evidence_refs: textArray(1),
  });
}

function deckNarrativeSchema(): JsonSchema {
  return objectSchema({
    opening_tension: text(5),
    learning_progression: textArray(2),
    closing_resolution: text(5),
    page_count: { type: "integer", minimum: 1, maximum: 60 },
    page_count_rationale: text(5),
  });
}

function objectiveCoverageSchema(): JsonSchema {
  return objectSchema({
    objective_id: text(),
    concepts: textArray(1),
    page_ids: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", pattern: "^page_[0-9]{2,3}$" },
    },
  });
}

function visualSystemSchema(): JsonSchema {
  return objectSchema({
    profile_id: text(),
    palette: textArray(2),
    material_language: text(),
    lighting: text(),
    camera: text(),
    typography: objectSchema({
      title_min_pt: { type: "number", minimum: 18 },
      body_min_pt: { type: "number", minimum: 18 },
      font_family: text(),
    }),
    layout_families: {
      type: "array",
      minItems: 2,
      uniqueItems: true,
      items: layoutFamilySchema(),
    },
  });
}

function pageSpecSchema(): JsonSchema {
  return objectSchema({
    page_id: { type: "string", pattern: "^page_[0-9]{2,3}$" },
    page_number: { type: "integer", minimum: 1, maximum: 60 },
    objective_ids: textArray(1),
    narrative_job: text(5),
    teaching_action: text(5),
    student_action: text(5),
    takeaway_title: { type: "string", minLength: 2, maxLength: 40 },
    primary_visual_type: {
      type: "string",
      enum: ["immersive_scene", "focused_observation", "process", "comparison", "operation", "relationship", "student_work", "summary"],
    },
    primary_visual_brief: text(20),
    visible_text_budget: objectSchema({
      max_lines: { type: "integer", minimum: 1, maximum: 8 },
      max_characters: { type: "integer", minimum: 1, maximum: 180 },
      min_font_pt: { type: "number", minimum: 18 },
    }),
    ai_scene: objectSchema({
      asset_id: text(),
      brief: text(20),
      forbidden_content_excluded: {
        type: "array",
        minItems: 4,
        uniqueItems: true,
        items: { type: "string", enum: ["text", "formula", "answer", "exact_countable_objects"] },
      },
    }),
    ai_assets: {
      type: "array",
      items: objectSchema({
        asset_id: text(),
        role: text(),
        prompt_brief: text(),
        contains_embedded_text: { type: "boolean", const: false },
        contains_exact_math: { type: "boolean", const: false },
      }),
    },
    editable_math: {
      type: "array",
      items: objectSchema({ layer_id: text(), role: text(), exact_content: text() }),
    },
    editable_text: {
      type: "array",
      minItems: 1,
      items: objectSchema({ layer_id: text(), role: text(), text: text() }),
    },
    layout_family: layoutFamilySchema(),
    layout_constraints: textArray(1),
    composition: compositionSchema(),
    alt_text: text(5),
    reading_order: textArray(1),
    non_color_coding: textArray(1),
    media_accessibility: objectSchema({
      captions_required: { type: "boolean" },
      transcript_required: { type: "boolean" },
    }),
    transition_from_previous: { type: ["string", "null"] },
    presenter_note: text(5),
    acceptance_checks: textArray(1),
    risk_level: { type: "string", enum: ["low", "medium", "high"] },
  });
}

function compositionSchema(): JsonSchema {
  return objectSchema({
    canvas_width: { type: "integer", const: 1920 },
    canvas_height: { type: "integer", const: 1080 },
    layers: {
      type: "array",
      minItems: 2,
      items: objectSchema({
        layer_id: text(),
        layer_kind: { type: "string", enum: ["AI_SCENE", "AI_ASSET", "EDITABLE_TEXT", "EDITABLE_MATH"] },
        source_id: text(),
        x: { type: "number", minimum: 0, maximum: 1920 },
        y: { type: "number", minimum: 0, maximum: 1080 },
        width: { type: "number", exclusiveMinimum: 0, maximum: 1920 },
        height: { type: "number", exclusiveMinimum: 0, maximum: 1080 },
        z_index: { type: "integer" },
      }),
    },
  });
}

function assetRequestSchema(): JsonSchema {
  return objectSchema({
    asset_id: text(),
    page_ids: textArray(1),
    asset_role: text(3),
    generation_mode: { type: "string", enum: ["generate", "reconstruct", "local_deterministic", "reuse_approved"] },
    aspect_ratio: text(3),
    composition_safe_zone: text(3),
    prompt: { type: "string" },
    negative_prompt: { type: "string" },
    local_overlay_requirements: textArray(),
    reuse_policy: text(3),
  });
}

function samplePlanSchema(): JsonSchema {
  return objectSchema({
    sample_page_ids: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      uniqueItems: true,
      items: { type: "string", pattern: "^page_[0-9]{2,3}$" },
    },
    rationales: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      items: objectSchema({ page_id: text(), rationale: text(5) }),
    },
    required_risk_coverage: {
      type: "array",
      minItems: 4,
      uniqueItems: true,
      items: { type: "string", enum: ["narrative", "layout", "math", "visual"] },
    },
  });
}

function selfCheckSchema(): JsonSchema {
  return objectSchema({
    all_objectives_covered: { type: "boolean" },
    page_numbers_continuous: { type: "boolean" },
    all_assets_bound: { type: "boolean" },
    violations: textArray(),
  });
}

function layoutFamilySchema(): JsonSchema {
  return { type: "string", enum: ["immersive_scene", "focused_observation", "operation", "comparison", "summary"] };
}

function objectSchema(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}
