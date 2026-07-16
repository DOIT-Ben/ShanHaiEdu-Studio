import type { PptDesignPackage } from "@/server/ppt-quality/ppt-quality-types";
import { validPptDesignPackage } from "./ppt-quality-fixture";

export function validTenPagePptDesignPackage(): PptDesignPackage {
  const input = validPptDesignPackage();
  const pageSpecs = input.pageSpecs.slice(0, 10).map((page, index) => ({
    ...page,
    narrativeJob: [
      "用两场投篮结果制造只看命中数会误判的认知冲突",
      "让学生先提出比较命中表现需要同时关注投中数和总次数",
      "把两组投篮记录转成同一整体下的份数关系",
      "借助百格图观察每一份与整体之间的稳定对应",
      "把投篮命中率写成分母为一百的分数并保持数学层可编辑",
      "从百分号的读写回到一个数是另一个数百分之几的含义",
      "比较命中率相同但投篮次数不同的两组记录",
      "辨析命中数更多是否必然代表命中率更高",
      "迁移到折扣与完成率情境并说明整体是谁",
      "回到开场投篮选择，用百分数给出有依据的判断",
    ][index]!,
    teachingAction: `教师在第 ${index + 1} 个学习动作中分步揭示投篮记录，并追问判断依据。`,
    studentAction: `学生完成第 ${index + 1} 个观察或比较任务，用数量关系解释自己的判断。`,
    takeawayTitle: [
      "命中数多，不一定表现更好",
      "公平比较要同时看投中数和总次数",
      "先把不同总数转成同一整体",
      "一百格让每一份都有共同尺度",
      "命中率可以写成百分数",
      "百分数表示两个数量的关系",
      "次数不同也可能有相同命中率",
      "只看命中数会得出错误结论",
      "先找准整体，再解释百分数",
      "用命中率回答开场选择",
    ][index]!,
    primaryVisualBrief: `第 ${index + 1} 页使用独立的投篮记录视觉事件，突出本页数量关系，并为标题与精确数学层保留安全区。`,
    aiScene: {
      ...page.aiScene,
      brief: `第 ${index + 1} 页的球场观察场景只承载空间、动作轨迹和注意焦点，不包含文字、公式或答案。`,
    },
  }));

  return {
    ...input,
    brief: { ...input.brief, topic: "投篮命中率中的百分数", targetSlideCount: 10 },
    narrative: { ...input.narrative, pageCount: 10 },
    pageSpecs,
    samplePlan: {
      samplePageIds: ["page_02", "page_05", "page_10"],
      rationaleByPage: {
        page_02: "验证冲突建立和沉浸场景的可读性",
        page_05: "验证精确数学层、操作区和答案揭示边界",
        page_10: "验证高风险回扣页的叙事闭环与对比布局",
      },
      requiredRiskCoverage: ["narrative", "layout", "math", "visual"],
    },
  };
}

export function validPptDirectorOutput(): Record<string, unknown> {
  const design = validTenPagePptDesignPackage();
  return {
    decision: "plan",
    summary: "已形成十页逐页课件设计，下一步可进入关键样张。",
    targetLocators: [],
    nextToolIntents: ["create_ppt_design_draft"],
    assumptions: ["未提供教材页码，按教师已确认的通用课程目标继续。"],
    stopConditions: ["逐页结构或生产质量门未通过"],
    communication_job: design.narrative.communicationJob,
    presentation_brief: snakeBrief(design),
    evidence_bindings: design.evidenceBindings.map((item) => ({
      evidence_id: item.evidenceId,
      source_artifact_kind: item.sourceType === "textbook" ? "textbook_evidence" : "ppt_draft",
      source_type: item.sourceType,
      page_refs: item.pageRefs,
      claims: item.claims,
    })),
    learning_objectives: design.objectives.map((item) => ({
      objective_id: item.objectiveId,
      statement: item.statement,
      evidence_refs: item.evidenceRefs,
    })),
    deck_narrative: {
      opening_tension: design.narrative.openingTension,
      learning_progression: design.narrative.learningProgression,
      closing_resolution: design.narrative.closingResolution,
      page_count: design.narrative.pageCount,
      page_count_rationale: "十页覆盖冲突、建模、辨析、迁移和回扣，且每页只推进一个学习动作。",
    },
    learning_objective_coverage: design.objectives.map((objective) => ({
      objective_id: objective.objectiveId,
      concepts: [objective.statement],
      page_ids: design.pageSpecs.filter((page) => page.objectiveIds.includes(objective.objectiveId)).map((page) => page.pageId),
    })),
    visual_system: {
      profile_id: design.visualSystem.profileId,
      palette: design.visualSystem.palette,
      material_language: design.visualSystem.materialLanguage,
      lighting: design.visualSystem.lighting,
      camera: design.visualSystem.camera,
      typography: {
        title_min_pt: design.visualSystem.typography.titleMinPt,
        body_min_pt: design.visualSystem.typography.bodyMinPt,
        font_family: design.visualSystem.typography.fontFamily,
      },
      layout_families: design.visualSystem.layoutFamilies,
    },
    page_specs: design.pageSpecs.map((page) => ({
      page_id: page.pageId,
      page_number: page.pageNumber,
      objective_ids: page.objectiveIds,
      narrative_job: page.narrativeJob,
      teaching_action: page.teachingAction,
      student_action: page.studentAction,
      takeaway_title: page.takeawayTitle,
      primary_visual_type: page.primaryVisualType,
      primary_visual_brief: page.primaryVisualBrief,
      visible_text_budget: {
        max_lines: page.visibleTextBudget.maxLines,
        max_characters: page.visibleTextBudget.maxCharacters,
        min_font_pt: page.visibleTextBudget.minFontPt,
      },
      ai_scene: {
        asset_id: page.aiScene.assetId,
        brief: page.aiScene.brief,
        forbidden_content_excluded: page.aiScene.forbiddenContentExcluded,
      },
      ai_assets: page.aiAssets.map((asset) => ({
        asset_id: asset.assetId,
        role: asset.role,
        prompt_brief: asset.promptBrief,
        contains_embedded_text: asset.containsEmbeddedText,
        contains_exact_math: asset.containsExactMath,
      })),
      editable_math: page.editableMath.map((layer) => ({ layer_id: layer.layerId, role: layer.role, exact_content: layer.exactContent })),
      editable_text: page.editableText.map((layer) => ({ layer_id: layer.layerId, role: layer.role, text: layer.text })),
      layout_family: page.layoutFamily,
      layout_constraints: page.layoutConstraints,
      composition: {
        canvas_width: page.composition.canvasWidth,
        canvas_height: page.composition.canvasHeight,
        layers: page.composition.layers.map((layer) => ({
          layer_id: layer.layerId,
          layer_kind: layer.layerKind,
          source_id: layer.sourceId,
          x: layer.x,
          y: layer.y,
          width: layer.width,
          height: layer.height,
          z_index: layer.zIndex,
        })),
      },
      alt_text: page.altText,
      reading_order: page.readingOrder,
      non_color_coding: page.nonColorCoding,
      media_accessibility: {
        captions_required: page.mediaAccessibility.captionsRequired,
        transcript_required: page.mediaAccessibility.transcriptRequired,
      },
      transition_from_previous: page.transitionFromPrevious,
      presenter_note: page.presenterNote,
      acceptance_checks: page.acceptanceChecks,
      risk_level: page.riskLevel,
    })),
    asset_requests: [],
    sample_plan: {
      sample_page_ids: design.samplePlan.samplePageIds,
      rationales: design.samplePlan.samplePageIds.map((pageId) => ({
        page_id: pageId,
        rationale: design.samplePlan.rationaleByPage[pageId],
      })),
      required_risk_coverage: design.samplePlan.requiredRiskCoverage,
    },
    self_check: {
      all_objectives_covered: true,
      page_numbers_continuous: true,
      all_assets_bound: true,
      violations: [],
    },
  };
}

function snakeBrief(design: PptDesignPackage) {
  return {
    grade: design.brief.grade,
    subject: design.brief.subject,
    topic: design.brief.topic,
    audience: design.brief.audience,
    use_case: design.brief.useCase,
    target_slide_count: design.brief.targetSlideCount,
    objective_ids: design.brief.objectiveIds,
    evidence_refs: design.brief.evidenceRefs,
  };
}
