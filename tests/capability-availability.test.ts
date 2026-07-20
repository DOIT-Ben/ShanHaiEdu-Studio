import { describe, expect, it } from "vitest";
import { buildCapabilityAvailability, resolveRuntimeProviderAvailability } from "@/server/capabilities/capability-availability";
import { getCapabilityDefinitions } from "@/server/capabilities/capability-registry";
import type { CapabilityId } from "@/server/capabilities/types";
import { createTaskBrief } from "@/server/conversation/task-contract";
import type { ArtifactRecord } from "@/server/workbench/types";

const definitions = getCapabilityDefinitions();
function approvedArtifactFor(capabilityId: CapabilityId): ArtifactRecord {
  const capability = definitions.find((definition) => definition.id === capabilityId);
  if (!capability) {
    throw new Error(`Unknown capability in test: ${capabilityId}`);
  }

  return {
    id: `artifact-${capabilityId}`,
    projectId: "project-a",
    nodeKey: capability.artifactKind as ArtifactRecord["nodeKey"],
    title: capability.userLabel,
    kind: capability.artifactKind as ArtifactRecord["kind"],
    status: "approved",
    summary: "已确认",
    markdownContent: "# 已确认",
    structuredContent: {},
    version: 1,
    isApproved: true,
    createdAt: "2026-07-09T00:00:00.000Z",
    updatedAt: "2026-07-09T00:00:00.000Z",
  };
}

function internallyValidatedArtifactFor(capabilityId: CapabilityId): ArtifactRecord {
  const artifact = approvedArtifactFor(capabilityId);
  return {
    ...artifact,
    status: "needs_review",
    isApproved: false,
    structuredContent: {
      artifactQualityState: {
        validationStatus: "passed",
        reviewStatus: "passed",
        downstreamEligibility: "eligible",
      },
    },
  };
}

function entryFor(capabilityId: CapabilityId, artifacts: ArtifactRecord[] = [], providerAvailability?: Partial<Record<CapabilityId, boolean>>) {
  const entries = buildCapabilityAvailability({
    capabilityDefinitions: definitions,
    artifacts,
    providerAvailability,
  });

  const entry = entries.find((candidate) => candidate.capabilityId === capabilityId);
  if (!entry) {
    throw new Error(`Missing availability entry: ${capabilityId}`);
  }
  return entry;
}

describe("CapabilityAvailability", () => {
  it("marks a TaskBrief-sufficient internal capability available without a fabricated prerequisite", () => {
    const entry = entryFor("lesson_plan");

    expect(entry).toMatchObject({
      capabilityId: "lesson_plan",
      status: "available",
      requiresConfirmation: true,
      missingApprovedInputs: [],
    });
  });

  it("accepts an internally validated artifact for downstream work without teacher approval", () => {
    const entry = entryFor("ppt_design", [internallyValidatedArtifactFor("ppt_outline")]);

    expect(entry).toMatchObject({
      status: "available",
      missingApprovedInputs: [],
    });
  });

  it("marks an internal capability as needing approved upstream inputs when they are missing", () => {
    const entry = entryFor("ppt_design");

    expect(entry.status).toBe("needs_approved_inputs");
    expect(entry.missingApprovedInputs).toEqual(["ppt_outline"]);
    expect(entry.reasonForUser).toContain("PPT 大纲");
    expect(entry.reasonForUser).not.toBe("请先确认前置成果后再继续。");
  });

  it("explains the minimum input needed when the teacher asks for only a video script", () => {
    const entry = entryFor("video_script_generate");

    expect(entry.status).toBe("needs_approved_inputs");
    expect(entry.missingApprovedInputs).toEqual(["creative_theme_generate"]);
    expect(entry.reasonForUser).toContain("可以只做视频脚本");
    expect(entry.reasonForUser).toContain("导入创意主题");
    expect(entry.reasonForUser).toMatch(/年级.*课题.*导入情境/);
    expect(entry.reasonForUser).toContain("不会继续生成 PPT 或最终视频");
  });

  it("marks blocked external capabilities provider unavailable by default", () => {
    const entry = entryFor("coze_ppt", [approvedArtifactFor("ppt_design")]);

    expect(entry.status).toBe("provider_unavailable");
    expect(entry.reasonForModel).toContain("provider_unavailable");
    expect(entry.reasonForUser.toLowerCase()).not.toMatch(/provider|schema|storage|debug|local path|token/);
  });

  it("marks a blocked external capability available when provider availability is explicitly enabled", () => {
    const entry = entryFor("coze_ppt", [approvedArtifactFor("ppt_design")], { coze_ppt: true });

    expect(entry.status).toBe("available");
  });

  it("does not make asset_image_generate immediately available by default", () => {
    const entry = entryFor("asset_image_generate", [approvedArtifactFor("asset_brief_generate")]);

    expect(entry.status).not.toBe("available");
    expect(["provider_unavailable", "needs_approved_inputs"]).toContain(entry.status);
  });

  it("requires every trusted input before package assembly becomes available", () => {
    const incompleteEntry = entryFor("concat_only_assemble", [
      approvedArtifactFor("video_segment_generate"),
      approvedArtifactFor("storyboard_generate"),
      approvedArtifactFor("video_script_generate"),
    ]);

    expect(incompleteEntry).toMatchObject({
      status: "needs_approved_inputs",
      missingApprovedInputs: ["video_narration_generate"],
    });

    const availableEntry = entryFor("concat_only_assemble", [
      approvedArtifactFor("video_segment_generate"),
      approvedArtifactFor("storyboard_generate"),
      approvedArtifactFor("video_script_generate"),
      approvedArtifactFor("video_narration_generate"),
    ]);

    expect(availableEntry).toMatchObject({
      status: "available",
      missingApprovedInputs: [],
    });
    expect(availableEntry.reasonForUser.toLowerCase()).not.toMatch(/provider|schema|storage|debug|local path|token/);
  });

  it("marks implemented external generation providers available only when matching runtime env exists", () => {
    const availability = resolveRuntimeProviderAvailability({
      COZE_PPT_USE_CLI: "1",
      NODE_ENV: "test",
       SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS: "1",
       MODEL_GATEWAY_API_KEY: "test-key",
       MODEL_GATEWAY_BASE_URL: "https://gateway.example/v1",
       MODEL_GATEWAY_IMAGE_MODEL: "image-2",
       MODEL_GATEWAY_VIDEO_MODEL: "video-grok",
    });

    expect(availability).toMatchObject({
      coze_ppt: true,
      image_asset: true,
      video_segment_generate: true,
    });
    expect(availability.asset_image_generate).toBeUndefined();
    expect(availability.concat_only_assemble).toBeUndefined();
  });

  it("blocks capabilities outside the requested and excluded TaskBrief scope", () => {
    const taskBrief = createTaskBrief({
      taskId: "task-ppt-only", projectId: "project-a", intentEpoch: 0,
      goal: "只做PPT，不做教案", requestedOutputs: ["ppt"], constraints: [], excludedOutputs: ["lesson_plan"],
      generationIntensity: "standard", sourceMessageId: "message-ppt-only",
    });
    const entries = buildCapabilityAvailability({ capabilityDefinitions: definitions, artifacts: [], taskBrief });

    expect(entries.find((entry) => entry.capabilityId === "ppt_outline")).toMatchObject({ status: "available" });
    expect(entries.find((entry) => entry.capabilityId === "lesson_plan")).toMatchObject({
      status: "blocked",
      reasonForModel: expect.stringContaining("task_scope_mismatch"),
    });
  });

  it("recognizes the unified model gateway image contract", () => {
    const availability = resolveRuntimeProviderAvailability({
      NODE_ENV: "test",
       SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS: "1",
       MODEL_GATEWAY_API_KEY: "gateway-test-key",
       MODEL_GATEWAY_BASE_URL: "https://gateway.example/v1",
       MODEL_GATEWAY_IMAGE_MODEL: "image-2",
    });

    expect(availability).toMatchObject({
      image_asset: true,
      ppt_sample_assets: true,
      ppt_full_assets: true,
    });
  });
});
