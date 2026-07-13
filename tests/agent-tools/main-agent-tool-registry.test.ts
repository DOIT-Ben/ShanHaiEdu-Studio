import { describe, expect, it } from "vitest";

import {
  listMainAgentExecutableToolDefinitions,
  listMainAgentToolDefinitions,
  resolveMainAgentToolDefinition,
} from "@/server/tools/main-agent-tool-registry";

const expectedBusinessTools = [
  "generate_ppt_sample_assets",
  "assemble_ppt_key_samples",
  "generate_ppt_full_assets",
  "assemble_ppt_full_deck",
  "repair_ppt_full_deck_pages",
  "generate_video_assets",
  "generate_video_shot",
  "assemble_video",
  "create_final_package",
];

const expectedAgentTools = [
  "ppt_director.plan_or_repair",
  "video_director.plan_or_repair",
  "delivery_critic.review",
];

describe("V1-3 Main Agent visible tool registry", () => {
  it("exposes only approved high-level business and Agent Tools", () => {
    const definitions = listMainAgentToolDefinitions();

    expect(definitions.map((tool) => tool.id)).toEqual([...expectedAgentTools, ...expectedBusinessTools]);
    expect(definitions.every((tool) => tool.modelVisible)).toBe(true);
  });

  it("does not expose legacy, raw, blocked, or low-level infrastructure tools", () => {
    const ids = listMainAgentToolDefinitions().map((tool) => tool.id);

    expect(ids).not.toContain("intro_video");
    expect(ids).not.toContain("generate_pptx_from_design");
    expect(ids).not.toContain("create_requirement_spec");
    expect(ids).not.toContain("database_write");
    expect(ids).not.toContain("artifact_promote");
  });

  it("exposes only the three controlled read-only Agent Tools plus approved business Tools", () => {
    expect(listMainAgentExecutableToolDefinitions().map((tool) => tool.id)).toEqual([...expectedAgentTools, ...expectedBusinessTools]);
  });

  it("resolves only canonical ids or registered transport names", () => {
    expect(resolveMainAgentToolDefinition("video_director_plan_or_repair").id).toBe("video_director.plan_or_repair");
    expect(resolveMainAgentToolDefinition("assemble_ppt_full_deck").id).toBe("assemble_ppt_full_deck");
    expect(resolveMainAgentToolDefinition("generate_video_shot").internalToolId).toBe("generate_video_segment");
    expect(() => resolveMainAgentToolDefinition("generate_pptx_from_design")).toThrow(/not visible/i);
  });

  it("returns defensive copies", () => {
    const first = listMainAgentToolDefinitions();
    first[0]!.description = "mutated";
    const second = listMainAgentToolDefinitions();

    expect(second[0]!.description).not.toBe("mutated");
  });
});
