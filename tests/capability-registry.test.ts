import { describe, expect, it } from "vitest";
import { getCapabilityDefinitions, getCapabilityDefinition } from "@/server/capabilities/capability-registry";

describe("M54-B CapabilityRegistry", () => {
  it("registers the first ShanHaiEdu delivery capabilities", () => {
    const ids = getCapabilityDefinitions().map((capability) => capability.id);

    expect(ids).toEqual([
      "requirement_spec",
      "lesson_plan",
      "ppt_outline",
      "ppt_design",
      "coze_ppt",
      "ppt_sample_assets",
      "ppt_key_samples",
      "ppt_full_deck",
      "ppt_page_repair",
      "ppt_full_assets",
      "image_asset",
      "intro_video",
      "knowledge_anchor_extract",
      "creative_theme_generate",
      "video_script_generate",
      "storyboard_generate",
      "asset_brief_generate",
      "asset_image_generate",
      "video_segment_plan",
      "video_segment_generate",
      "video_narration_generate",
      "concat_only_assemble",
      "final_package",
    ]);
  });

  it("keeps capability definitions user-readable and free of secrets", () => {
    for (const capability of getCapabilityDefinitions()) {
      expect(capability.userLabel.trim().length).toBeGreaterThan(0);
      expect(capability.description.trim().length).toBeGreaterThan(0);
      expect(capability.artifactKind.trim().length).toBeGreaterThan(0);
      expect(capability.workflowNodeKey.trim().length).toBeGreaterThan(0);

      const serialized = JSON.stringify(capability).toLowerCase();
      for (const forbidden of ["secret", "token", "api_key", "apikey", "sk-", "credential"]) {
        expect(serialized).not.toContain(forbidden);
      }
    }
  });

  it("marks external provider capabilities as confirmation-gated", () => {
    const cozePpt = getCapabilityDefinition("coze_ppt");
    const imageAsset = getCapabilityDefinition("image_asset");
    const introVideo = getCapabilityDefinition("intro_video");

    const pptDesign = getCapabilityDefinition("ppt_design");

    expect(pptDesign.upstreamCapabilities).toContain("ppt_outline");
    expect(cozePpt.upstreamCapabilities).toContain("ppt_design");
    expect(cozePpt.requiresConfirmation).toBe(true);
    expect(imageAsset.requiresConfirmation).toBe(true);
    expect(introVideo.requiresConfirmation).toBe(true);
  });
});
