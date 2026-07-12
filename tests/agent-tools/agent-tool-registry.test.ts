import { describe, expect, it } from "vitest";

import {
  getAgentToolDefinition,
  getAgentToolDefinitionByTransportName,
  listAgentToolDefinitions,
} from "@/server/tools/agent-tool-registry";
import { toolDefinitionToOpenAiFunctionTool } from "@/server/tools/openai-tool-schema";

const canonicalIds = [
  "ppt_director.plan_or_repair",
  "video_director.plan_or_repair",
  "delivery_critic.review",
] as const;

describe("V1-2 Agent Tool registry", () => {
  it("registers the three professional Agent Tools with stable canonical and transport ids", () => {
    const definitions = listAgentToolDefinitions();

    expect(definitions.map((tool) => tool.id)).toEqual(canonicalIds);
    expect(definitions.map((tool) => tool.transportName)).toEqual([
      "ppt_director_plan_or_repair",
      "video_director_plan_or_repair",
      "delivery_critic_review",
    ]);
    expect(new Set(definitions.map((tool) => tool.transportName)).size).toBe(definitions.length);
  });

  it("keeps Agent Tools read-only and outside product artifact semantics", () => {
    for (const tool of listAgentToolDefinitions()) {
      expect(tool).toMatchObject({
        adapterKind: "agent",
        sideEffectLevel: "none",
        requiresHumanGate: false,
        contractReady: true,
        executorReady: false,
        mainAgentExecutable: false,
        implemented: false,
        modelVisible: true,
      });
      expect(tool.producedArtifactKind).toBeUndefined();
      expect(tool.capabilityId).toBeUndefined();
    }
  });

  it("resolves canonical and protocol-safe transport names without guessing", () => {
    for (const canonicalId of canonicalIds) {
      const definition = getAgentToolDefinition(canonicalId);
      expect(getAgentToolDefinitionByTransportName(definition.transportName)).toEqual(definition);
    }
    expect(() => getAgentToolDefinition("unknown.agent")).toThrow(/unknown agent tool/i);
    expect(() => getAgentToolDefinitionByTransportName("unknown_agent_tool")).toThrow(/unknown agent tool/i);
  });

  it("exports every Agent Tool through the single safe OpenAI schema converter", () => {
    for (const definition of listAgentToolDefinitions()) {
      const schema = toolDefinitionToOpenAiFunctionTool(definition);
      expect(schema.name).toBe(definition.transportName);
      expect(schema.strict).toBe(true);
      expect(schema.parameters.additionalProperties).toBe(false);
      expect(JSON.stringify(schema)).not.toMatch(/credential|apiKey|database|local path|provider url/i);
    }
  });

  it("requires video independence gates and critic hard gates in structured outputs", () => {
    const videoOutput = getAgentToolDefinition("video_director.plan_or_repair").outputSchema;
    const criticOutput = getAgentToolDefinition("delivery_critic.review").outputSchema;

    expect(videoOutput.required).toEqual(expect.arrayContaining([
      "independentFilmChecks",
      "storyWorld",
      "courseAnchor",
    ]));
    expect(criticOutput.required).toContain("hardGateResults");
  });
});
