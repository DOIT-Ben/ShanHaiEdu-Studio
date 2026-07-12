import type { JsonSchemaObject, OpenAiFunctionToolSchema, ToolDefinition } from "./tool-types";
import type { AgentToolDefinition } from "./agent-tool-types";

const unsafeDescriptionPattern = /provider|storage|runtimeKind|debug|token|API_KEY|SECRET|local path/i;

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
    parameters: cloneJsonSchema(tool.inputSchema),
    strict: true,
  };

  assertSafeOpenAiToolSchema(schema, tool.id);

  return schema;
}

function isAgentToolDefinition(tool: ToolDefinition | AgentToolDefinition): tool is AgentToolDefinition {
  return "contractReady" in tool && "transportName" in tool;
}
