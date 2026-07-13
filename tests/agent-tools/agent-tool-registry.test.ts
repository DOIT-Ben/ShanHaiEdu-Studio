import { describe, expect, it } from "vitest";

import {
  getAgentToolDefinition,
  getAgentToolDefinitionByTransportName,
  listAgentToolDefinitions,
} from "@/server/tools/agent-tool-registry";
import { toolDefinitionToOpenAiFunctionTool } from "@/server/tools/openai-tool-schema";
import { videoCourseAnchorHardGateIds } from "@/server/tools/video-course-anchor-gate";

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
    const criticInput = getAgentToolDefinition("delivery_critic.review").inputSchema;
    const criticOutput = getAgentToolDefinition("delivery_critic.review").outputSchema;

    expect(new Set(criticInput.required)).toEqual(new Set(Object.keys(criticInput.properties ?? {})));

    expect(videoOutput.required).toEqual(expect.arrayContaining([
      "independentFilmChecks",
      "storyWorld",
      "courseAnchor",
    ]));
    const courseAnchor = (videoOutput.properties as Record<string, any>).courseAnchor;
    expect(courseAnchor.required).toEqual(expect.arrayContaining([
      "anchorTrigger",
      "handoffMoment",
      "classroomReturnQuestion",
      "doNotExplain",
      "anchorCount",
    ]));

    expect(criticOutput.required).toEqual(expect.arrayContaining([
      "hardGateResults",
      "targetLocators",
      "findings",
      "responsibleStage",
      "minimalFix",
      "inconclusiveReasons",
    ]));
    const routerOwnedFields = [
      "policyOutcome",
      "reviewBinding",
      "productionEligible",
      "executorSource",
      "forbiddenNextToolIntents",
      "criticProfileId",
      "criticInvocationId",
      "rubricRef",
    ];
    for (const field of routerOwnedFields) {
      expect(criticOutput.required).not.toContain(field);
      expect(criticOutput.properties).not.toHaveProperty(field);
    }
    const hardGateItem = (criticOutput.properties as Record<string, any>).hardGateResults.items;
    expect(hardGateItem.properties.gateId).toMatchObject({ type: "string", minLength: 1 });
    expect(hardGateItem.properties.gateId).not.toHaveProperty("enum");
    expect(hardGateItem.required).toContain("findingIds");
    expect((criticOutput.properties as Record<string, any>).hardGateResults).not.toHaveProperty("maxItems");
    expect((criticInput.properties as Record<string, any>).targetLocators).toMatchObject({ minItems: 1 });
    expect((criticInput.properties as Record<string, any>).targetLocators.items.oneOf).toHaveLength(9);
    expect((criticOutput.properties as Record<string, any>).targetLocators.items.oneOf).toHaveLength(9);
    const locatorVariants = (criticOutput.properties as Record<string, any>).targetLocators.items.oneOf;
    const artifactLocator = locatorVariants.find((variant: any) => variant.properties.kind.const === "artifact");
    const frameRangeLocator = locatorVariants.find((variant: any) => variant.properties.kind.const === "frame_range");
    expect(artifactLocator.required).toEqual(expect.arrayContaining(["artifactKind", "artifactId"]));
    expect(frameRangeLocator.required).toEqual(expect.arrayContaining([
      "parentArtifactId",
      "parentShotId",
      "timeRangeMs",
      "frameRefs",
    ]));
    expect((criticOutput.properties as Record<string, any>).minimalFix).toMatchObject({ minLength: 1 });
    expect(videoCourseAnchorHardGateIds).toHaveLength(6);
  });
});
