import { describe, expect, it } from "vitest";
import { getToolDefinition, getToolDefinitionByCapabilityId, listToolDefinitions } from "@/server/tools/tool-registry";
import { toolDefinitionToOpenAiFunctionTool } from "@/server/tools/openai-tool-schema";

describe("ToolRegistry", () => {
  it("registers first-batch internal and provider tools with stable ids", () => {
    expect(listToolDefinitions().map((tool) => tool.id)).toEqual(expect.arrayContaining([
      "create_requirement_spec",
      "create_lesson_plan",
      "create_ppt_outline",
      "create_ppt_design_draft",
      "generate_pptx_from_design",
    ]));
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

  it("exports safe OpenAI function tool schema without provider or storage terms", () => {
    const schema = toolDefinitionToOpenAiFunctionTool(getToolDefinition("generate_pptx_from_design"));

    expect(schema).toMatchObject({
      type: "function",
      name: "generate_pptx_from_design",
      strict: true,
      parameters: expect.objectContaining({ additionalProperties: false }),
    });
    expect(JSON.stringify(schema)).not.toMatch(/provider|storage|runtimeKind|debug|token|API_KEY|SECRET|local path/i);
  });
});
