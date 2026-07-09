import type { JsonSchemaObject, OpenAiFunctionToolSchema, ToolDefinition } from "./tool-types";

const unsafeDescriptionPattern = /provider|storage|runtimeKind|debug|token|API_KEY|SECRET|local path/i;

function cloneJsonSchema(schema: JsonSchemaObject): JsonSchemaObject {
  return structuredClone(schema);
}

function assertSafeOpenAiToolSchema(schema: OpenAiFunctionToolSchema, toolId: string): void {
  if (unsafeDescriptionPattern.test(JSON.stringify(schema))) {
    throw new Error(`Unsafe OpenAI tool schema for ${toolId}`);
  }
}

export function toolDefinitionToOpenAiFunctionTool(tool: ToolDefinition): OpenAiFunctionToolSchema {
  if (!tool.implemented) {
    throw new Error(`Tool is not implemented: ${tool.id}`);
  }

  const schema: OpenAiFunctionToolSchema = {
    type: "function",
    name: tool.id,
    description: tool.description,
    parameters: cloneJsonSchema(tool.inputSchema),
    strict: true,
  };

  assertSafeOpenAiToolSchema(schema, tool.id);

  return schema;
}
