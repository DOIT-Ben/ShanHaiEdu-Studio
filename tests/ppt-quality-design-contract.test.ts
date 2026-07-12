import { describe, expect, it } from "vitest";

import { validatePptDesignPackage, validatePptDesignPackageForProviderProduction } from "@/server/ppt-quality/ppt-design-validator";
import { validPptDesignPackage } from "./support/ppt-quality-fixture";

describe("V1 Stage 3A PPT quality design contract", () => {
  it("accepts a complete 12-page quality design package", () => {
    const result = validatePptDesignPackage(validPptDesignPackage());

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects the engineering fixture at the provider-production boundary", () => {
    const result = validatePptDesignPackageForProviderProduction(validPptDesignPackage());

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ppt_page_generic_placeholder", locator: expect.objectContaining({ pageId: "page_01" }) }),
    ]));
  });

  it("rejects duplicate teaching jobs at the provider-production boundary", () => {
    const input = validPptDesignPackage();
    input.pageSpecs[1] = {
      ...input.pageSpecs[1],
      narrativeJob: input.pageSpecs[0].narrativeJob,
      takeawayTitle: "观察一百格中的部分",
      primaryVisualBrief: "一个透明百分格板置于浅色桌面，右侧留出可编辑数学层安全区。",
      teachingAction: "教师遮住部分格子，引导学生说明整体与涂色部分的关系。",
      studentAction: "学生用完整的一百格作为单位，描述已涂色部分的含义。",
    };

    expect(validatePptDesignPackageForProviderProduction(input).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "ppt_page_teaching_job_duplicate", locator: expect.objectContaining({ pageId: "page_02" }) }),
    ]));
  });

  it("rejects duplicate page ids and non-contiguous page numbers with page locators", () => {
    const input = validPptDesignPackage();
    input.pageSpecs[1] = { ...input.pageSpecs[1], pageId: "page_01", pageNumber: 4 };
    const result = validatePptDesignPackage(input);

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "duplicate_page_id", locator: expect.objectContaining({ kind: "page", pageId: "page_01" }) }),
      expect.objectContaining({ code: "page_number_not_contiguous" }),
    ]));
  });

  it("rejects range-compressed page descriptions", () => {
    const input = validPptDesignPackage();
    input.pageSpecs[3] = { ...input.pageSpecs[3], narrativeJob: "第4-8页统一完成概念探究" };

    expect(validatePptDesignPackage(input).issues).toContainEqual(expect.objectContaining({
      code: "page_range_compression_forbidden",
      locator: expect.objectContaining({ kind: "page", pageId: "page_04" }),
    }));
  });

  it("rejects mismatched target, narrative, and page-spec counts", () => {
    const input = validPptDesignPackage();
    input.brief = { ...input.brief, targetSlideCount: 11 };
    input.narrative = { ...input.narrative, pageCount: 10 };

    expect(validatePptDesignPackage(input).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "target_slide_count_mismatch" }),
      expect.objectContaining({ code: "narrative_page_count_mismatch" }),
    ]));
  });

  it("rejects uncovered approved objectives", () => {
    const input = validPptDesignPackage();
    input.objectives.push({ objectiveId: "obj_uncovered", statement: "能解释一个新目标", evidenceRefs: ["evidence_textbook"] });

    expect(validatePptDesignPackage(input).issues).toContainEqual(expect.objectContaining({
      code: "objective_not_covered",
      responsibleStage: "ppt_narrative_outline",
    }));
  });

  it("rejects exact math, text, or answers embedded in AI visual layers", () => {
    const input = validPptDesignPackage();
    input.pageSpecs[4] = {
      ...input.pageSpecs[4],
      aiScene: { ...input.pageSpecs[4].aiScene, forbiddenContentExcluded: ["formula"] },
      aiAssets: [{
        assetId: "asset_bad",
        role: "带答案的卡片",
        promptBrief: "画出 25%=1/4 的答案卡",
        containsEmbeddedText: true,
        containsExactMath: true,
      }],
    };

    expect(validatePptDesignPackage(input).issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "ai_scene_forbidden_content_policy_incomplete",
      "ai_asset_embeds_text",
      "ai_asset_embeds_exact_math",
    ]));
  });

  it("rejects pages missing teaching action, student action, presenter note, or acceptance checks", () => {
    const input = validPptDesignPackage();
    input.pageSpecs[6] = {
      ...input.pageSpecs[6],
      teachingAction: "",
      studentAction: "",
      presenterNote: "",
      acceptanceChecks: [],
    };

    expect(validatePptDesignPackage(input).issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "teaching_action_missing",
      "student_action_missing",
      "presenter_note_missing",
      "acceptance_checks_missing",
    ]));
  });

  it("rejects pages without complete accessibility semantics", () => {
    const input = validPptDesignPackage();
    input.pageSpecs[2] = {
      ...input.pageSpecs[2],
      altText: "",
      nonColorCoding: [],
      mediaAccessibility: undefined as never,
    };

    expect(validatePptDesignPackage(input).issues).toContainEqual(expect.objectContaining({
      code: "page_layout_accessibility_incomplete",
      locator: expect.objectContaining({ kind: "page", pageId: "page_03" }),
    }));
  });

  it("rejects incomplete or out-of-bounds executable composition layers", () => {
    const input = validPptDesignPackage();
    input.pageSpecs[3].composition.layers = input.pageSpecs[3].composition.layers
      .filter((layer) => layer.layerKind !== "EDITABLE_MATH")
      .map((layer, index) => index === 0 ? { ...layer, x: 1900, width: 200 } : layer);

    expect(validatePptDesignPackage(input).issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "composition_layer_out_of_bounds",
      "composition_required_layer_missing",
    ]));
  });

  it("rejects a sample plan that covers only one easy layout family", () => {
    const input = validPptDesignPackage();
    input.samplePlan = {
      samplePageIds: ["page_01", "page_03"],
      rationaleByPage: { page_01: "简单标题页", page_03: "另一个简单标题页" },
      requiredRiskCoverage: ["visual"],
    };
    input.pageSpecs[2] = { ...input.pageSpecs[2], layoutFamily: "immersive_scene", riskLevel: "low" };

    expect(validatePptDesignPackage(input).issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "sample_layout_coverage_insufficient",
      "sample_high_risk_page_missing",
      "sample_risk_coverage_incomplete",
    ]));
  });
});
