import { listMainAgentExecutableToolDefinitions } from "@/server/tools/main-agent-tool-registry";

import type { RuntimeAbToolDefinition } from "./types";

const runtimeAbCandidateArtifactKinds = new Set([
  "requirement_spec",
  "lesson_plan",
  "ppt_draft",
]);

export function projectRuntimeAbToolDefinitions(): RuntimeAbToolDefinition[] {
  const projected = listMainAgentExecutableToolDefinitions()
    .filter((tool) => tool.producedArtifactKind && runtimeAbCandidateArtifactKinds.has(tool.producedArtifactKind))
    .map((tool) => {
      const properties = Object.fromEntries(Object.entries(tool.inputSchema.properties ?? {}).map(([name, schema]) => {
        if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
          throw new Error(`Runtime A/B Tool schema property is invalid: ${tool.transportName}.${name}`);
        }
        return [name, structuredClone(schema as Record<string, unknown>)];
      }));
      return {
        type: "function" as const,
        name: tool.transportName,
        description: tool.description,
        parameters: {
          type: "object" as const,
          properties,
          required: [...(tool.inputSchema.required ?? [])],
          additionalProperties: false as const,
        },
        strict: true as const,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  if (projected.length !== runtimeAbCandidateArtifactKinds.size) {
    throw new Error("Runtime A/B production Tool projection is incomplete.");
  }
  return projected;
}
