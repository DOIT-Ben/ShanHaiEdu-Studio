import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ImageGenerationResult } from "@/server/image-generation/image-generation-run";
import { executeProviderTool, type ProviderToolAdapterInput } from "@/server/tools/provider-tool-adapter";
import { getToolDefinition, getToolDefinitionByCapabilityId } from "@/server/tools/tool-registry";
import type { ToolDefinition, ToolExecutionResult } from "@/server/tools/tool-types";
import { VideoTaskPersistenceUnknownError, type VideoGenerationResult } from "@/server/video-generation/video-generation-run";
import type { ArtifactRecord } from "@/server/workbench/types";
import { validPptSampleFixtures } from "./support/ppt-sample-fixture";
import { validPptFullProductionFixtures } from "./support/ppt-full-production-fixture";
import { createStoryboardManifest } from "@/server/video-quality/video-production-contract";
import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";

const forbiddenSensitiveText = /token|providerMode|API|api[_-]?key|Bearer\s+\S+|C:\\|\\Users\\|local path|SECRET|credential/i;

type FutureProviderToolAdapterInput = ProviderToolAdapterInput & {
  resolvedArtifacts?: ArtifactRecord[];
  runImage?: (input: unknown) => Promise<ImageGenerationResult>;
  runVideo?: (input: unknown) => Promise<VideoGenerationResult>;
};

const executeFutureProviderTool = executeProviderTool as (input: FutureProviderToolAdapterInput) => Promise<ToolExecutionResult>;

function projectRecord(): NonNullable<ProviderToolAdapterInput["project"]> {
  return {
    id: "project-a",
    title: "百分数公开课",
    status: "active",
    grade: "六年级",
    subject: "数学",
    textbookVersion: "人教版",
    lessonTopic: "百分数",
    lifecycleState: "active",
    lifecycleVersion: 0,
    archivedAt: null,
    deletedAt: null,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  };
}

function artifactRef(kind: string, artifactId: string, markdownContent: string): ProviderToolAdapterInput["artifactRefs"][number] {
  return {
    kind,
    artifactId,
    title: `${kind} 已确认产物`,
    summary: `${kind} 已通过教师确认。`,
    markdownContent,
  };
}

function resolvedArtifact(kind: ArtifactRecord["kind"], artifactId: string, overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id: artifactId,
    projectId: "project-a",
    nodeKey: kind,
    title: `${kind} 已确认产物`,
    kind,
    status: "approved",
    summary: `${kind} 已通过教师确认。`,
    markdownContent: `# ${kind}`,
    structuredContent: {},
    version: 7,
    isApproved: true,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

function pptDesignArtifact(overrides: Partial<ArtifactRecord> = {}) {
  return resolvedArtifact("ppt_design_draft", "artifact-ppt-design-a", {
    title: "逐页 PPT 设计稿",
    summary: "已确认的逐页四层设计稿",
    markdownContent: "第 1 页：底图：白板；元素：百分数问题；文字：百分数导入；排版：左文右图。",
    ...overrides,
  });
}

function pptDraftArtifact(overrides: Partial<ArtifactRecord> = {}) {
  return resolvedArtifact("ppt_draft", "artifact-ppt-draft-a", {
    markdownContent: "第 1 页：百分数生活情境导入。",
    ...overrides,
  });
}

function assetBriefArtifact(overrides: Partial<ArtifactRecord> = {}) {
  return resolvedArtifact("asset_brief_generate", "artifact-asset-brief-a", {
    markdownContent: "统一风格：明亮教室；角色：学生；道具：百分数卡片。",
    ...overrides,
  });
}

function videoArtifacts() {
  const manifest = createStoryboardManifest({
    schemaVersion: "video-storyboard.v1",
    intent: { schemaVersion: "video-intent.v1", productionPath: "video_full_intro", videoMode: "full_intro", targetDurationRange: { minSeconds: 30, maxSeconds: 60 }, courseAnchor: "结尾的一次课堂提问", classroomReturnQuestion: "这个变化意味着什么？", answerDisclosureBoundary: "不提前解释课程答案" },
    shots: [1, 2, 3].map((ordinal) => ({ shotId: `shot_0${ordinal}`, ordinal, durationTargetRange: { minSeconds: 10, maxSeconds: 20 }, sceneFunction: "推进独立悬念", mainSubject: "机械装置", subjectAction: "逐步发生变化", cameraMotion: "缓慢推进", continuityKeys: ["同一装置", "冷暖对比"], startFrameIntent: "承接上一状态", endFrameIntent: "留下下一变化", referencePolicy: "none" as const, referenceAssetIds: [], textPolicy: "post_production_only" as const, modelPrompt: `镜头 ${ordinal}：机械装置发生可见变化`, negativePrompt: "不要课堂讲解，不要答案文字", retakeVariables: ["cameraMotion", "subjectAction"] })),
    references: [],
  });
  return [
    resolvedArtifact("video_segment_plan", "artifact-video-plan-a", { markdownContent: "S1：8 秒百分数悬念片段。" }),
    resolvedArtifact("storyboard_generate", "artifact-storyboard-a", { markdownContent: "S1：超市折扣镜头。", structuredContent: { videoStoryboardManifest: manifest } }),
    resolvedArtifact("asset_image_generate", "artifact-assets-a", { markdownContent: "参考图：scene-1.png。" }),
  ];
}

function pptDraftRef() {
  return artifactRef("ppt_draft", "artifact-ppt-draft-a", "第 1 页：百分数生活情境导入。");
}

function videoArtifactRefs() {
  return [
    artifactRef("video_segment_plan", "artifact-video-plan-a", "S1：8 秒百分数悬念片段。"),
    artifactRef("storyboard_generate", "artifact-storyboard-a", "S1：超市折扣镜头。"),
    artifactRef("asset_image_generate", "artifact-assets-a", "参考图：scene-1.png。"),
  ];
}

function pptDesignRef(overrides: Partial<ProviderToolAdapterInput["artifactRefs"][number]> = {}): ProviderToolAdapterInput["artifactRefs"][number] {
  return {
    kind: "ppt_design_draft",
    artifactId: "artifact-ppt-design-a",
    title: "逐页 PPT 设计稿",
    summary: "已确认的逐页四层设计稿",
    markdownContent: "第 1 页：底图：白板；元素：百分数问题；文字：百分数导入；排版：左文右图。",
    ...overrides,
  };
}

function unsupportedProviderTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "image_asset",
    label: "生成图片",
    description: "生成课堂图片素材。",
    adapterKind: "provider",
    capabilityId: "image_asset",
    providerToolId: "image_asset.generate",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        projectId: { type: "string" },
        userInstruction: { type: ["string", "null"] },
      },
      required: ["projectId", "userInstruction"],
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        artifactKind: { type: "string", const: "image_asset" },
        summary: { type: "string" },
      },
      required: ["artifactKind", "summary"],
    },
    requiresHumanGate: true,
    sideEffectLevel: "external_call",
    requiredArtifactKinds: [],
    producedArtifactKind: "image_asset",
    failurePolicy: { retryable: false, maxRetries: 0, onFailure: "record_observation" },
    implemented: true,
    ...overrides,
  };
}

function minimaxImageResult(overrides: Partial<ImageGenerationResult> = {}): ImageGenerationResult {
  return {
    fileName: "normalized.png",
    localOutput: ".tmp/image-artifacts/normalized.png",
    bytes: 2048,
    sha256: "d".repeat(64),
    imageValid: true,
    mime: "image/png",
    provider: "model_gateway",
    model: "image-2",
    width: 1920,
    height: 1080,
    promptDigest: "f".repeat(64),
    rawAsset: {
      fileName: "raw.png",
      localOutput: ".tmp/image-artifacts/raw.png",
      bytes: 2048,
      sha256: "e".repeat(64),
      mime: "image/png",
    },
    normalizedAsset: {
      fileName: "normalized.png",
      localOutput: ".tmp/image-artifacts/normalized.png",
      bytes: 2048,
      sha256: "d".repeat(64),
      mime: "image/png",
      width: 1920,
      height: 1080,
    },
    ...overrides,
  };
}

describe("M64-C ProviderToolAdapter", () => {
  it("rejects an R5-only PPT design candidate that is not production-downstream eligible", async () => {
    let calls = 0;
    const source = pptDesignArtifact({
      status: "needs_review",
      isApproved: false,
      structuredContent: {
        pptDesignCandidate: { schemaVersion: "ppt-design-candidate.v1" },
        artifactQualityState: {
          validationStatus: "passed",
          reviewStatus: "passed",
          downstreamEligibility: "blocked",
          eligibleStages: ["production_design_expansion"],
        },
      },
    });
    const result = await executeFutureProviderTool({
      tool: getToolDefinition("generate_ppt_sample_assets"),
      projectId: "project-a",
      artifactRefs: [pptDesignRef()],
      resolvedArtifacts: [source],
      runPptAssetBatch: async () => { calls += 1; return validPptSampleFixtures(); },
    });

    expect(calls).toBe(0);
    expect(result).toMatchObject({ status: "needs_input", missingInputs: ["ppt_design_draft"] });
  });

  it("returns a manifest-backed PPT sample asset bundle from the quality provider tool", async () => {
    const fixtures = validPptSampleFixtures();
    const source = pptDesignArtifact({ structuredContent: { pptDesignPackage: fixtures.designPackage } });
    const result = await executeFutureProviderTool({
      tool: getToolDefinition("generate_ppt_sample_assets"),
      projectId: "project-a",
      artifactRefs: [pptDesignRef()],
      resolvedArtifacts: [source],
      runPptAssetBatch: async () => ({ requestBatch: fixtures.requestBatch, manifest: fixtures.manifest }),
    });

    expect(result).toMatchObject({
      status: "succeeded",
      toolId: "generate_ppt_sample_assets",
      capabilityId: "ppt_sample_assets",
      provider: "test-image-provider",
      artifactDraft: {
        nodeKey: "image_prompts",
        kind: "image_prompts",
        structuredContent: {
          pptAssetRequestBatch: { batchDigest: fixtures.requestBatch.batchDigest },
          pptAssetManifest: { manifestDigest: fixtures.manifest.manifestDigest },
          storage: { pptAssetBundle: { assets: expect.any(Array) } },
        },
      },
      qualityGate: { passed: true, gates: expect.arrayContaining(["ppt_asset_manifest_valid"]) },
      budgetEvent: {
        providerSubmitted: true,
        providerSubmissionCount: fixtures.requestBatch.requests.length,
      },
    });
  });

  it("generates full-production PPT assets only with the current explicit sample approval", async () => {
    const fixtures = validPptFullProductionFixtures();
    const design = pptDesignArtifact({ structuredContent: { pptDesignPackage: fixtures.designPackage } });
    const approval = resolvedArtifact("image_prompts", "artifact-ppt-samples-approved", { structuredContent: {
      pptKeySampleSet: fixtures.sampleSet,
      pptSampleApproval: fixtures.approval,
    } });
    const evidence = resolvedArtifact("lesson_plan", "artifact_textbook_evidence", { title: "教材证据", summary: "已确认的教材事实依据" });
    let observedScope: string | undefined;
    const result = await executeFutureProviderTool({
      tool: getToolDefinition("generate_ppt_full_assets"),
      projectId: "project-a",
      artifactRefs: [pptDesignRef(), artifactRef("image_prompts", approval.id, approval.markdownContent)],
      resolvedArtifacts: [design, approval, evidence],
      runPptAssetBatch: async (input) => {
        observedScope = input.scope;
        return { requestBatch: fixtures.requestBatch, manifest: fixtures.manifest };
      },
    });

    expect(observedScope).toBe("full_production");
    expect(result).toMatchObject({
      status: "succeeded",
      capabilityId: "ppt_full_assets",
      artifactDraft: { structuredContent: {
        pptAssetRequestBatch: { scope: "full_production" },
        pptAssetManifest: { scope: "full_production" },
        pptKeySampleSet: { sampleSetDigest: fixtures.sampleSet.sampleSetDigest },
        pptSampleApproval: { sampleSetDigest: fixtures.sampleSet.sampleSetDigest },
      } },
    });
  });

  it("blocks full-production assets before the provider call when design evidence is not a resolved approved artifact", async () => {
    const fixtures = validPptFullProductionFixtures();
    const design = pptDesignArtifact({ structuredContent: { pptDesignPackage: fixtures.designPackage } });
    const approval = resolvedArtifact("image_prompts", "artifact-ppt-samples-approved", { structuredContent: {
      pptKeySampleSet: fixtures.sampleSet,
      pptSampleApproval: fixtures.approval,
    } });
    let calls = 0;
    const result = await executeFutureProviderTool({
      tool: getToolDefinition("generate_ppt_full_assets"),
      projectId: "project-a",
      artifactRefs: [pptDesignRef(), artifactRef("image_prompts", approval.id, approval.markdownContent)],
      resolvedArtifacts: [design, approval],
      runPptAssetBatch: async () => { calls += 1; return { requestBatch: fixtures.requestBatch, manifest: fixtures.manifest }; },
    });

    expect(calls).toBe(0);
    expect(result).toMatchObject({ status: "failed", errorCategory: "quality_gate_failed" });
  });

  it("does not call the full asset provider when sample approval is stale", async () => {
    const fixtures = validPptFullProductionFixtures();
    fixtures.approval.sampleSetDigest = "f".repeat(64);
    const design = pptDesignArtifact({ structuredContent: { pptDesignPackage: fixtures.designPackage } });
    const approval = resolvedArtifact("image_prompts", "artifact-ppt-samples-stale", { structuredContent: { pptKeySampleSet: fixtures.sampleSet, pptSampleApproval: fixtures.approval } });
    let calls = 0;
    const result = await executeFutureProviderTool({
      tool: getToolDefinition("generate_ppt_full_assets"),
      projectId: "project-a",
      artifactRefs: [pptDesignRef(), artifactRef("image_prompts", approval.id, approval.markdownContent)],
      resolvedArtifacts: [design, approval],
      runPptAssetBatch: async () => { calls += 1; return { requestBatch: fixtures.requestBatch, manifest: fixtures.manifest }; },
    });

    expect(calls).toBe(0);
    expect(result.status).toBe("retryable_failed");
  });

  it("wraps coze_ppt success through an injected provider runner without saving artifacts", async () => {
    const tool = getToolDefinition("generate_pptx_from_design");
    let calledWith: unknown;
    const sourceArtifact = pptDesignArtifact({ version: 9 });

    const result = await executeFutureProviderTool({
      tool,
      projectId: "project-a",
      userInstruction: "请生成真实 PPTX",
      artifactRefs: [pptDesignRef()],
      resolvedArtifacts: [sourceArtifact],
      sourceMessageId: "message-a",
      runCozePpt: async (input) => {
        calledWith = input;
        return {
          fileName: "lesson.pptx",
          localOutput: ".tmp/lesson.pptx",
          bytes: 2048,
          sha256: "sha256-value",
          requestedPageCount: 1,
          slideCount: 1,
          pptxValid: true,
          hasPresentationXml: true,
        };
      },
    });

    expect(calledWith).toMatchObject({
      project: { id: "project-a" },
      artifact: {
        id: "artifact-ppt-design-a",
        kind: "ppt_design_draft",
        nodeKey: "ppt_design_draft",
        version: 9,
        status: "approved",
      },
    });
    expect((calledWith as { artifact: ArtifactRecord }).artifact).toBe(sourceArtifact);
    expect(result).toMatchObject({
      status: "succeeded",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
      provider: "coze_ppt",
      artifactDraft: {
        nodeKey: "pptx_artifact",
        kind: "pptx_artifact",
        title: "真实 1 页 PPTX 文件",
        structuredContent: {
          storage: {
            cozePptx: {
              fileName: "lesson.pptx",
              localOutput: ".tmp/lesson.pptx",
              bytes: 2048,
              sha256: "sha256-value",
              slideCount: 1,
              requestedPageCount: 1,
              generationMode: "coze_generated",
              sourceArtifactId: "artifact-ppt-design-a",
            },
          },
          实际页数: "1 页",
          目标页数: "1 页",
          artifactTruth: {
            created: true,
            persisted: true,
            persistenceScope: "provider_local_file",
            providerPersisted: true,
            workbenchPersisted: false,
            placeholder: false,
            producedArtifactKind: "pptx_artifact",
          },
          qualityGate: {
            passed: true,
            gates: expect.arrayContaining(["pptx_valid", "presentation_xml_present", "slide_count_matches_design"]),
          },
        },
      },
      artifactTruth: {
        created: true,
        persisted: true,
        persistenceScope: "provider_local_file",
        providerPersisted: true,
        workbenchPersisted: false,
        placeholder: false,
        producedArtifactKind: "pptx_artifact",
      },
      qualityGate: {
        passed: true,
        gates: expect.arrayContaining(["pptx_valid", "presentation_xml_present", "slide_count_matches_design"]),
      },
      providerPayload: {
        localOutput: ".tmp/lesson.pptx",
        bytes: 2048,
        sha256: "sha256-value",
        mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        artifactTruth: {
          created: true,
          persisted: true,
          persistenceScope: "provider_local_file",
          providerPersisted: true,
          workbenchPersisted: false,
          placeholder: false,
          producedArtifactKind: "pptx_artifact",
        },
        qualityGate: {
          passed: true,
          gates: expect.arrayContaining(["pptx_valid", "presentation_xml_present", "slide_count_matches_design"]),
        },
      },
      assistantSummary: expect.stringContaining("PPTX"),
      budgetEvent: {
        capabilityId: "coze_ppt",
        status: "succeeded",
        kind: "tool_succeeded",
      },
    });
    expect("artifactCreated" in result).toBe(false);
    expect("observation" in result).toBe(false);
  });

  it("passes real project metadata to the coze_ppt provider runner when provided", async () => {
    const tool = getToolDefinition("generate_pptx_from_design");
    let calledWith: Parameters<NonNullable<ProviderToolAdapterInput["runCozePpt"]>>[0] | undefined;

    await executeFutureProviderTool({
      tool,
      projectId: "project-a",
      project: {
        id: "project-a",
        title: "真实项目上下文",
        status: "active",
        grade: "五年级",
        subject: "数学",
        textbookVersion: "人教版",
        lessonTopic: "百分数",
        lifecycleState: "active",
        lifecycleVersion: 0,
        archivedAt: null,
        deletedAt: null,
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
      userInstruction: "请生成真实 PPTX",
      artifactRefs: [pptDesignRef()],
      resolvedArtifacts: [pptDesignArtifact()],
      runCozePpt: async (input) => {
        calledWith = input;
        return {
          fileName: "lesson.pptx",
          localOutput: ".tmp/lesson.pptx",
          bytes: 2048,
          sha256: "sha256-value",
          requestedPageCount: 1,
          slideCount: 1,
          pptxValid: true,
          hasPresentationXml: true,
        };
      },
    });

    expect(calledWith?.project).toMatchObject({
      id: "project-a",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
      textbookVersion: "人教版",
    });
  });

  it("generates video asset reference images from the approved asset brief", async () => {
    let calledWith: Parameters<NonNullable<ProviderToolAdapterInput["runImage"]>>[0] | undefined;

    const result = await executeFutureProviderTool({
      tool: getToolDefinition("asset_image_generate"),
      projectId: "project-a",
      artifactRefs: [artifactRef("asset_brief_generate", "artifact-asset-brief-a", "统一风格：明亮教室。")],
      resolvedArtifacts: [assetBriefArtifact()],
      runImage: async (input) => {
        calledWith = input as Parameters<NonNullable<ProviderToolAdapterInput["runImage"]>>[0];
        return minimaxImageResult({
          fileName: "asset-reference.png",
          localOutput: ".tmp/asset-reference.png",
          normalizedAsset: {
            ...minimaxImageResult().normalizedAsset,
            fileName: "asset-reference.png",
            localOutput: ".tmp/asset-reference.png",
          },
        });
      },
    });

    expect(calledWith).toMatchObject({
      project: { id: "project-a" },
      artifact: {
        id: "artifact-asset-brief-a",
        kind: "asset_brief_generate",
        nodeKey: "asset_brief_generate",
      },
    });
    expect(result).toMatchObject({
      status: "succeeded",
      toolId: "asset_image_generate",
      capabilityId: "asset_image_generate",
      provider: "model_gateway",
      artifactDraft: {
        nodeKey: "asset_image_generate",
        kind: "asset_image_generate",
        structuredContent: {
          storage: {
            imageAsset: {
              fileName: "asset-reference.png",
              localOutput: ".tmp/asset-reference.png",
              generationMode: "asset_image_generated",
              sourceArtifactId: "artifact-asset-brief-a",
            },
          },
        },
      },
      artifactTruth: { created: true, persisted: true, placeholder: false, producedArtifactKind: "asset_image_generate" },
      qualityGate: { passed: true, gates: expect.arrayContaining(["image_valid", "supported_image_mime"]) },
    });
  });

  it("uses the latest approved artifact ref when multiple versions share the required kind", async () => {
    let sourceArtifactId = "";

    await executeFutureProviderTool({
      tool: getToolDefinition("generate_pptx_from_design"),
      projectId: "project-a",
      artifactRefs: [
        pptDesignRef({ artifactId: "artifact-ppt-design-old" }),
        pptDesignRef({ artifactId: "artifact-ppt-design-latest" }),
      ],
      resolvedArtifacts: [
        pptDesignArtifact({ id: "artifact-ppt-design-old", version: 3 }),
        pptDesignArtifact({ id: "artifact-ppt-design-latest", version: 8 }),
      ],
      runCozePpt: async ({ artifact }) => {
        sourceArtifactId = artifact.id;
        return {
          fileName: "lesson.pptx",
          localOutput: ".tmp/lesson.pptx",
          bytes: 2048,
          sha256: "sha256-value",
          requestedPageCount: 1,
          slideCount: 1,
          pptxValid: true,
          hasPresentationXml: true,
        };
      },
    });

    expect(sourceArtifactId).toBe("artifact-ppt-design-latest");
  });

  it("maps invalid ppt design and validation failures to quality gate failures without artifact creation", async () => {
    const result = await executeFutureProviderTool({
      tool: getToolDefinition("generate_pptx_from_design"),
      projectId: "project-a",
      userInstruction: "生成 PPTX",
      artifactRefs: [pptDesignRef()],
      resolvedArtifacts: [pptDesignArtifact()],
      runCozePpt: async () => {
        throw new Error("invalid PPT design: validation failed, slide count mismatch");
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
      provider: "coze_ppt",
      artifactCreated: false,
      errorCategory: "quality_gate_failed",
      observation: {
        kind: "quality_gate_failed",
        artifactCreated: false,
        retryPolicy: {
          retryable: false,
          nextAction: "fix_inputs",
        },
      },
      budgetEvent: {
        capabilityId: "coze_ppt",
        status: "failed",
        kind: "quality_gate_failed",
      },
    });
  });

  it("normalizes provider runner failure into a provider unavailable observation and budget event", async () => {
    const result = await executeFutureProviderTool({
      tool: getToolDefinition("generate_pptx_from_design"),
      projectId: "project-a",
      userInstruction: "生成 PPTX",
      artifactRefs: [pptDesignRef()],
      resolvedArtifacts: [pptDesignArtifact()],
      runCozePpt: async () => {
        throw new Error("coze provider timeout token=secret API_KEY=abc C:\\Users\\HB\\secret.pptx providerMode=openapi");
      },
    });

    expect(result).toMatchObject({
      status: "retryable_failed",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
      provider: "coze_ppt",
      artifactCreated: false,
      errorCategory: "provider_unavailable",
      observation: {
        kind: "provider_unavailable",
        artifactCreated: false,
      },
      budgetEvent: {
        capabilityId: "coze_ppt",
        status: "retryable_failed",
        kind: "provider_unavailable",
      },
    });
  });

  it("blocks coze_ppt when the required ppt_design_draft source artifact is missing and does not call the runner", async () => {
    let called = false;

    const result = await executeFutureProviderTool({
      tool: getToolDefinition("generate_pptx_from_design"),
      projectId: "project-a",
      userInstruction: "生成 PPTX",
      artifactRefs: [{ kind: "lesson_plan", artifactId: "artifact-lesson-plan-a" }],
      runCozePpt: async () => {
        called = true;
        throw new Error("should_not_call_provider");
      },
    });

    expect(called).toBe(false);
    expect(result).toMatchObject({
      status: "needs_input",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
      missingInputs: ["ppt_design_draft"],
      artifactCreated: false,
      observation: {
        kind: "quality_gate_failed",
        artifactCreated: false,
      },
      budgetEvent: {
        status: "failed",
        kind: "quality_gate_failed",
        providerSubmitted: false,
      },
    });
  });

  it("returns needs_input without calling the runner when only artifactRefs are supplied", async () => {
    let called = false;

    const result = await executeFutureProviderTool({
      tool: getToolDefinition("generate_pptx_from_design"),
      projectId: "project-a",
      artifactRefs: [pptDesignRef()],
      runCozePpt: async () => {
        called = true;
        throw new Error("should_not_call_provider");
      },
    });

    expect(called).toBe(false);
    expect(result).toMatchObject({
      status: "needs_input",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
      missingInputs: ["ppt_design_draft"],
      artifactCreated: false,
      observation: { kind: "quality_gate_failed", retryPolicy: { nextAction: "fix_inputs" }, artifactCreated: false },
      budgetEvent: { status: "failed", kind: "quality_gate_failed" },
    });
  });

  it("safely fails unsupported image and video provider tools without invoking real providers", async () => {
    let called = false;

    for (const tool of [unsupportedProviderTool(), unsupportedProviderTool({ id: "intro_video", capabilityId: "intro_video", providerToolId: "intro_video.generate", producedArtifactKind: "intro_video" })]) {
      const result = await executeProviderTool({
        tool,
        projectId: "project-a",
        userInstruction: "生成素材",
        artifactRefs: [pptDesignRef()],
        runCozePpt: async () => {
          called = true;
          throw new Error("should_not_call_coze_for_unsupported_tools");
        },
      });

      expect(result).toMatchObject({
        status: "failed",
        toolId: tool.id,
        capabilityId: tool.capabilityId,
        artifactCreated: false,
        observation: {
          kind: "tool_failed",
          artifactCreated: false,
        },
        budgetEvent: {
          status: "failed",
          kind: "tool_failed",
        },
      });
      if ("observation" in result) {
        expect(result.observation.teacherSafeSummary).not.toMatch(forbiddenSensitiveText);
        expect(result.observation.internalReasonSanitized).not.toMatch(forbiddenSensitiveText);
      }
    }

    expect(called).toBe(false);
  });

  it("redacts sensitive provider error details from teacher-safe observations", async () => {
    const result = await executeProviderTool({
      tool: getToolDefinition("generate_pptx_from_design"),
      projectId: "project-a",
      artifactRefs: [pptDesignRef()],
      resolvedArtifacts: [pptDesignArtifact()],
      runCozePpt: async () => {
        throw new Error("token=abc providerMode=cli API_KEY=sk-secret path=C:\\Users\\HB\\secret\\ppt.pptx Bearer abc.def");
      },
    });

    expect(result.status).toBe("retryable_failed");
    expect(result.budgetEvent).toMatchObject({ providerSubmitted: true });
    if ("observation" in result) {
      expect(result.observation.teacherSafeSummary).not.toMatch(forbiddenSensitiveText);
      expect(result.observation.internalReasonSanitized).not.toMatch(forbiddenSensitiveText);
    }
  });

  describe("M64-R image_asset", () => {
    it("accepts a deterministic-quality-passed needs_review source without teacher approval", async () => {
      let called = false;
      const sourceArtifact = pptDraftArtifact({
        status: "needs_review",
        isApproved: false,
        structuredContent: {
          artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" },
        },
      });

      const result = await executeFutureProviderTool({
        tool: getToolDefinitionByCapabilityId("image_asset"),
        projectId: "project-a",
        artifactRefs: [pptDraftRef()],
        resolvedArtifacts: [sourceArtifact],
        runImage: async () => {
          called = true;
          return minimaxImageResult({
            fileName: "visual.png",
            localOutput: "artifact-storage/image-artifacts/visual.png",
            normalizedAsset: {
              ...minimaxImageResult().normalizedAsset,
              fileName: "visual.png",
              localOutput: "artifact-storage/image-artifacts/visual.png",
            },
          });
        },
      });

      expect(called).toBe(true);
      expect(result.status).toBe("succeeded");
    });

    it("passes the approved ppt draft to the image runner and returns a truth-gated image artifact draft", async () => {
      let calledWith: unknown;
      const sourceArtifact = pptDraftArtifact({ version: 11 });

      const result = await executeFutureProviderTool({
        tool: getToolDefinitionByCapabilityId("image_asset"),
        projectId: "project-a",
        project: projectRecord(),
        userInstruction: "生成课堂导入图",
        artifactRefs: [pptDraftRef()],
        resolvedArtifacts: [sourceArtifact],
        sourceMessageId: "message-a",
        runImage: async (input) => {
          calledWith = input;
          return minimaxImageResult({
            fileName: "percentage-intro.png",
            localOutput: ".tmp/image-artifacts/percentage-intro.png",
            normalizedAsset: {
              ...minimaxImageResult().normalizedAsset,
              fileName: "percentage-intro.png",
              localOutput: ".tmp/image-artifacts/percentage-intro.png",
            },
          });
        },
      });

      expect(calledWith).toMatchObject({
        project: { id: "project-a", grade: "六年级", subject: "数学", lessonTopic: "百分数" },
        artifact: { id: "artifact-ppt-draft-a", kind: "ppt_draft", nodeKey: "ppt_draft", status: "approved", version: 11, isApproved: true },
      });
      expect((calledWith as { artifact: ArtifactRecord }).artifact).toBe(sourceArtifact);
      expect(result).toMatchObject({
        status: "succeeded",
        toolId: "generate_classroom_image",
        capabilityId: "image_asset",
        provider: "model_gateway",
        artifactDraft: {
          nodeKey: "image_prompts",
          kind: "image_prompts",
          title: expect.stringContaining("课堂视觉图"),
          structuredContent: {
            storage: {
              imageAsset: {
                fileName: "percentage-intro.png",
                localOutput: ".tmp/image-artifacts/percentage-intro.png",
                bytes: 2048,
                sha256: "d".repeat(64),
                mime: "image/png",
                generationMode: "image_generated",
                sourceArtifactId: "artifact-ppt-draft-a",
              },
            },
            artifactTruth: {
              created: true,
              persisted: true,
              providerPersisted: true,
              workbenchPersisted: false,
              placeholder: false,
              producedArtifactKind: "image_prompts",
            },
            qualityGate: {
              passed: true,
              gates: expect.arrayContaining(["image_valid", "supported_image_mime"]),
            },
          },
        },
        artifactTruth: {
          created: true,
          persisted: true,
          persistenceScope: "provider_local_file",
          providerPersisted: true,
          workbenchPersisted: false,
          placeholder: false,
          producedArtifactKind: "image_prompts",
        },
        qualityGate: {
          passed: true,
          gates: expect.arrayContaining(["image_valid", "supported_image_mime"]),
        },
      });
    });

    it("passes only the typed Tool Skill slice to the image provider and binds MiniMax lineage to the artifact", async () => {
      let calledWith: unknown;
      const sourceArtifact = {
        ...pptDraftArtifact(),
        kind: "asset_brief_generate",
        nodeKey: "asset_brief_generate",
        id: "artifact-video-asset-brief-a",
      } as ArtifactRecord;
      const businessSkillContext = {
        skillName: "shanhai-imagegen",
        skillVersion: "1.1",
        displayName: "山海图像生成",
        responsibility: "执行当前视频资产 Tool 的图片请求",
        semanticSlice: {
          schemaVersion: "business-tool-skill-slice.v1",
          toolName: "generate_video_assets",
          responsibility: "执行当前视频资产 Tool 的图片请求",
          contracts: {
            tool: { consumes: ["asset_brief_generate"], produces: ["asset_image_generate"] },
            skill: { consumes: [], produces: [{ artifactType: "image-generation-result", contractVersion: "shanhai-imagegen/v2" }] },
          },
          guidance: [{ sourcePath: "references/result-contract.md", content: "绑定真实文件、来源、Provider、模型和质量证据。" }],
        },
        provenance: {
          schemaVersion: "business-tool-skill-provenance.v1",
          entrypointSha256: `sha256:${"a".repeat(64)}`,
          references: [{ sourcePath: "references/result-contract.md", sha256: `sha256:${"b".repeat(64)}` }],
          bindingPolicyDigest: `sha256:${"c".repeat(64)}`,
        },
      } as never;

      const result = await executeFutureProviderTool({
        tool: getToolDefinition("asset_image_generate"),
        projectId: "project-a",
        project: projectRecord(),
        userInstruction: "只生成灯塔守护者角色参考图",
        toolInput: { taskBrief: { goal: "独立创意短片资产图", requestedOutputs: ["video"], constraints: [], excludedOutputs: ["ppt", "package"] } },
        artifactRefs: [artifactRef("asset_brief_generate", sourceArtifact.id, sourceArtifact.title)],
        resolvedArtifacts: [sourceArtifact],
        businessSkillContext,
        runImage: async (input) => {
          calledWith = input;
          return {
            fileName: "normalized.png",
            localOutput: ".tmp/image-artifacts/normalized.png",
            bytes: 2048,
            sha256: "d".repeat(64),
            imageValid: true,
            mime: "image/png",
            provider: "model_gateway",
            model: "image-2",
            width: 1920,
            height: 1080,
            promptDigest: "f".repeat(64),
            rawAsset: { fileName: "raw.png", localOutput: ".tmp/image-artifacts/raw.png", bytes: 2048, sha256: "e".repeat(64), mime: "image/png" },
            normalizedAsset: { fileName: "normalized.png", localOutput: ".tmp/image-artifacts/normalized.png", bytes: 2048, sha256: "d".repeat(64), mime: "image/png", width: 1920, height: 1080 },
          };
        },
      });

      expect(calledWith).toMatchObject({
        userInstruction: "只生成灯塔守护者角色参考图",
        toolInput: { taskBrief: { goal: "独立创意短片资产图" } },
        businessSkillContext: {
          semanticSlice: { toolName: "generate_video_assets" },
          provenance: { entrypointSha256: `sha256:${"a".repeat(64)}` },
        },
      });
      expect(result).toMatchObject({
        status: "succeeded",
        provider: "model_gateway",
        artifactDraft: {
          structuredContent: {
            storage: {
              imageAsset: {
                provider: "model_gateway",
                model: "image-2",
                width: 1920,
                height: 1080,
                rawAsset: { sha256: "e".repeat(64) },
                normalizedAsset: { sha256: "d".repeat(64) },
              },
            },
            businessSkillProvenance: { bindingPolicyDigest: `sha256:${"c".repeat(64)}` },
          },
        },
      });
    });

    it("rejects a nominal MiniMax success when raw or normalized lineage is incomplete", async () => {
      const result = await executeFutureProviderTool({
        tool: getToolDefinitionByCapabilityId("image_asset"),
        projectId: "project-a",
        artifactRefs: [pptDraftRef()],
        resolvedArtifacts: [pptDraftArtifact()],
        runImage: async () => ({
          fileName: "normalized.png",
          localOutput: ".tmp/image-artifacts/normalized.png",
          bytes: 2048,
          sha256: "d".repeat(64),
          imageValid: true,
          mime: "image/png",
          provider: "model_gateway",
          model: "image-2",
          width: 1920,
          height: 1080,
          promptDigest: "f".repeat(64),
        } as unknown as ImageGenerationResult),
      });

      expect(result).toMatchObject({
        status: "failed",
        artifactCreated: false,
        errorCategory: "quality_gate_failed",
        observation: { kind: "quality_gate_failed", artifactCreated: false },
        budgetEvent: { status: "failed", kind: "quality_gate_failed", providerSubmitted: true },
      });
    });

    it("returns needs_input without calling the image runner when ppt_draft is missing", async () => {
      let called = false;
      const result = await executeFutureProviderTool({
        tool: getToolDefinitionByCapabilityId("image_asset"),
        projectId: "project-a",
        artifactRefs: [artifactRef("lesson_plan", "artifact-lesson-a", "教案正文")],
        runImage: async () => {
          called = true;
          throw new Error("should_not_call_image_runner");
        },
      });

      expect(called).toBe(false);
      expect(result).toMatchObject({
        status: "needs_input",
        toolId: "generate_classroom_image",
        capabilityId: "image_asset",
        missingInputs: ["ppt_draft"],
        artifactCreated: false,
        observation: { kind: "quality_gate_failed", retryPolicy: { nextAction: "fix_inputs" }, artifactCreated: false },
      });
    });

    it("maps invalid_image_output to a quality gate failure without creating an artifact", async () => {
      const result = await executeFutureProviderTool({
        tool: getToolDefinitionByCapabilityId("image_asset"),
        projectId: "project-a",
        artifactRefs: [pptDraftRef()],
        resolvedArtifacts: [pptDraftArtifact()],
        runImage: async () => {
          throw new Error("invalid_image_output");
        },
      });

      expect(result).toMatchObject({
        status: "failed",
        toolId: "generate_classroom_image",
        capabilityId: "image_asset",
        artifactCreated: false,
        errorCategory: "quality_gate_failed",
        observation: { kind: "quality_gate_failed", artifactCreated: false },
        budgetEvent: { status: "failed", kind: "quality_gate_failed" },
      });
    });

    it("returns a MiniMax parameter rejection to Main Agent as fix_inputs", async () => {
      const result = await executeFutureProviderTool({
        tool: getToolDefinitionByCapabilityId("image_asset"),
        projectId: "project-a",
        artifactRefs: [pptDraftRef()],
        resolvedArtifacts: [pptDraftArtifact()],
        runImage: async () => {
          throw new Error("minimax_image_generation_request_failed:status_2013:invalid_aspect_ratio");
        },
      });

      expect(result).toMatchObject({
        status: "failed",
        toolId: "generate_classroom_image",
        capabilityId: "image_asset",
        artifactCreated: false,
        errorCategory: "provider_input_invalid",
        observation: {
          kind: "quality_gate_failed",
          reasonCode: "minimax_image_generation_request_failed:status_2013:invalid_aspect_ratio",
          retryPolicy: { retryable: false, nextAction: "fix_inputs" },
        },
        budgetEvent: { status: "failed", kind: "quality_gate_failed", providerSubmitted: true },
      });
    });

    it("redacts image provider failures and does not create an artifact", async () => {
      const result = await executeFutureProviderTool({
        tool: getToolDefinitionByCapabilityId("image_asset"),
        projectId: "project-a",
        artifactRefs: [pptDraftRef()],
        resolvedArtifacts: [pptDraftArtifact()],
        runImage: async () => {
          throw new Error("image request failed token=dummy API_KEY=dummy C:\\Users\\demo\\image.png providerMode=openapi");
        },
      });

      expect(result).toMatchObject({
        status: "retryable_failed",
        toolId: "generate_classroom_image",
        capabilityId: "image_asset",
        artifactCreated: false,
        errorCategory: "provider_unavailable",
        observation: { kind: "provider_unavailable", artifactCreated: false },
      });
      if ("observation" in result) {
        expect(result.observation.teacherSafeSummary).not.toMatch(forbiddenSensitiveText);
        expect(result.observation.internalReasonSanitized).not.toMatch(forbiddenSensitiveText);
      }
    });
  });

  describe("M64-R video_segment_generate", () => {
    it("classifies an accepted-but-unpersisted video task as submission_unknown", async () => {
      const result = await executeFutureProviderTool({
        tool: getToolDefinitionByCapabilityId("video_segment_generate"),
        projectId: "project-a",
        project: projectRecord(),
        artifactRefs: videoArtifactRefs(),
        resolvedArtifacts: videoArtifacts(),
        toolInput: { shotIds: ["shot_01"] },
        runVideo: async () => {
          throw new VideoTaskPersistenceUnknownError();
        },
      });

      expect(result).toMatchObject({
        status: "failed",
        errorCategory: "submission_unknown",
        observation: {
          kind: "provider_unavailable",
          retryPolicy: { retryable: false, nextAction: "do_not_retry_automatically" },
        },
      });
    });

    it("passes the segment plan and both upstream artifacts to the video runner and returns lineage with truth gates", async () => {
      let calledWith: unknown;
      const resolvedArtifacts = videoArtifacts();
      const generationTaskLifecycle = {
        providerTaskId: "persisted-task",
        onTaskAccepted: async () => undefined,
        onPoll: async () => undefined,
      };
      const result = await executeFutureProviderTool({
        tool: getToolDefinitionByCapabilityId("video_segment_generate"),
        projectId: "project-a",
        project: projectRecord(),
        userInstruction: "生成真实分镜视频",
        artifactRefs: videoArtifactRefs(),
        resolvedArtifacts,
        toolInput: { shotIds: ["shot_01"] },
        sourceMessageId: "message-a",
        generationTaskLifecycle,
        runVideo: async (input) => {
          calledWith = input;
          return {
            fileName: "percentage-segment.mp4",
            localOutput: ".tmp/video-artifacts/percentage-segment.mp4",
            bytes: 4096,
            sha256: "video-sha256",
            videoValid: true,
            mime: "video/mp4",
            providerEvidence: { name: "evolink", model: "grok-imagine-video" },
            requestEvidence: { shotId: "shot_01", durationSeconds: 10, references: [] },
          };
        },
      });

      expect(calledWith).toMatchObject({
        project: { id: "project-a", grade: "六年级", subject: "数学", lessonTopic: "百分数" },
        artifact: { id: "artifact-video-plan-a", kind: "video_segment_plan", nodeKey: "video_segment_plan", status: "approved", version: 7, isApproved: true },
        upstreamArtifacts: expect.arrayContaining([
          expect.objectContaining({ id: "artifact-storyboard-a", kind: "storyboard_generate", status: "approved", version: 7, isApproved: true }),
          expect.objectContaining({ id: "artifact-assets-a", kind: "asset_image_generate", status: "approved", version: 7, isApproved: true }),
        ]),
        taskLifecycle: generationTaskLifecycle,
        shot: { shotId: "shot_01", durationTargetRange: { minSeconds: 10, maxSeconds: 20 }, durationSeconds: 10, prompt: expect.stringContaining("机械装置"), referenceImageUrls: [], referenceEvidence: [] },
      });
      expect((calledWith as { artifact: ArtifactRecord }).artifact).toBe(resolvedArtifacts[0]);
      expect((calledWith as { upstreamArtifacts: ArtifactRecord[] }).upstreamArtifacts).toEqual([resolvedArtifacts[1], resolvedArtifacts[2]]);
      expect(result).toMatchObject({
        status: "succeeded",
        toolId: "generate_video_segment",
        capabilityId: "video_segment_generate",
        provider: "video_segment_generate",
        artifactDraft: {
          nodeKey: "video_segment_generate",
          kind: "video_segment_generate",
          title: expect.stringContaining("分镜视频片段"),
          structuredContent: {
            storage: {
              videoAsset: {
                fileName: "percentage-segment.mp4",
                localOutput: ".tmp/video-artifacts/percentage-segment.mp4",
                bytes: 4096,
                sha256: "video-sha256",
                mime: "video/mp4",
                generationMode: "video_generated",
                provider: "evolink",
                model: "grok-imagine-video",
                sourceArtifactId: "artifact-video-plan-a",
                sourceArtifactIds: ["artifact-video-plan-a", "artifact-storyboard-a", "artifact-assets-a"],
                requestEvidence: { shotId: "shot_01", durationSeconds: 10, references: [] },
              },
            },
            artifactTruth: {
              created: true,
              persisted: true,
              providerPersisted: true,
              workbenchPersisted: false,
              placeholder: false,
              producedArtifactKind: "video_segment_generate",
            },
            qualityGate: {
              passed: true,
              gates: expect.arrayContaining(["video_valid", "mp4_ftyp_present", "mp4_moov_present"]),
            },
          },
        },
        artifactTruth: {
          created: true,
          persisted: true,
          persistenceScope: "provider_local_file",
          providerPersisted: true,
          workbenchPersisted: false,
          placeholder: false,
          producedArtifactKind: "video_segment_generate",
        },
        qualityGate: {
          passed: true,
          gates: expect.arrayContaining(["video_valid", "mp4_ftyp_present", "mp4_moov_present"]),
        },
      });
      expect(result).toMatchObject({
        providerPayload: { provider: "evolink", model: "grok-imagine-video" },
      });
    });

    it("returns needs_input and does not call the video runner when any required artifact is missing", async () => {
      const requiredKinds = ["video_segment_plan", "storyboard_generate", "asset_image_generate"];

      for (const missingKind of requiredKinds) {
        let called = false;
        const result = await executeFutureProviderTool({
          tool: getToolDefinitionByCapabilityId("video_segment_generate"),
          projectId: "project-a",
          artifactRefs: videoArtifactRefs().filter((artifact) => artifact.kind !== missingKind),
          resolvedArtifacts: videoArtifacts().filter((artifact) => artifact.kind !== missingKind),
          toolInput: { shotIds: ["shot_01"] },
          runVideo: async () => {
            called = true;
            throw new Error("should_not_call_video_runner");
          },
        });

        expect(called).toBe(false);
        expect(result).toMatchObject({
          status: "needs_input",
          toolId: "generate_video_segment",
          capabilityId: "video_segment_generate",
          missingInputs: [missingKind],
          artifactCreated: false,
          observation: { kind: "quality_gate_failed", retryPolicy: { nextAction: "fix_inputs" }, artifactCreated: false },
        });
      }
    });

    it("maps invalid_video_output to a quality gate failure without creating an artifact", async () => {
      const result = await executeFutureProviderTool({
        tool: getToolDefinitionByCapabilityId("video_segment_generate"),
        projectId: "project-a",
        artifactRefs: videoArtifactRefs(),
        resolvedArtifacts: videoArtifacts(),
        toolInput: { shotIds: ["shot_01"] },
        runVideo: async () => {
          throw new Error("invalid_video_output");
        },
      });

      expect(result).toMatchObject({
        status: "failed",
        toolId: "generate_video_segment",
        capabilityId: "video_segment_generate",
        artifactCreated: false,
        errorCategory: "quality_gate_failed",
        observation: { kind: "quality_gate_failed", artifactCreated: false },
        budgetEvent: { status: "failed", kind: "quality_gate_failed" },
      });
    });

    it("redacts configuration, submit, poll, and download failures from video provider observations", async () => {
      for (const failure of ["missing_VIDEO_PROVIDER_ENV", "video_submit_failed", "video_query_failed", "video_download_failed"]) {
        const result = await executeFutureProviderTool({
          tool: getToolDefinitionByCapabilityId("video_segment_generate"),
          projectId: "project-a",
          artifactRefs: videoArtifactRefs(),
          resolvedArtifacts: videoArtifacts(),
          toolInput: { shotIds: ["shot_01"] },
          runVideo: async () => {
            throw new Error(`${failure} token=dummy API_KEY=dummy C:\\Users\\demo\\video.mp4 providerMode=evolink`);
          },
        });

        expect(result).toMatchObject({
          status: "retryable_failed",
          toolId: "generate_video_segment",
          capabilityId: "video_segment_generate",
          artifactCreated: false,
          errorCategory: "provider_unavailable",
          observation: { kind: "provider_unavailable", artifactCreated: false },
        });
        if ("observation" in result) {
          expect(result.observation.teacherSafeSummary).not.toMatch(forbiddenSensitiveText);
          expect(result.observation.internalReasonSanitized).not.toMatch(forbiddenSensitiveText);
        }
      }
    });

    it("blocks missing, multiple, and out-of-range shot selections before provider submit", async () => {
      for (const shotIds of [undefined, ["shot_01", "shot_02"], ["shot_99"]]) {
        let submits = 0;
        const result = await executeFutureProviderTool({
          tool: getToolDefinitionByCapabilityId("video_segment_generate"), projectId: "project-a",
          artifactRefs: videoArtifactRefs(), resolvedArtifacts: videoArtifacts(),
          ...(shotIds ? { toolInput: { shotIds } } : {}),
          runVideo: async () => { submits += 1; throw new Error("must_not_submit"); },
        });
        expect(submits).toBe(0);
        expect(result).toMatchObject({ status: "failed", errorCategory: "quality_gate_failed", observation: { kind: "quality_gate_failed" } });
      }
    });

    it("uploads a real approved reference asset and binds the evidence to the selected shot", async () => {
      const root = mkdtempSync(path.join(os.tmpdir(), "shanhai-video-reference-"));
      const previousRoot = process.env.ARTIFACT_STORAGE_ROOT;
      const previousGatewayKey = process.env.MODEL_GATEWAY_API_KEY;
      const previousGatewayBaseUrl = process.env.MODEL_GATEWAY_BASE_URL;
      const previousGatewayVideoModel = process.env.MODEL_GATEWAY_VIDEO_MODEL;
      process.env.ARTIFACT_STORAGE_ROOT = root;
      process.env.MODEL_GATEWAY_API_KEY = "test-only";
      process.env.MODEL_GATEWAY_BASE_URL = "https://gateway.example/v1";
      process.env.MODEL_GATEWAY_VIDEO_MODEL = "video-grok";
      try {
        const image = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 7)]);
        const stored = writeLocalArtifact({ category: "image-artifacts", fileName: "reference.png", buffer: image });
        const sha256 = createHash("sha256").update(image).digest("hex");
        const manifest = createStoryboardManifest({
          schemaVersion: "video-storyboard.v1",
          intent: { schemaVersion: "video-intent.v1", productionPath: "video_full_intro", videoMode: "full_intro", targetDurationRange: { minSeconds: 30, maxSeconds: 60 }, courseAnchor: "结尾一次提问", classroomReturnQuestion: "发生了什么？", answerDisclosureBoundary: "不解释答案" },
          shots: [1, 2, 3].map((ordinal) => ({ shotId: `shot_0${ordinal}`, ordinal, durationTargetRange: { minSeconds: 10, maxSeconds: 20 }, sceneFunction: "推进悬念", mainSubject: "机械装置", subjectAction: "改变状态", cameraMotion: "缓慢推进", continuityKeys: ["同一装置"], startFrameIntent: "承接前态", endFrameIntent: "留下疑问", referencePolicy: ordinal === 1 ? "required" as const : "none" as const, referenceAssetIds: ordinal === 1 ? ["asset_main"] : [], textPolicy: "post_production_only" as const, modelPrompt: `机械装置镜头 ${ordinal}`, negativePrompt: "不要答案", retakeVariables: ["subjectAction"] })),
          references: [{ assetId: "asset_main", assetDomain: "video", applicableShotIds: ["shot_01"], purpose: "装置连续性" }],
        });
        const artifacts = videoArtifacts();
        artifacts[1] = { ...artifacts[1], structuredContent: { videoStoryboardManifest: manifest } };
        artifacts[2] = { ...artifacts[2], structuredContent: { storage: { imageAsset: { localOutput: stored.localOutput, sha256, mime: "image/png" } } } };
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { file_id: "file-1", file_url: "https://files.example/reference.png" } }), { status: 200, headers: { "content-type": "application/json" } })));
        let selectedShot: unknown;
        const result = await executeFutureProviderTool({
          tool: getToolDefinitionByCapabilityId("video_segment_generate"), projectId: "project-a", toolInput: { shotIds: ["shot_01"] },
          artifactRefs: videoArtifactRefs(), resolvedArtifacts: artifacts,
          runVideo: async (input) => {
            selectedShot = (input as { shot?: unknown }).shot;
            const shot = (input as { shot: { shotId: string; referenceEvidence: unknown[] } }).shot;
            return { fileName: "shot.mp4", localOutput: ".tmp/video-artifacts/shot.mp4", bytes: 4096, sha256: "video-sha256", videoValid: true, mime: "video/mp4", providerEvidence: { name: "evolink", model: "grok-imagine-video" }, requestEvidence: { shotId: shot.shotId, durationSeconds: 10, references: shot.referenceEvidence as never[] } };
          },
        });
        expect(selectedShot).toMatchObject({ shotId: "shot_01", durationTargetRange: { minSeconds: 10, maxSeconds: 20 }, durationSeconds: 10, referenceImageUrls: ["https://files.example/reference.png"], referenceEvidence: [{ assetId: "asset_main", localSha256: sha256, shotId: "shot_01" }] });
        expect(result).toMatchObject({ status: "succeeded", artifactDraft: { structuredContent: { storage: { videoAsset: { requestEvidence: { shotId: "shot_01", references: [{ localSha256: sha256 }] } } } } } });
      } finally {
        vi.unstubAllGlobals();
        if (previousRoot === undefined) delete process.env.ARTIFACT_STORAGE_ROOT; else process.env.ARTIFACT_STORAGE_ROOT = previousRoot;
        if (previousGatewayKey === undefined) delete process.env.MODEL_GATEWAY_API_KEY; else process.env.MODEL_GATEWAY_API_KEY = previousGatewayKey;
        if (previousGatewayBaseUrl === undefined) delete process.env.MODEL_GATEWAY_BASE_URL; else process.env.MODEL_GATEWAY_BASE_URL = previousGatewayBaseUrl;
        if (previousGatewayVideoModel === undefined) delete process.env.MODEL_GATEWAY_VIDEO_MODEL; else process.env.MODEL_GATEWAY_VIDEO_MODEL = previousGatewayVideoModel;
        rmSync(root, { recursive: true, force: true });
      }
    });
  });
});
