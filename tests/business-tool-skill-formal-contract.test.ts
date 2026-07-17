import { describe, expect, it, vi } from "vitest";

import { listBusinessToolSkillPolicies, resolveBusinessToolSkillPolicy } from "@/server/skills/business-tool-skill-bindings";
import {
  BusinessToolSkillOutputContractError,
  hasFormalBusinessToolOutputAdapter,
  listFormalBusinessToolOutputAdapters,
  projectFormalBusinessToolSkillOutput,
  validateFormalBusinessToolSkillOutput,
  type FormalBusinessToolOutputContract,
} from "@/server/skills/business-tool-skill-output-contract";
import type { ToolExecutionResult } from "@/server/tools/tool-types";

const SHA = {
  raw: "a".repeat(64),
  delivery: "b".repeat(64),
  prompt: "c".repeat(64),
  package: "d".repeat(64),
  manifest: "e".repeat(64),
};

const contracts = {
  image: contract("shanhai-imagegen", "1.1", "image-generation-result", "shanhai-imagegen/v2"),
  video: contract("shanhai-video-generation", "1.1", "video-generation-result", "shanhai-video-generation/v2"),
  delivery: contract("shanhai-delivery", "1.3", "delivery-package", "shanhai-delivery/v2"),
};

describe("A23 formal business Tool output adapters", () => {
  it.each([
    "create_lesson_plan",
    "create_ppt_outline",
    "create_video_course_anchor",
    "generate_intro_creative_themes",
  ])("uses TaskBrief rather than a fabricated requirement_spec consume contract for %s", (toolName) => {
    const policy = resolveBusinessToolSkillPolicy(toolName);
    expect(policy).toBeDefined();
    if (!policy || policy.mode === "exempt") throw new Error(`Missing semantic Tool contract for ${toolName}`);
    expect(policy.contracts.tool.consumes).toEqual([]);
  });

  it("registers every produce adapter declared by the six formal_contract Tool policies", () => {
    const policies = listBusinessToolSkillPolicies().filter((policy) => policy.mode === "skill");
    const formalToolNames = policies.map((policy) => policy.toolName).sort();

    expect(formalToolNames).toEqual([
      "create_final_package",
      "generate_classroom_image",
      "generate_ppt_full_assets",
      "generate_ppt_sample_assets",
      "generate_video_assets",
      "generate_video_shot",
    ]);
    for (const policy of policies) {
      for (const produced of policy.artifactCompatibility.produces) {
        expect(hasFormalBusinessToolOutputAdapter(produced.adapterId, policy.toolName)).toBe(true);
      }
    }
    expect(listFormalBusinessToolOutputAdapters()).toHaveLength(4);
  });

  it("projects a real single-image result to the image v2 fact, lineage, and quality payload", () => {
    const projected = projectFormalBusinessToolSkillOutput({
      adapterId: "image-result-single.v2",
      businessToolName: "generate_classroom_image",
      contract: contracts.image,
      result: singleImageResult(),
    });

    expect(projected).toEqual({
      adapterId: "image-result-single.v2",
      businessToolName: "generate_classroom_image",
      contract: contracts.image,
      payload: {
        schemaVersion: "shanhai-imagegen/v2",
        mode: "single",
        sourceArtifactIds: ["ppt-outline-7"],
        assets: [{
          assetId: `image-${SHA.delivery.slice(0, 16)}`,
          targetRefs: ["ppt-outline-7"],
          provider: { name: "minimax", model: "image-01" },
          promptDigest: SHA.prompt,
          sourceArtifactIds: ["ppt-outline-7"],
          rawFile: file("raw.png", "image/raw.png", SHA.raw, 1024),
          deliveryFile: file("visual.png", "image/visual.png", SHA.delivery, 2048),
          processingChain: [],
          validation: { status: "PASSED", evidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
        }],
      },
    });
    expect(JSON.stringify(projected)).not.toMatch(/nextTool|nextAction|fallback|retry|stop|providerTaskId/i);
  });

  it("projects PPT image batches deterministically without leaking provider task control fields", () => {
    const result = pptImageBatchResult();
    const first = projectFormalBusinessToolSkillOutput({
      adapterId: "image-result-batch.v2",
      businessToolName: "generate_ppt_sample_assets",
      contract: contracts.image,
      result,
    });
    const second = projectFormalBusinessToolSkillOutput({
      adapterId: "image-result-batch.v2",
      businessToolName: "generate_ppt_sample_assets",
      contract: contracts.image,
      result,
    });

    expect(second).toEqual(first);
    expect(first.payload).toMatchObject({
      schemaVersion: "shanhai-imagegen/v2",
      mode: "batch",
      sourceArtifactIds: ["ppt-design-9"],
      assets: [
        { assetId: "asset-a", targetRefs: ["page-1"], provider: { name: "minimax", model: "image-01" } },
        { assetId: "asset-b", targetRefs: ["page-2"], provider: { name: "minimax", model: "image-01" } },
      ],
    });
    expect(JSON.stringify(first)).not.toContain("providerTaskId");
    expect(JSON.stringify(first)).not.toContain("clientRequestId");
  });

  it("projects one video shot and a persisted final package without adding orchestration decisions", () => {
    const video = projectFormalBusinessToolSkillOutput({
      adapterId: "video-result-single-shot.v2",
      businessToolName: "generate_video_shot",
      contract: contracts.video,
      result: videoResult(),
    });
    expect(video.payload).toEqual({
      schemaVersion: "shanhai-video-generation/v2",
      shots: [{
        shotId: "shot_01",
        provider: { name: "evolink", model: "grok-imagine-video" },
        requestedDurationSeconds: 10,
        sourceArtifactIds: ["segment-plan-1", "storyboard-1", "asset-image-1"],
        referenceArtifactIds: ["asset-main"],
        file: file("shot-01.mp4", "video/shot-01.mp4", SHA.delivery, 4096, "video/mp4", 1920, 1080),
        validation: { status: "PASSED", evidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
      }],
    });

    const delivery = projectFormalBusinessToolSkillOutput({
      adapterId: "delivery-result-package.v2",
      businessToolName: "create_final_package",
      contract: contracts.delivery,
      result: deliveryResult(),
    });
    expect(delivery.payload).toMatchObject({
      schemaVersion: "shanhai-delivery/v2",
      finalPackageManifest: {
        schemaVersion: "final-package-manifest.v1",
        courseVersionId: "course-v7",
        requiredRoles: ["lesson_plan", "pptx", "pdf", "image", "video"],
      },
      classroomRunSpec: { schemaVersion: "classroom-run-spec.v1", courseVersionId: "course-v7" },
      packageAsset: {
        fileName: "course-v7.zip",
        localOutput: "packages/course-v7.zip",
        sha256: SHA.package,
        manifestSha256: SHA.manifest,
        sourceArtifactIds: ["requirement-1", "lesson-1", "ppt-design-1", "pptx-1", "image-1", "narration-1", "video-1"],
      },
      validation: { status: "PASSED", evidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(JSON.stringify({ video, delivery })).not.toMatch(/nextTool|nextAction|fallback|retry|stop/i);
  });

  it("fails closed for unknown adapters, wrong Tool ownership, and mismatched contract identity", () => {
    expect(() => projectFormalBusinessToolSkillOutput({
      adapterId: "missing-adapter.v9",
      businessToolName: "generate_classroom_image",
      contract: contracts.image,
      result: singleImageResult(),
    })).toThrowError(expect.objectContaining({ reasonCode: "formal_skill_output_adapter_unknown" }));

    expect(() => projectFormalBusinessToolSkillOutput({
      adapterId: "image-result-batch.v2",
      businessToolName: "generate_classroom_image",
      contract: contracts.image,
      result: singleImageResult(),
    })).toThrowError(expect.objectContaining({ reasonCode: "formal_skill_output_adapter_tool_mismatch" }));

    expect(() => projectFormalBusinessToolSkillOutput({
      adapterId: "image-result-single.v2",
      businessToolName: "generate_classroom_image",
      contract: { ...contracts.image, contractVersion: "shanhai-imagegen/v1" },
      result: singleImageResult(),
    })).toThrowError(expect.objectContaining({ reasonCode: "formal_skill_output_contract_mismatch" }));
  });

  it("passes only payload and contract identity to an injected schema validator and fails on invalid output", () => {
    const schema = { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" };
    const contractSchema = {
      artifactType: contracts.image.artifactType,
      contractVersion: contracts.image.contractVersion,
      schema,
      schemaSha256: `sha256:${"f".repeat(64)}`,
    };
    const validator = vi.fn(() => ({ valid: true as const, errors: [] }));
    const validated = validateFormalBusinessToolSkillOutput({
      adapterId: "image-result-single.v2",
      businessToolName: "generate_video_assets",
      contract: contracts.image,
      result: singleImageResult("asset_image_generate"),
      contractSchema,
      validator,
    });

    expect(validated.payload).toMatchObject({ schemaVersion: "shanhai-imagegen/v2", mode: "single" });
    expect(validator).toHaveBeenCalledWith({ schema, contract: contracts.image, payload: validated.payload });
    expect(validated).not.toHaveProperty("schema");
    expect(validated.schemaSha256).toBe(contractSchema.schemaSha256);

    expect(() => validateFormalBusinessToolSkillOutput({
      adapterId: "image-result-single.v2",
      businessToolName: "generate_video_assets",
      contract: contracts.image,
      result: singleImageResult("asset_image_generate"),
      contractSchema,
      validator: () => ({ valid: false, errors: ["assets/0/provider/model is required"] }),
    })).toThrowError(expect.objectContaining({
      reasonCode: "formal_skill_output_schema_invalid",
      validationErrors: ["assets/0/provider/model is required"],
    }));
  });

  it("fails closed when producer facts required by the formal contract are absent", () => {
    const result = videoResult();
    delete (result.providerPayload as Record<string, unknown>).model;
    expect(() => projectFormalBusinessToolSkillOutput({
      adapterId: "video-result-single-shot.v2",
      businessToolName: "generate_video_shot",
      contract: contracts.video,
      result,
    })).toThrowError(BusinessToolSkillOutputContractError);
    expect(() => projectFormalBusinessToolSkillOutput({
      adapterId: "video-result-single-shot.v2",
      businessToolName: "generate_video_shot",
      contract: contracts.video,
      result,
    })).toThrowError(expect.objectContaining({ reasonCode: "formal_skill_output_source_invalid" }));
  });
});

function contract(
  skillName: string,
  skillVersion: string,
  artifactType: string,
  contractVersion: string,
): FormalBusinessToolOutputContract {
  return { skillName, skillVersion, artifactType, contractVersion };
}

function singleImageResult(toolId = "generate_classroom_image") {
  const rawFile = file("raw.png", "image/raw.png", SHA.raw, 1024);
  const deliveryFile = file("visual.png", "image/visual.png", SHA.delivery, 2048);
  return successResult(toolId, {
    storage: {
      imageAsset: {
        ...deliveryFile,
        localOutput: deliveryFile.storageRef,
        provider: "minimax",
        model: "image-01",
        promptDigest: SHA.prompt,
        rawAsset: { ...rawFile, localOutput: rawFile.storageRef },
        normalizedAsset: { ...deliveryFile, localOutput: deliveryFile.storageRef },
        sourceArtifactId: "ppt-outline-7",
      },
    },
  }, {
    provider: "minimax",
    model: "image-01",
  });
}

function pptImageBatchResult() {
  const entry = (assetId: string, pageId: string) => ({
    assetId,
    pageIds: [pageId],
    provider: "minimax",
    model: "image-01",
    promptDigest: SHA.prompt,
    referenceAssetIds: [],
    providerTaskId: "must-not-leak",
    clientRequestId: "must-not-leak",
    rawAsset: { ...file(`${assetId}-raw.png`, `image/${assetId}-raw.png`, SHA.raw, 1024), storageRef: `image/${assetId}-raw.png` },
    normalizedAsset: { ...file(`${assetId}.png`, `image/${assetId}.png`, SHA.delivery, 2048), storageRef: `image/${assetId}.png` },
    processingChain: [{ operation: "resize", sourceSha256: SHA.raw, targetSha256: SHA.delivery }],
  });
  return successResult("generate_ppt_sample_assets", {
    pptAssetManifest: { entries: [entry("asset-b", "page-2"), entry("asset-a", "page-1")] },
    storage: { pptAssetBundle: { sourceArtifactId: "ppt-design-9" } },
  }, { provider: "minimax" });
}

function videoResult() {
  return successResult("generate_video_segment", {
    storage: {
      videoAsset: {
        ...file("shot-01.mp4", "video/shot-01.mp4", SHA.delivery, 4096, "video/mp4", 1920, 1080),
        localOutput: "video/shot-01.mp4",
        sourceArtifactIds: ["segment-plan-1", "storyboard-1", "asset-image-1"],
        requestEvidence: {
          shotId: "shot_01",
          durationSeconds: 10,
          references: [{ assetId: "asset-main" }],
        },
      },
    },
  }, { provider: "evolink", model: "grok-imagine-video" }, "video_segment_generate");
}

function deliveryResult() {
  const manifestFiles = Object.fromEntries(["lesson_plan", "pptx", "pdf", "image", "video"].map((role, index) => [role, {
    fileName: `${role}.bin`,
    bytes: 100 + index,
    sha256: SHA.delivery,
    deliveryStatus: "final_eligible",
    sourceArtifactId: `${role}-1`,
    sourceArtifactVersion: 1,
    sourceArtifactDigest: SHA.raw,
  }]));
  return successResult("create_final_package", {
    finalPackageManifest: {
      schemaVersion: "final-package-manifest.v1",
      courseVersionId: "course-v7",
      courseAnchor: "唯一最小课程回接",
      reviewBatchId: "review-7",
      pptSlideCount: 8,
      packageStatus: "integration_review_passed",
      teacherSignoff: false,
      requiredRoles: ["lesson_plan", "pptx", "pdf", "image", "video"],
      files: manifestFiles,
    },
    classroomRunSpec: {
      schemaVersion: "classroom-run-spec.v1",
      courseVersionId: "course-v7",
      courseAnchor: "唯一最小课程回接",
      reviewBatchId: "review-7",
      pptSlideCount: 8,
      sequence: [{ ordinal: 1, action: "play_intro_video", artifactRole: "video", instruction: "播放独立短片。" }],
    },
    storage: {
      packageAsset: {
        fileName: "course-v7.zip",
        localOutput: "packages/course-v7.zip",
        bytes: 8192,
        sha256: SHA.package,
        manifestSha256: SHA.manifest,
        mime: "application/zip",
        generationMode: "versioned_final_package_generated",
        sourceArtifactIds: ["requirement-1", "lesson-1", "ppt-design-1", "pptx-1", "image-1", "narration-1", "video-1"],
      },
    },
  }, {}, "final_delivery");
}

function successResult(
  toolId: string,
  structuredContent: Record<string, unknown>,
  providerPayload: Record<string, unknown>,
  artifactKind = "image_prompts",
): Extract<ToolExecutionResult, { status: "succeeded" }> {
  const artifactTruth = {
    created: true,
    persisted: true,
    providerPersisted: true,
    workbenchPersisted: false,
    placeholder: false,
    producedArtifactKind: artifactKind,
  } as const;
  const qualityGate = {
    passed: true,
    gates: artifactKind === "video_segment_generate"
      ? ["video_valid", "mp4_moov_present"]
      : toolId === "create_final_package"
        ? ["version_binding_verified", "manifest_reverse_verified"]
        : ["image_valid", "raw_and_normalized_lineage_complete"],
  };
  return {
    status: "succeeded",
    toolId,
    capabilityId: artifactKind,
    provider: typeof providerPayload.provider === "string" ? providerPayload.provider : undefined,
    artifactDraft: {
      nodeKey: artifactKind,
      kind: artifactKind,
      title: "formal output fixture",
      summary: "formal output fixture",
      structuredContent: { ...structuredContent, artifactTruth, qualityGate },
    },
    artifactTruth,
    qualityGate,
    providerPayload: { ...providerPayload, artifactTruth, qualityGate },
    assistantSummary: "formal output fixture",
    budgetEvent: {
      kind: "tool_succeeded",
      status: "succeeded",
      capabilityId: artifactKind,
      actionKey: toolId,
      providerSubmitted: true,
      createdAt: "2026-07-15T00:00:00.000Z",
    },
  };
}

function file(
  fileName: string,
  storageRef: string,
  sha256: string,
  bytes: number,
  mime = "image/png",
  width = 1920,
  height = 1080,
) {
  return { fileName, storageRef, bytes, sha256, mime, width, height };
}
