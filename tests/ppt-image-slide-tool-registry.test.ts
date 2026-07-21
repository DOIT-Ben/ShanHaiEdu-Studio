import { describe, expect, it } from "vitest";
import { getToolDefinition, listToolDefinitions } from "@/server/tools/tool-registry";

describe("FrameFlow image-slide PPT tools", () => {
  it("registers two independent new tools while retaining the legacy PPT tools", () => {
    expect(getToolDefinition("generate_ppt_page_images")).toMatchObject({ capabilityId: "ppt_image_slides", producedArtifactKind: "ppt_page_images", requiredArtifactKinds: ["ppt_design_draft"] });
    expect(getToolDefinition("assemble_ppt_image_slides")).toMatchObject({ capabilityId: "ppt_image_slide_assembly", producedArtifactKind: "pptx_artifact", requiredArtifactKinds: ["ppt_design_draft", "ppt_page_images"] });
    expect(listToolDefinitions().some((tool) => tool.id === "generate_pptx_from_design")).toBe(true);
    expect(listToolDefinitions().some((tool) => tool.id === "assemble_ppt_full_deck")).toBe(true);
  });
});
