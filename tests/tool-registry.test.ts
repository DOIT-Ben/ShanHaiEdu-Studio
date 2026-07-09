import { describe, expect, it } from "vitest";
import { getToolDefinition, getToolDefinitionByCapabilityId, listToolDefinitions } from "@/server/tools/tool-registry";
import { toolDefinitionToOpenAiFunctionTool } from "@/server/tools/openai-tool-schema";

function expectStrictJsonSchema(schema: unknown): void {
  if (!schema || typeof schema !== "object") return;

  const objectSchema = schema as Record<string, unknown>;
  if (objectSchema.type === "object") {
    expect(objectSchema.additionalProperties).toBe(false);
    expect(Array.isArray(objectSchema.required)).toBe(true);
  }

  const properties = objectSchema.properties;
  if (properties && typeof properties === "object") {
    for (const nestedSchema of Object.values(properties)) {
      expectStrictJsonSchema(nestedSchema);
    }
  }

  expectStrictJsonSchema(objectSchema.items);
}

describe("ToolRegistry", () => {
  it("registers the full first-batch internal and provider tools with stable ids", () => {
    expect(listToolDefinitions().map((tool) => tool.id)).toEqual([
      "create_requirement_spec",
      "create_lesson_plan",
      "create_ppt_outline",
      "create_ppt_design_draft",
      "extract_knowledge_anchors",
      "generate_intro_creative_themes",
      "generate_intro_video_script",
      "generate_video_storyboard",
      "generate_video_asset_brief",
      "plan_video_segments",
      "intro_video",
      "asset_image_generate",
      "concat_only_assemble",
      "create_final_delivery_checklist",
      "generate_pptx_from_design",
    ]);
  });

  it("keeps provider tool routing fields explicit for executable provider tools", () => {
    expect(getToolDefinition("generate_pptx_from_design")).toMatchObject({
      adapterKind: "provider",
      capabilityId: "coze_ppt",
      providerToolId: "coze_ppt.generate_pptx",
      implemented: true,
      requiredArtifactKinds: ["ppt_design_draft"],
      producedArtifactKind: "pptx_artifact",
    });
  });

  it("finds tools by capability id", () => {
    expect(getToolDefinitionByCapabilityId("lesson_plan")).toMatchObject({
      id: "create_lesson_plan",
      adapterKind: "internal_capability",
      requiredArtifactKinds: ["requirement_spec"],
      producedArtifactKind: "lesson_plan",
      requiresHumanGate: true,
    });
  });

  it("requires all minimal final delivery artifacts before creating the final delivery checklist", () => {
    const tool = getToolDefinition("create_final_delivery_checklist");

    expect(tool).toMatchObject({
      capabilityId: "final_package",
      implemented: true,
      requiredArtifactKinds: [
        "requirement_spec",
        "lesson_plan",
        "ppt_design_draft",
        "pptx_artifact",
        "concat_only_assemble",
      ],
      producedArtifactKind: "final_delivery",
    });
    expect(tool.inputSchema.required).toEqual(["projectId", "artifactRefs"]);
  });

  it("registers blocked definitions without making deferred tools executable", () => {
    for (const capabilityId of ["intro_video", "asset_image_generate", "concat_only_assemble"] as const) {
      const tool = getToolDefinitionByCapabilityId(capabilityId);

      expect(tool).toMatchObject({ capabilityId, implemented: false });
      expect(tool.blockedReason).toEqual(expect.any(String));
      expect(tool.blockedReason).not.toHaveLength(0);
      expect(tool.providerToolId).toBeUndefined();
      expect(tool.mcpServerId).toBeUndefined();
      expect(tool.mcpToolName).toBeUndefined();
    }
  });

  it("returns blocked definitions by capability id so router can inspect them", () => {
    expect(getToolDefinitionByCapabilityId("asset_image_generate")).toMatchObject({
      id: "asset_image_generate",
      capabilityId: "asset_image_generate",
      implemented: false,
    });
  });

  it("keeps every registered tool schema strict", () => {
    for (const tool of listToolDefinitions()) {
      for (const schema of [tool.inputSchema, tool.outputSchema]) {
        expectStrictJsonSchema(schema);
      }
    }
  });

  it("exports safe OpenAI function tool schema without provider or storage terms", () => {
    const schema = toolDefinitionToOpenAiFunctionTool(getToolDefinition("generate_pptx_from_design"));

    expect(schema).toMatchObject({
      type: "function",
      name: "generate_pptx_from_design",
      strict: true,
      parameters: expect.objectContaining({ additionalProperties: false }),
    });
    expect(JSON.stringify(schema)).not.toMatch(/provider|storage|runtimeKind|debug|token|API_KEY|SECRET|local path/i);

    for (const tool of listToolDefinitions().filter((definition) => definition.implemented)) {
      const implementedSchema = toolDefinitionToOpenAiFunctionTool(tool);

      expect(implementedSchema.strict).toBe(true);
      expect(implementedSchema.parameters.additionalProperties).toBe(false);
      expect(JSON.stringify(implementedSchema)).not.toMatch(/provider|storage|runtimeKind|debug|token|API_KEY|SECRET|local path/i);
    }
  });

  it("does not expose blocked definitions as OpenAI executable tools", () => {
    expect(() => toolDefinitionToOpenAiFunctionTool(getToolDefinition("asset_image_generate"))).toThrow(/not implemented/i);
  });
});
