import { describe, expect, it } from "vitest";

import {
  businessToolSkillPolicyDigest,
  listBusinessToolSkillPolicies,
  resolveBusinessSkillName,
} from "@/server/skills/business-tool-skill-bindings";
import { listMainAgentToolDefinitions } from "@/server/tools/main-agent-tool-registry";

describe("Main Agent business Tool Skill bindings", () => {
  it("binds business Skills to existing high-level Tools without registering a second orchestrator", () => {
    const tools = listMainAgentToolDefinitions();
    const byId = new Map(tools.map((tool) => [tool.id, tool]));

    expect(byId.get("create_lesson_plan")).toMatchObject({
      businessSkillName: "shanhai-jiaoan",
      businessSkillBindingMode: "guidance",
    });
    expect(byId.get("create_ppt_outline")).toMatchObject({
      businessSkillName: "shanhai-ppt",
      businessSkillBindingMode: "guidance",
    });
    expect(byId.get("generate_intro_video_script")).toMatchObject({
      businessSkillName: "shanhai-video",
      businessSkillBindingMode: "guidance",
    });
    expect(byId.get("generate_video_assets")).toMatchObject({ businessSkillName: "shanhai-imagegen" });
    expect(byId.get("generate_classroom_image")).toMatchObject({ businessSkillName: "shanhai-imagegen" });
    expect(byId.get("generate_video_narration")).not.toHaveProperty("businessSkillName");
    expect(byId.get("generate_video_shot")).toMatchObject({ businessSkillName: "shanhai-video-generation" });
    expect(byId.get("assemble_video")).not.toHaveProperty("businessSkillName");
    expect(byId.get("generate_ppt_sample_assets")).toMatchObject({ businessSkillName: "shanhai-imagegen" });
    expect(byId.get("generate_ppt_full_assets")).toMatchObject({ businessSkillName: "shanhai-imagegen" });
    expect(byId.get("create_final_package")).toMatchObject({ businessSkillName: "shanhai-delivery" });

    expect(tools.some((tool) => tool.id === "shanhai-suite" || tool.id === "run_skill_pipeline")).toBe(false);
    expect(byId.get("ppt_director.plan_or_repair")).not.toHaveProperty("businessSkillName");

    expect(resolveBusinessSkillName("create_lesson_plan")).toBeUndefined();
    expect(resolveBusinessSkillName("create_ppt_outline")).toBeUndefined();
    expect(resolveBusinessSkillName("generate_intro_video_script")).toBeUndefined();
  });

  it("defines one exact versioned Skill or audited exemption policy for every business Tool", () => {
    const businessToolNames = listMainAgentToolDefinitions()
      .filter((tool) => typeof tool.internalToolId === "string")
      .map((tool) => tool.id)
      .sort();
    const policies = listBusinessToolSkillPolicies();

    expect(policies.map((policy) => policy.toolName).sort()).toEqual(businessToolNames);
    expect(new Set(policies.map((policy) => policy.toolName)).size).toBe(policies.length);
    expect(businessToolSkillPolicyDigest()).toMatch(/^[a-f0-9]{64}$/);
    expect(policies).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: "create_requirement_spec", mode: "exempt", reasonCode: "no_domain_skill_required" }),
      expect.objectContaining({ toolName: "generate_video_narration", mode: "exempt", reasonCode: "no_compatible_domain_skill" }),
      expect.objectContaining({
        toolName: "create_lesson_plan",
        mode: "guidance",
        skillName: "shanhai-jiaoan",
        compatibleVersions: ["1.1"],
        referencePaths: [
          "references/教案结构化字段规范.md",
          "references/教案质量门禁.md",
        ],
        contracts: { tool: { consumes: [], produces: ["lesson_plan"] } },
      }),
      expect.objectContaining({
        toolName: "create_ppt_outline",
        mode: "guidance",
        skillName: "shanhai-ppt",
        compatibleVersions: ["1.0"],
        referencePaths: ["references/page-design.md"],
        contracts: { tool: { consumes: [], produces: ["ppt_draft"] } },
      }),
      expect.objectContaining({
        toolName: "create_ppt_design_draft",
        mode: "guidance",
        skillName: "shanhai-ppt",
      }),
      expect.objectContaining({
        toolName: "create_final_package",
        mode: "skill",
        skillName: "shanhai-delivery",
        compatibleVersions: ["1.3"],
        artifactCompatibility: {
          consumes: expect.arrayContaining([
            expect.objectContaining({
              toolArtifactKind: "requirement_spec",
              adapterId: "delivery-task-context.v1",
            }),
            expect.objectContaining({
              toolArtifactKind: "concat_only_assemble",
              adapterId: "delivery-component-context.v1",
            }),
          ]),
          produces: [expect.objectContaining({
            toolArtifactKind: "final_delivery",
            adapterId: "delivery-result-package.v2",
          })],
        },
      }),
      expect.objectContaining({
        toolName: "generate_video_storyboard",
        mode: "guidance",
        skillName: "shanhai-video",
        referencePaths: ["references/storyboards.md"],
      }),
      expect.objectContaining({
        toolName: "generate_video_assets",
        mode: "skill",
        skillName: "shanhai-imagegen",
        compatibleVersions: ["1.1"],
        artifactCompatibility: {
          consumes: [expect.objectContaining({
            toolArtifactKind: "asset_brief_generate",
            adapterId: "image-request-context.v1",
          })],
          produces: [expect.objectContaining({
            toolArtifactKind: "asset_image_generate",
            adapterId: "image-result-single.v2",
          })],
        },
      }),
    ]));

    const guidanceTools = new Set([
      "create_lesson_plan",
      "create_ppt_outline",
      "create_ppt_design_draft",
      "create_video_course_anchor",
      "generate_intro_creative_themes",
      "generate_intro_video_script",
      "generate_video_storyboard",
      "generate_video_asset_brief",
      "plan_video_segments",
    ]);
    for (const policy of policies.filter((candidate) => guidanceTools.has(candidate.toolName))) {
      expect(policy).toMatchObject({ mode: "guidance" });
      if (policy.mode !== "guidance") continue;
      expect(policy).not.toHaveProperty("artifactCompatibility");
      expect(policy.contracts).not.toHaveProperty("skill");
    }
  });
});
