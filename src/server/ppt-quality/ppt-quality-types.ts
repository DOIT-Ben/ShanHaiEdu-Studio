import type { TargetLocator } from "@/server/quality/quality-types";

export type PptLayoutFamily =
  | "immersive_scene"
  | "focused_observation"
  | "operation"
  | "comparison"
  | "summary";

export type PptPrimaryVisualType =
  | "immersive_scene"
  | "focused_observation"
  | "process"
  | "comparison"
  | "operation"
  | "relationship"
  | "student_work"
  | "summary";

export type PresentationBrief = {
  grade: string;
  subject: string;
  topic: string;
  audience: string;
  useCase: "public_lesson" | "competition_lesson" | "ordinary_lesson";
  targetSlideCount: number;
  objectiveIds: string[];
  evidenceRefs: string[];
};

export type EvidenceBinding = {
  evidenceId: string;
  sourceArtifactId: string;
  sourceType: "textbook" | "curriculum_standard" | "teacher_material";
  pageRefs: string[];
  claims: string[];
  digest: string;
};

export type PptLearningObjective = {
  objectiveId: string;
  statement: string;
  evidenceRefs: string[];
};

export type PptNarrativeOutline = {
  communicationJob: string;
  openingTension: string;
  learningProgression: string[];
  closingResolution: string;
  pageCount: number;
};

export type PptVisualSystem = {
  profileId: string;
  palette: string[];
  materialLanguage: string;
  lighting: string;
  camera: string;
  typography: {
    titleMinPt: number;
    bodyMinPt: number;
    fontFamily: string;
  };
  layoutFamilies: PptLayoutFamily[];
};

export type PptPageSpec = {
  pageId: string;
  pageNumber: number;
  objectiveIds: string[];
  narrativeJob: string;
  teachingAction: string;
  studentAction: string;
  takeawayTitle: string;
  primaryVisualType: PptPrimaryVisualType;
  primaryVisualBrief: string;
  visibleTextBudget: {
    maxLines: number;
    maxCharacters: number;
    minFontPt: number;
  };
  aiScene: {
    assetId: string;
    brief: string;
    forbiddenContentExcluded: Array<"text" | "formula" | "answer" | "exact_countable_objects">;
  };
  aiAssets: Array<{
    assetId: string;
    role: string;
    promptBrief: string;
    containsEmbeddedText: boolean;
    containsExactMath: boolean;
  }>;
  editableMath: Array<{
    layerId: string;
    role: string;
    exactContent: unknown;
  }>;
  editableText: Array<{
    layerId: string;
    role: string;
    text: string;
  }>;
  layoutFamily: PptLayoutFamily;
  layoutConstraints: string[];
  composition: {
    canvasWidth: 1920;
    canvasHeight: 1080;
    layers: Array<{
      layerId: string;
      layerKind: "AI_SCENE" | "AI_ASSET" | "EDITABLE_TEXT" | "EDITABLE_MATH";
      sourceId: string;
      x: number;
      y: number;
      width: number;
      height: number;
      zIndex: number;
    }>;
  };
  altText: string;
  readingOrder: string[];
  nonColorCoding: string[];
  mediaAccessibility: {
    captionsRequired: boolean;
    transcriptRequired: boolean;
  };
  transitionFromPrevious: string | null;
  presenterNote: string;
  acceptanceChecks: string[];
  riskLevel: "low" | "medium" | "high";
};

export type PptSamplePlan = {
  samplePageIds: string[];
  rationaleByPage: Record<string, string>;
  requiredRiskCoverage: Array<"narrative" | "layout" | "math" | "visual">;
};

export type PptDesignPackage = {
  schemaVersion: "ppt-design-package.v1";
  productionPath: "ppt_quality_asset_assembly";
  brief: PresentationBrief;
  evidenceBindings: EvidenceBinding[];
  objectives: PptLearningObjective[];
  narrative: PptNarrativeOutline;
  visualSystem: PptVisualSystem;
  pageSpecs: PptPageSpec[];
  samplePlan: PptSamplePlan;
};

export type PptDesignValidationIssue = {
  code: string;
  message: string;
  locator: TargetLocator;
  responsibleStage: "ppt_evidence" | "ppt_narrative_outline" | "ppt_visual_system" | "ppt_page_design" | "ppt_sample_plan";
};

export type PptRevision =
  | { kind: "page_text_layout"; pageId: string }
  | { kind: "page_asset"; pageId: string; assetId: string }
  | { kind: "narrative_transition"; pageId: string }
  | { kind: "objective"; objectiveId: string }
  | { kind: "evidence"; evidenceId: string };

export type PptRevisionImpact = {
  nextAction: "repair_unit" | "repair_upstream";
  invalidatedPageIds: string[];
  invalidatedAssetIds: string[];
  invalidateSampleApproval: boolean;
  invalidateReports: true;
  reasonCodes: string[];
  impactDigest: string;
};
