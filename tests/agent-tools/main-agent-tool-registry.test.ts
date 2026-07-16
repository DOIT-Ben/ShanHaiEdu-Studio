import { describe, expect, it } from "vitest";

import {
  listMainAgentExecutableToolDefinitions,
  listMainAgentToolDefinitions,
  resolveMainAgentToolDefinition,
} from "@/server/tools/main-agent-tool-registry";
import { toolDefinitionToOpenAiFunctionTool } from "@/server/tools/openai-tool-schema";

const expectedBusinessTools = [
  "create_requirement_spec",
  "create_lesson_plan",
  "create_ppt_outline",
  "create_video_course_anchor",
  "generate_intro_creative_themes",
  "generate_intro_video_script",
  "generate_video_storyboard",
  "generate_video_asset_brief",
  "plan_video_segments",
  "create_ppt_design_draft",
  "generate_ppt_sample_assets",
  "assemble_ppt_key_samples",
  "generate_ppt_full_assets",
  "assemble_ppt_full_deck",
  "repair_ppt_full_deck_pages",
  "generate_classroom_image",
  "generate_video_assets",
  "generate_video_narration",
  "generate_video_shot",
  "assemble_video",
  "create_final_package",
];

const expectedAgentTools = [
  "ppt_director.plan_or_repair",
  "video_director.plan_or_repair",
  "delivery_critic.review",
];

const expectedControlTools = ["request_teacher_decision"];

describe("V1-3 Main Agent visible tool registry", () => {
  it("exposes only approved high-level business and Agent Tools", () => {
    const definitions = listMainAgentToolDefinitions();

    expect(definitions.map((tool) => tool.id)).toEqual([...expectedAgentTools, ...expectedControlTools, ...expectedBusinessTools]);
    expect(definitions.every((tool) => tool.modelVisible)).toBe(true);
  });

  it("does not expose legacy, raw, blocked, or low-level infrastructure tools", () => {
    const ids = listMainAgentToolDefinitions().map((tool) => tool.id);

    expect(ids).not.toContain("intro_video");
    expect(ids).not.toContain("generate_pptx_from_design");
    expect(ids).not.toContain("database_write");
    expect(ids).not.toContain("artifact_promote");
  });

  it("exposes only the three controlled read-only Agent Tools plus approved business Tools", () => {
    expect(listMainAgentExecutableToolDefinitions().map((tool) => tool.id)).toEqual([...expectedAgentTools, ...expectedControlTools, ...expectedBusinessTools]);
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

  it("exports strict-safe Main Agent Tool schemas without unsupported composition keywords", () => {
    const serialized = JSON.stringify(
      listMainAgentExecutableToolDefinitions().map(toolDefinitionToOpenAiFunctionTool),
    );

    for (const keyword of ["allOf", "anyOf", "oneOf", "contains", "minItems"]) {
      expect(serialized).not.toContain(`\"${keyword}\"`);
    }
  });

  it("lets Main Agent pass exact validation issues when repairing a PPT design candidate", () => {
    const designTool = resolveMainAgentToolDefinition("create_ppt_design_draft");

    expect(designTool.inputSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        repairIssues: {
          type: "array",
          maxItems: 12,
          uniqueItems: true,
          items: { type: "string" },
        },
      },
      required: ["repairIssues"],
    });
  });

  it("exposes a semantic collaboration control Tool without classifying it as HumanGate or a business Tool", () => {
    const control = resolveMainAgentToolDefinition("request_teacher_decision");

    expect(control).toMatchObject({
      id: "request_teacher_decision",
      transportName: "request_teacher_decision",
      controlKind: "dialogue_checkpoint",
      requiresHumanGate: false,
      sideEffectLevel: "none",
      modelVisible: true,
      mainAgentExecutable: true,
    });
    expect(control.description).toMatch(/多个合理理解|实质改变结果/);
    expect(control.description).not.toMatch(/每一步都|必须逐节点确认/);
  });

  it("keeps model-facing Tool instructions separate from teacher-visible progress copy", () => {
    const tool = resolveMainAgentToolDefinition("create_ppt_design_draft");

    expect(tool.description).toMatch(/TaskBrief|Observation|Director/);
    expect(tool).toMatchObject({
      teacherDescription: expect.stringContaining("逐页 PPT 设计候选"),
    });
    expect(JSON.stringify((tool as { teacherDescription?: string }).teacherDescription))
      .not.toMatch(/TaskBrief|Observation|reasonCodes|Director|repairIssues|schema/i);
  });
});
