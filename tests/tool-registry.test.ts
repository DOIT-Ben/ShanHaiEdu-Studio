import { describe, expect, it } from "vitest";
import { getToolDefinition, getToolDefinitionByCapabilityId, listToolDefinitions } from "@/server/tools/tool-registry";
import { toolDefinitionToOpenAiFunctionTool } from "@/server/tools/openai-tool-schema";
import type { ToolDefinition } from "@/server/tools/tool-types";

function expectStrictJsonSchema(schema: unknown): void {
  if (!schema || typeof schema !== "object") return;

  const objectSchema = schema as Record<string, unknown>;
  if (objectSchema.type === "object") {
    expect(objectSchema.additionalProperties).toBe(false);
    expect(Array.isArray(objectSchema.required)).toBe(true);
    const propertyKeys = Object.keys((objectSchema.properties as Record<string, unknown> | undefined) ?? {});
    expect(new Set(objectSchema.required as string[])).toEqual(new Set(propertyKeys));
  }

  const properties = objectSchema.properties;
  if (properties && typeof properties === "object") {
    for (const nestedSchema of Object.values(properties)) {
      expectStrictJsonSchema(nestedSchema);
    }
  }

  expectStrictJsonSchema(objectSchema.items);
  expectStrictJsonSchema(objectSchema.contains);

  const allOf = objectSchema.allOf;
  if (Array.isArray(allOf)) {
    for (const nestedSchema of allOf) {
      expectStrictJsonSchema(nestedSchema);
    }
  }
}

function createSafeToolDefinition(overrides: Partial<ToolDefinition>): ToolDefinition {
  return {
    id: "safe_tool",
    label: "安全工具",
    description: "安全工具描述",
    adapterKind: "internal_capability",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        projectId: { type: "string", minLength: 1 },
        userInstruction: { type: ["string", "null"] },
      },
      required: ["projectId", "userInstruction"],
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        artifactKind: { type: "string", const: "safe_artifact" },
        summary: { type: "string" },
      },
      required: ["artifactKind", "summary"],
    },
    requiresHumanGate: true,
    sideEffectLevel: "artifact_write",
    requiredArtifactKinds: [],
    producedArtifactKind: "safe_artifact",
    failurePolicy: { retryable: true, maxRetries: 1, onFailure: "record_observation" },
    implemented: true,
    ...overrides,
  };
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
    expect(tool.inputSchema.required).toEqual(["projectId", "userInstruction", "artifactRefs"]);
  });

  it("accepts project id and nullable user instruction for create_requirement_spec", () => {
    const tool = getToolDefinition("create_requirement_spec");

    expect(tool.inputSchema.properties).toMatchObject({
      projectId: { type: "string", minLength: 1 },
      userInstruction: { type: ["string", "null"] },
    });
    expect(tool.inputSchema.required).toEqual(["projectId", "userInstruction"]);
  });

  it("requires every upstream artifact kind in multi-artifact input schemas", () => {
    const tool = getToolDefinition("plan_video_segments");
    const artifactRefs = (tool.inputSchema.properties as Record<string, unknown>).artifactRefs as Record<string, unknown>;

    expect(artifactRefs.minItems).toBe(2);
    expect(artifactRefs.allOf).toEqual([
      {
        contains: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", const: "storyboard_generate" },
            artifactId: { type: "string", minLength: 1 },
          },
          required: ["kind", "artifactId"],
        },
      },
      {
        contains: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", const: "asset_image_generate" },
            artifactId: { type: "string", minLength: 1 },
          },
          required: ["kind", "artifactId"],
        },
      },
    ]);
  });

  it("prevents returned definition mutations from polluting the registry", () => {
    const listedTool = listToolDefinitions().find((tool) => tool.id === "create_lesson_plan");
    expect(listedTool).toBeDefined();

    listedTool!.description = "mutated description";
    listedTool!.requiredArtifactKinds.push("mutated_artifact");
    ((listedTool!.inputSchema.properties as Record<string, unknown>).projectId as Record<string, unknown>).minLength = 99;

    expect(getToolDefinition("create_lesson_plan")).toMatchObject({
      description: "基于已确认需求和教材依据生成公开课教案。",
      requiredArtifactKinds: ["requirement_spec"],
    });
    expect(((getToolDefinition("create_lesson_plan").inputSchema.properties as Record<string, unknown>).projectId as Record<string, unknown>).minLength).toBe(1);

    const fetchedTool = getToolDefinition("create_lesson_plan");
    fetchedTool.description = "mutated again";
    ((fetchedTool.inputSchema.properties as Record<string, unknown>).projectId as Record<string, unknown>).minLength = 100;

    expect(getToolDefinition("create_lesson_plan")).toMatchObject({
      description: "基于已确认需求和教材依据生成公开课教案。",
    });
    expect(((getToolDefinition("create_lesson_plan").inputSchema.properties as Record<string, unknown>).projectId as Record<string, unknown>).minLength).toBe(1);
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

  it("rejects unsafe OpenAI tool description and schema values", () => {
    expect(() =>
      toolDefinitionToOpenAiFunctionTool(createSafeToolDefinition({ description: "包含 provider 内部词" })),
    ).toThrow(/unsafe/i);

    expect(() =>
      toolDefinitionToOpenAiFunctionTool(
        createSafeToolDefinition({
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
              token: { type: "string" },
            },
            required: ["token"],
          },
        }),
      ),
    ).toThrow(/unsafe/i);

    expect(() =>
      toolDefinitionToOpenAiFunctionTool(
        createSafeToolDefinition({
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
              projectId: { type: "string", enum: ["safe", "debug"] },
            },
            required: ["projectId"],
          },
        }),
      ),
    ).toThrow(/unsafe/i);

    expect(() =>
      toolDefinitionToOpenAiFunctionTool(
        createSafeToolDefinition({
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
              projectId: { type: "string", const: "local path" },
            },
            required: ["projectId"],
          },
        }),
      ),
    ).toThrow(/unsafe/i);
  });
});
