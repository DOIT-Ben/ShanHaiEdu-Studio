import { describe, expect, it, vi } from "vitest";
import { getToolDefinitions } from "@/server/tools/tool-registry";
import { routeToolCall } from "@/server/tools/tool-router";
import type { ToolExecutionResult } from "@/server/tools/tool-types";
import { resolveRuntimeContract } from "@/server/contracts/runtime-contract";
import {
  createValidationReport,
  hashArtifactDraft,
  validateToolExecutionResult,
  validateToolPreconditions,
} from "@/server/contracts/contract-validator";
import { validPptDesignPackage } from "./support/ppt-quality-fixture";
import { validPptSampleFixtures } from "./support/ppt-sample-fixture";
import { buildPptKeySampleCandidate } from "@/server/ppt-quality/ppt-key-sample-candidate";
import type { ArtifactRecord } from "@/server/workbench/types";

describe("V1 Stage 2A runtime contracts", () => {
  it("projects every registered executable tool into a contract without forcing a next node", () => {
    for (const tool of getToolDefinitions().filter((definition) => definition.implemented)) {
      const contract = resolveRuntimeContract(tool);
      expect(contract.toolId).toBe(tool.id);
      expect(contract.capabilityId).toBe(tool.capabilityId);
      expect(contract.requiredArtifactKinds).toEqual(tool.requiredArtifactKinds);
      expect(contract.outputArtifactKind).toBe(tool.producedArtifactKind);
      expect(contract).not.toHaveProperty("next");
      expect(contract).not.toHaveProperty("recommendedNext");
    }
  });

  it("blocks missing approved inputs before the executor and returns a deterministic report", async () => {
    const executor = vi.fn();
    const result = await routeToolCall({
      capabilityId: "ppt_design",
      projectId: "project-contract-pre",
      userInstruction: "生成设计稿",
      artifactRefs: [],
      approvedArtifacts: [],
      runtime: {} as never,
      projectContext: {} as never,
    }, { internalExecutor: executor });

    expect(executor).not.toHaveBeenCalled();
    expect(result.status).toBe("needs_input");
    expect(result.validationReport).toMatchObject({
      authority: "deterministic",
      overallStatus: "failed",
      stage: "ppt_design",
    });
    if (!result.validationReport) throw new Error("Expected ValidationReport.");
    expect(result.validationReport.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ gateId: "required_input:ppt_draft", status: "failed" }),
    ]));
  });

  it("keeps advisory contract rules out of deterministic hard blocking", () => {
    const tool = getToolDefinitions().find((definition) => definition.capabilityId === "ppt_design")!;
    const contract = resolveRuntimeContract(tool);
    expect(contract.advisoryRules.length).toBeGreaterThan(0);

    const report = validateToolPreconditions({
      tool,
      projectId: "project-advisory",
      approvedArtifacts: [{ nodeKey: "ppt_draft", title: "PPT 大纲", summary: "已确认", markdown: "# PPT 大纲" }],
      artifactRefs: [],
      resolvedArtifacts: [],
    });

    expect(report.overallStatus).toBe("passed");
  });

  it("accepts an internally validated downstream-eligible artifact for Provider preconditions without teacher approval", () => {
    const tool = getToolDefinitions().find((definition) => definition.capabilityId === "coze_ppt")!;
    const artifact: ArtifactRecord = {
      id: "artifact-internally-eligible-design",
      projectId: "project-internally-eligible",
      nodeKey: "ppt_design_draft",
      kind: "ppt_design_draft",
      title: "内部审查通过的逐页设计",
      status: "needs_review",
      summary: "尚未由教师签收，但已通过内部验证与审查。",
      markdownContent: "# 逐页设计",
      structuredContent: {
        artifactQualityState: {
          validationStatus: "passed",
          reviewStatus: "passed",
          downstreamEligibility: "eligible",
        },
      },
      version: 1,
      isApproved: false,
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
    };

    const report = validateToolPreconditions({
      tool,
      projectId: artifact.projectId,
      artifactRefs: [{
        kind: artifact.kind,
        artifactId: artifact.id,
        title: artifact.title,
        summary: artifact.summary,
        markdownContent: artifact.markdownContent,
        structuredContent: artifact.structuredContent,
      }],
      resolvedArtifacts: [artifact],
    });

    expect(report.overallStatus).toBe("passed");
    expect(report.gates).toContainEqual(expect.objectContaining({
      gateId: "required_input:ppt_design_draft",
      status: "passed",
    }));
  });

  it("fails a mismatched output kind and node before persistence", () => {
    const tool = getToolDefinitions().find((definition) => definition.capabilityId === "ppt_design")!;
    const report = validateToolExecutionResult({
      tool,
      projectId: "project-contract-post",
      result: {
        status: "succeeded",
        artifactDraft: {
          nodeKey: "lesson_plan",
          kind: "lesson_plan",
          title: "Wrong output",
          summary: "Wrong output",
          markdownContent: "# Wrong",
          structuredContent: {},
        },
      },
    });

    expect(report.overallStatus).toBe("failed");
    expect(report.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ gateId: "output_kind", status: "failed" }),
      expect.objectContaining({ gateId: "output_node", status: "failed" }),
    ]));
  });

  it("treats missing Provider truth as a hard post-validation failure", () => {
    const tool = getToolDefinitions().find((definition) => definition.capabilityId === "coze_ppt")!;
    const report = validateToolExecutionResult({
      tool,
      projectId: "project-provider-truth",
      result: {
        status: "succeeded",
        artifactDraft: {
          nodeKey: "pptx_artifact",
          kind: "pptx_artifact",
          title: "PPTX",
          summary: "PPTX",
          markdownContent: "# PPTX",
          structuredContent: {},
        },
      },
    });

    expect(report.overallStatus).toBe("failed");
    expect(report.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ gateId: "artifact_truth", status: "failed" }),
      expect.objectContaining({ gateId: "provider_quality_gate", status: "failed" }),
    ]));
  });

  it("rejects a page-repair result that does not carry a valid full-deck candidate", () => {
    const tool = getToolDefinitions().find((definition) => definition.capabilityId === "ppt_page_repair")!;
    const report = validateToolExecutionResult({
      tool,
      projectId: "project-page-repair-post",
      result: {
        status: "succeeded",
        artifactDraft: {
          nodeKey: "pptx_artifact",
          kind: "pptx_artifact",
          title: "完整 PPT 页级返修包",
          summary: "缺少候选证据。",
          markdownContent: "# 返修",
          structuredContent: {},
        },
      },
    });

    expect(report.gates).toContainEqual(expect.objectContaining({
      gateId: "ppt_full_deck_candidate",
      status: "failed",
    }));
  });

  it("rejects model-generated PPT quality output without a structured design package", () => {
    const tool = getToolDefinitions().find((definition) => definition.capabilityId === "ppt_design")!;
    const report = validateToolExecutionResult({
      tool,
      projectId: "project-ppt-missing-package",
      result: {
        status: "succeeded",
        artifactDraft: {
          nodeKey: "ppt_design_draft",
          kind: "ppt_design_draft",
          title: "PPT 设计稿",
          summary: "只有 Markdown。",
          markdownContent: "# PPT 设计稿",
          structuredContent: { generationMode: "model_generated" },
        },
      },
    });

    expect(report.overallStatus).toBe("failed");
    expect(report.gates).toContainEqual(expect.objectContaining({
      gateId: "ppt_design_package",
      status: "failed",
      reasonCode: "ppt_design_package_missing",
    }));
  });

  it("blocks persistence when routed PPT output misses the quality package", async () => {
    const result = await routeToolCall({
      capabilityId: "ppt_design",
      projectId: "project-ppt-post-gate",
      userInstruction: "生成 PPT 设计包",
      approvedArtifacts: [{ nodeKey: "ppt_draft", title: "PPT 大纲", summary: "已确认", markdown: "# PPT 大纲" }],
      runtime: {} as never,
      projectContext: {
        grade: "五年级",
        subject: "数学",
        topic: "百分数",
        requestedOutputs: ["PPT 设计包"],
      },
    }, {
      internalExecutor: async ({ tool }): Promise<ToolExecutionResult> => ({
        status: "succeeded",
        toolId: tool.id,
        capabilityId: tool.capabilityId ?? "ppt_design",
        artifactDraft: {
          nodeKey: "ppt_design_draft",
          kind: "ppt_design_draft",
          title: "PPT 设计稿",
          summary: "缺少结构化质量包。",
          markdownContent: "# PPT 设计稿",
          structuredContent: { generationMode: "model_generated" },
        },
        assistantSummary: "PPT 设计稿已生成。",
        budgetEvent: {
          capabilityId: "ppt_design",
          actionKey: "create_ppt_design_draft:ppt_design_draft",
          status: "succeeded",
          kind: "tool_succeeded",
          createdAt: "2026-07-12T00:00:00.000Z",
        },
      }),
    });

    expect(result).toMatchObject({
      status: "failed",
      artifactCreated: false,
      errorCategory: "quality_gate_failed",
      validationReport: { overallStatus: "failed" },
    });
    expect(result.validationReport?.gates).toContainEqual(expect.objectContaining({
      gateId: "ppt_design_package",
      status: "failed",
    }));
  });

  it("keeps deterministic PPT drafts preview-only and outside the quality contract", () => {
    const tool = getToolDefinitions().find((definition) => definition.capabilityId === "ppt_design")!;
    const report = validateToolExecutionResult({
      tool,
      projectId: "project-ppt-preview",
      result: {
        status: "succeeded",
        artifactDraft: {
          nodeKey: "ppt_design_draft",
          kind: "ppt_design_draft",
          title: "PPT 预览草稿",
          summary: "确定性预览。",
          markdownContent: "# PPT 预览草稿",
          structuredContent: {
            generationMode: "deterministic_draft",
            pptDesignPackage: validPptDesignPackage(),
          },
        },
      },
    });

    expect(report.overallStatus).toBe("failed");
    expect(report.gates).toContainEqual(expect.objectContaining({
      gateId: "ppt_quality_generation_mode",
      status: "failed",
      reasonCode: "deterministic_ppt_preview_only",
    }));
  });

  it("accepts a complete PPT sample asset batch through deterministic post-validation", () => {
    const tool = getToolDefinitions().find((definition) => definition.capabilityId === "ppt_sample_assets")!;
    const fixtures = validPptSampleFixtures();
    const report = validateToolExecutionResult({
      tool,
      projectId: "project-ppt-sample-assets",
      result: {
        status: "succeeded",
        artifactTruth: { created: true, persisted: true, placeholder: false, producedArtifactKind: "image_prompts" },
        qualityGate: { passed: true, gates: ["adapter_claimed_success"] },
        artifactDraft: {
          nodeKey: "image_prompts",
          kind: "image_prompts",
          title: "PPT 关键样张资产批次",
          summary: "真实资产与来源清单。",
          structuredContent: {
            pptAssetRequestBatch: fixtures.requestBatch,
            pptAssetManifest: fixtures.manifest,
          },
        },
      },
    });

    expect(report.overallStatus).toBe("passed");
    expect(report.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ gateId: "ppt_asset_request_batch", status: "passed" }),
      expect.objectContaining({ gateId: "ppt_asset_manifest", status: "passed" }),
    ]));
  });

  it("rejects an incomplete PPT asset manifest even when the adapter claims success", () => {
    const tool = getToolDefinitions().find((definition) => definition.capabilityId === "ppt_sample_assets")!;
    const fixtures = validPptSampleFixtures();
    fixtures.manifest.entries.pop();
    const report = validateToolExecutionResult({
      tool,
      projectId: "project-ppt-sample-assets-invalid",
      result: {
        status: "succeeded",
        artifactTruth: { created: true, persisted: true, placeholder: false, producedArtifactKind: "image_prompts" },
        qualityGate: { passed: true, gates: ["adapter_claimed_success"] },
        artifactDraft: {
          nodeKey: "image_prompts",
          kind: "image_prompts",
          title: "不完整 PPT 资产批次",
          summary: "缺少资产。",
          structuredContent: {
            pptAssetRequestBatch: fixtures.requestBatch,
            pptAssetManifest: fixtures.manifest,
          },
        },
      },
    });

    expect(report.overallStatus).toBe("failed");
    expect(report.gates).toContainEqual(expect.objectContaining({
      gateId: "ppt_asset_manifest",
      status: "failed",
      reasonCode: "ppt_asset_manifest_invalid",
    }));
  });

  it("rejects a tampered PPT key sample candidate before persistence", () => {
    const tool = getToolDefinitions().find((definition) => definition.capabilityId === "ppt_key_samples")!;
    const fixtures = validPptSampleFixtures();
    const candidate = buildPptKeySampleCandidate({
      designPackage: fixtures.designPackage,
      requestBatch: fixtures.requestBatch,
      manifest: fixtures.manifest,
      composition: {
        pptxBuffer: Buffer.from("PK candidate"),
        pptxSha256: fixtures.sampleSet.samplePptx.sha256,
        pageEvidence: fixtures.sampleSet.assembledPages.map(({ renderRef: _renderRef, renderSha256: _renderSha256, ...page }) => page),
      },
      renderEvidence: {
        samplePptx: fixtures.sampleSet.samplePptx,
        pageRenders: fixtures.sampleSet.assembledPages.map((page) => ({ pageId: page.pageId, storageRef: page.renderRef, sha256: page.renderSha256 })),
        overviews: fixtures.sampleSet.overviews,
      },
    });
    candidate.assembledPages[0].renderRef = "tampered.png";
    const report = validateToolExecutionResult({
      tool,
      projectId: "project-ppt-sample-candidate-invalid",
      result: {
        status: "succeeded",
        artifactDraft: {
          nodeKey: "image_prompts",
          kind: "image_prompts",
          title: "被篡改样张",
          summary: "被篡改。",
          structuredContent: { pptKeySampleCandidate: candidate },
        },
      },
    });

    expect(report.overallStatus).toBe("failed");
    expect(report.gates).toContainEqual(expect.objectContaining({
      gateId: "ppt_key_sample_candidate",
      status: "failed",
      reasonCode: "ppt_key_sample_candidate_invalid",
    }));
  });

  it("hashes equivalent structured PPT packages deterministically", () => {
    const packageValue = validPptDesignPackage();
    const first = {
      nodeKey: "ppt_design_draft",
      kind: "ppt_design_draft",
      title: "PPT 设计包",
      summary: "12 页。",
      structuredContent: { generationMode: "model_generated", pptDesignPackage: packageValue },
    };
    const second = {
      ...first,
      structuredContent: { pptDesignPackage: packageValue, generationMode: "model_generated" },
    };

    expect(hashArtifactDraft(second)).toBe(hashArtifactDraft(first));
  });

  it("keeps report digests stable across IDs, timestamps and object key order", () => {
    const base = {
      domain: "ppt" as const,
      stage: "ppt_design",
      target: { kind: "artifact_draft" as const, targetDigest: "draft-digest" },
      contract: { id: "tool:create_ppt_design_draft", version: "v1" },
      overallStatus: "passed" as const,
      gates: [{
        gateId: "output_kind",
        validatorId: "runtime_contract",
        validatorVersion: "v1",
        status: "passed" as const,
        evidenceRefs: ["artifact:draft"],
        locators: [{ kind: "artifact" as const, artifactKind: "ppt_design_draft" }],
        responsibleStage: "ppt_design",
      }],
    };
    const first = createValidationReport({ ...base, reportId: "report-a", createdAt: "2026-07-12T00:00:00.000Z" });
    const second = createValidationReport({ ...base, reportId: "report-b", createdAt: "2026-07-12T01:00:00.000Z" });
    expect(second.reportDigest).toBe(first.reportDigest);
  });

  it.each([
    [{ toolName: "unknown", projectId: "project-unknown" }, "unknown"],
    [{ toolName: "intro_video", projectId: "project-blocked" }, "intro_video"],
    [{ toolName: "create_requirement_spec", projectId: "project-context" }, "requirement_spec"],
  ])("returns a failed ValidationReport for non-executable route outcome %#", async (input, stage) => {
    const result = await routeToolCall(input);
    expect(result.validationReport).toMatchObject({
      authority: "deterministic",
      overallStatus: "failed",
      stage,
    });
  });
});
