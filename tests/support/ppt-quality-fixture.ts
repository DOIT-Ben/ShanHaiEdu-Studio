import type { PptDesignPackage, PptPageSpec } from "@/server/ppt-quality/ppt-quality-types";

export function validPptDesignPackage(): PptDesignPackage {
  const pageSpecs = Array.from({ length: 12 }, (_, index) => page(index + 1));
  return {
    schemaVersion: "ppt-design-package.v1",
    productionPath: "ppt_quality_asset_assembly",
    brief: {
      grade: "五年级",
      subject: "数学",
      topic: "百分数的意义",
      audience: "五年级学生",
      useCase: "public_lesson",
      targetSlideCount: 12,
      objectiveIds: ["obj_meaning", "obj_representation"],
      evidenceRefs: ["evidence_textbook"],
    },
    evidenceBindings: [{
      evidenceId: "evidence_textbook",
      sourceArtifactId: "artifact_textbook_evidence",
      sourceType: "textbook",
      pageRefs: ["教材第84-85页"],
      claims: ["百分数表示一个数是另一个数的百分之几"],
      digest: "evidence-digest",
    }],
    objectives: [
      { objectiveId: "obj_meaning", statement: "理解百分数的意义", evidenceRefs: ["evidence_textbook"] },
      { objectiveId: "obj_representation", statement: "能用百分数表达数量关系", evidenceRefs: ["evidence_textbook"] },
    ],
    narrative: {
      communicationJob: "到课程结束时，学生应能解释百分数表达的数量关系，因为他们经历了从生活比较到数学表征的变化。",
      openingTension: "同样是优惠，为什么两个说法让人感觉不同？",
      learningProgression: ["观察冲突", "比较数量", "建立表征", "形成概念", "迁移应用"],
      closingResolution: "用百分数重新解释开场问题。",
      pageCount: 12,
    },
    visualSystem: {
      profileId: "ai_illustrated_3d",
      palette: ["#FFFFFF", "#147D92", "#F2C14E", "#1F2937"],
      materialLanguage: "轻立体纸艺与真实教具质感",
      lighting: "统一左上柔光",
      camera: "平视课堂观察视角",
      typography: { titleMinPt: 35, bodyMinPt: 24, fontFamily: "Microsoft YaHei" },
      layoutFamilies: ["immersive_scene", "focused_observation", "operation", "comparison", "summary"],
    },
    pageSpecs,
    samplePlan: {
      samplePageIds: ["page_02", "page_05", "page_10"],
      rationaleByPage: {
        page_02: "检验沉浸情境与课堂问题",
        page_05: "检验精确数学层和操作区",
        page_10: "检验高风险对比辨析页",
      },
      requiredRiskCoverage: ["narrative", "layout", "math", "visual"],
    },
  };
}

function page(pageNumber: number): PptPageSpec {
  const pageId = `page_${String(pageNumber).padStart(2, "0")}`;
  const layoutFamilies: PptPageSpec["layoutFamily"][] = ["immersive_scene", "focused_observation", "operation", "comparison", "summary"];
  return {
    pageId,
    pageNumber,
    objectiveIds: pageNumber <= 6 ? ["obj_meaning"] : ["obj_representation"],
    narrativeJob: `推进第 ${pageNumber} 个独立学习动作`,
    teachingAction: "教师提出一个可观察问题并控制揭示顺序",
    studentAction: "学生观察、比较并用自己的语言解释",
    takeawayTitle: `这一页要解决的问题 ${pageNumber}`,
    primaryVisualType: pageNumber % 2 === 0 ? "relationship" : "focused_observation",
    primaryVisualBrief: "使用一个大主视觉解释当前数量关系，中心教学区保持干净并为可编辑层留出空间。",
    visibleTextBudget: { maxLines: 3, maxCharacters: 60, minFontPt: 24 },
    aiScene: {
      assetId: `scene_${pageId}`,
      brief: "干净课堂场景，只提供空间、材质和注意焦点。",
      forbiddenContentExcluded: ["text", "formula", "answer", "exact_countable_objects"],
    },
    aiAssets: [{
      assetId: `asset_${pageId}`,
      role: "单体课堂教具",
      promptBrief: "一个无文字、无数字的透明背景单体教具",
      containsEmbeddedText: false,
      containsExactMath: false,
    }],
    editableMath: [{ layerId: `math_${pageId}`, role: "editable_quantity_relationship", exactContent: `${pageNumber}%` }],
    editableText: [{ layerId: `title_${pageId}`, role: "takeaway_title", text: `这一页要解决的问题 ${pageNumber}` }],
    layoutFamily: layoutFamilies[(pageNumber - 1) % layoutFamilies.length],
    layoutConstraints: ["标题安全区不被遮挡", "主对象高度不低于画面高度的30%"],
    composition: {
      canvasWidth: 1920,
      canvasHeight: 1080,
      layers: [
        { layerId: `placement_scene_${pageId}`, layerKind: "AI_SCENE", sourceId: `scene_${pageId}`, x: 0, y: 0, width: 1920, height: 1080, zIndex: 0 },
        { layerId: `placement_asset_${pageId}`, layerKind: "AI_ASSET", sourceId: `asset_${pageId}`, x: 120, y: 280, width: 480, height: 480, zIndex: 10 },
        { layerId: `placement_title_${pageId}`, layerKind: "EDITABLE_TEXT", sourceId: `title_${pageId}`, x: 120, y: 72, width: 1680, height: 120, zIndex: 20 },
        { layerId: `placement_math_${pageId}`, layerKind: "EDITABLE_MATH", sourceId: `math_${pageId}`, x: 760, y: 440, width: 760, height: 180, zIndex: 30 },
      ],
    },
    altText: `第 ${pageNumber} 页课堂主视觉及可编辑数量关系`,
    readingOrder: [`title_${pageId}`, `asset_${pageId}`, `math_${pageId}`],
    nonColorCoding: ["对象关系同时使用位置、连线与形状表达，不只依赖颜色"],
    mediaAccessibility: { captionsRequired: false, transcriptRequired: false },
    transitionFromPrevious: pageNumber === 1 ? null : "承接上一页学生观察，推进一个新的认知动作。",
    presenterNote: "先让学生说，再揭示可编辑数学层。",
    acceptanceChecks: ["数学内容与教材证据一致", "学生动作可观察", "答案不提前泄露"],
    riskLevel: [5, 10].includes(pageNumber) ? "high" : pageNumber % 3 === 0 ? "medium" : "low",
  };
}
