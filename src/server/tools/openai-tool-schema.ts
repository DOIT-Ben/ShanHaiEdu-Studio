import type { JsonSchemaObject, OpenAiFunctionToolSchema, ToolDefinition } from "./tool-types";

const unsafeDescriptionPattern = /provider|storage|runtimeKind|debug|token|API_KEY|SECRET|local path/i;

function cloneJsonSchema(schema: JsonSchemaObject): JsonSchemaObject {
  return structuredClone(schema);
}

function assertSafeDescription(description: string, toolId: string): void {
  if (unsafeDescriptionPattern.test(description)) {
    throw new Error(`Unsafe OpenAI tool description for ${toolId}`);
  }
}

export function toolDefinitionToOpenAiFunctionTool(tool: ToolDefinition): OpenAiFunctionToolSchema {
  assertSafeDescription(tool.description, tool.id);

  return {
    type: "function",
    name: tool.id,
    description: tool.description,
    parameters: cloneJsonSchema(tool.inputSchema),
    strict: true,
  };
}
