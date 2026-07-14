import type { JsonSchemaObject, OpenAiFunctionToolSchema, ToolDefinition } from "./tool-types";
import type { AgentToolDefinition } from "./agent-tool-types";

const unsafeDescriptionPattern = /provider|storage|runtimeKind|debug|token|API_KEY|SECRET|local path/i;
const unsupportedStrictSchemaKeywords = new Set(["allOf", "anyOf", "oneOf", "contains", "minItems"]);

function cloneJsonSchema(schema: JsonSchemaObject): JsonSchemaObject {
  return structuredClone(schema);
}

function assertSafeOpenAiToolSchema(schema: OpenAiFunctionToolSchema, toolId: string): void {
  if (unsafeDescriptionPattern.test(JSON.stringify(schema))) {
    throw new Error(`Unsafe OpenAI tool schema for ${toolId}`);
  }
}

export function toolDefinitionToOpenAiFunctionTool(tool: ToolDefinition | AgentToolDefinition): OpenAiFunctionToolSchema {
  const agentTool = isAgentToolDefinition(tool);
  if (agentTool ? !tool.contractReady : !tool.implemented) {
    throw new Error(`Tool is not implemented: ${tool.id}`);
  }

  const schema: OpenAiFunctionToolSchema = {
    type: "function",
    name: agentTool ? tool.transportName : tool.id,
    description: tool.description,
    parameters: sanitizeOpenAiStrictSchema(
      agentTool ? modelVisibleAgentToolInputSchema(tool) : cloneJsonSchema(tool.inputSchema),
    ),
    strict: true,
  };

  assertSafeOpenAiToolSchema(schema, tool.id);

  return schema;
}

export function sanitizeOpenAiStrictSchema(schema: JsonSchemaObject): JsonSchemaObject {
  return sanitizeSchemaValue(schema) as JsonSchemaObject;
}

function sanitizeSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSchemaValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !unsupportedStrictSchemaKeywords.has(key))
      .map(([key, child]) => [key, sanitizeSchemaValue(child)]),
  );
}

function modelVisibleAgentToolInputSchema(tool: AgentToolDefinition): JsonSchemaObject {
  const schema = cloneJsonSchema(tool.inputSchema);
  if (tool.id !== "delivery_critic.review") return schema;

  if (!schema.properties) throw new Error("Delivery critic input schema properties are required.");
  schema.properties.targetLocators = {
    type: "array",
    minItems: 1,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["artifact"] },
        artifactKind: { type: "string", minLength: 1 },
        artifactId: { type: "string", minLength: 1 },
      },
      required: ["kind", "artifactKind", "artifactId"],
    },
  };
  return schema;
}

function isAgentToolDefinition(tool: ToolDefinition | AgentToolDefinition): tool is AgentToolDefinition {
  return "contractReady" in tool && "transportName" in tool;
}
