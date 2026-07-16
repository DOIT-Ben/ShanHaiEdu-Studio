import { describe, expect, it, vi } from "vitest";

import {
  createBusinessToolSkillRuntime,
  preflightBusinessToolSkillRuntime,
} from "@/server/skills/business-tool-skill-runtime";
import type { SkillBoundBusinessToolPolicy } from "@/server/skills/business-tool-skill-bindings";
import type {
  SkillCapability,
  SkillDescriptor,
  SkillHumanGateCondition,
  SkillSideEffect,
} from "@/server/skills/skill-runtime-types";

describe("business Tool Skill capability and risk parity", () => {
  it("fails preflight when a formal Skill requires a capability the selected Tool cannot map", async () => {
    const error = await runPreflight(skillDescriptor({
      requiredCapabilities: ["image.generate", "artifact.write", "quality.validate", "source.read"],
    })).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ reasonCode: "skill_runtime_capability_mismatch" });
  });

  it("fails preflight when a formal Skill under-reports or expands the selected Tool side effects", async () => {
    const missingExternalGeneration = await runPreflight(skillDescriptor({
      sideEffects: ["artifact_write"],
    })).catch((caught: unknown) => caught);
    const expandedDestructiveWrite = await runPreflight(skillDescriptor({
      sideEffects: ["artifact_write", "external_generation", "destructive_write"],
      humanGateConditions: ["missing_authorization", "paid_external_generation", "destructive_write"],
    })).catch((caught: unknown) => caught);

    expect(missingExternalGeneration).toMatchObject({ reasonCode: "skill_runtime_side_effect_mismatch" });
    expect(expandedDestructiveWrite).toMatchObject({ reasonCode: "skill_runtime_side_effect_mismatch" });
  });

  it("fails preflight when formal Skill HumanGate declarations differ from ActionPolicy risk facts", async () => {
    const error = await runPreflight(skillDescriptor({
      humanGateConditions: ["missing_authorization"],
    })).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ reasonCode: "skill_runtime_human_gate_mismatch" });
  });

  it("enforces the same parity at lazy load and never projects Skill authority into the semantic slice", async () => {
    const loadSelected = vi.fn(async () => loadedSkill(skillDescriptor({
      sideEffects: ["artifact_write", "external_generation", "external_publish"],
      humanGateConditions: ["missing_authorization", "paid_external_generation", "external_publish"],
    })));
    const runtime = createBusinessToolSkillRuntime({
      resolveBusinessSkillPolicy: () => imagePolicy(),
      loadSelected,
    });

    await expect(runtime.loadForSelectedTool({
      selectedBy: "main_agent",
      businessToolName: "generate_video_assets",
    })).rejects.toMatchObject({ reasonCode: "skill_runtime_side_effect_mismatch" });
  });

  it("accepts an exact formal mapping without exposing capabilities or gate declarations to orchestration", async () => {
    const runtime = createBusinessToolSkillRuntime({
      resolveBusinessSkillPolicy: () => imagePolicy(),
      loadSelected: vi.fn(async () => loadedSkill(skillDescriptor())),
    });

    const context = await runtime.loadForSelectedTool({
      selectedBy: "main_agent",
      businessToolName: "generate_video_assets",
    });

    expect(context).toMatchObject({
      skillName: "shanhai-imagegen",
      semanticSlice: { toolName: "generate_video_assets" },
    });
    expect(context).not.toHaveProperty("capabilities");
    expect(context).not.toHaveProperty("sideEffects");
    expect(context).not.toHaveProperty("humanGateConditions");
    expect(context.semanticSlice).not.toHaveProperty("capabilities");
    expect(context.semanticSlice).not.toHaveProperty("sideEffects");
    expect(context.semanticSlice).not.toHaveProperty("humanGateConditions");
  });
});

async function runPreflight(descriptor: SkillDescriptor) {
  return preflightBusinessToolSkillRuntime({
    mode: "required",
    env: {
      NODE_ENV: "test",
      SHANHAI_SKILLS_RUNTIME_ROOT: "runtime-projection",
    },
    dependencies: {
      openRegistry: async () => registryFixture(descriptor),
      listBusinessToolNames: () => ["generate_video_assets"],
      listBindings: () => [imagePolicy()],
      resolveBusinessToolContract: () => ({
        consumes: ["asset_brief_generate"],
        produces: ["asset_image_generate"],
      }),
    },
  });
}

function registryFixture(descriptor: SkillDescriptor) {
  return {
    discoverActive: () => [structuredClone(descriptor)],
    get: (name: string) => {
      if (name !== descriptor.name) throw new Error("inactive");
      return {
        ...structuredClone(descriptor),
        directory: "shanhai-imagegen-1.0",
        entrypoint: "SKILL.md",
        skillRoot: "runtime-projection/shanhai-imagegen",
        entrypointPath: "runtime-projection/shanhai-imagegen/SKILL.md",
      };
    },
    getProjectionLockDigest: () => "a".repeat(64),
    validateReferencePaths: async () => {},
    loadContractSchemasForLoader: async () => descriptor.contracts.produces.map((contract) => ({
      artifactType: contract.artifactType,
      contractVersion: contract.contractVersion,
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { schemaVersion: { const: contract.contractVersion } },
      },
      schemaSha256: `sha256:${"d".repeat(64)}`,
    })),
  };
}

function loadedSkill(descriptor: SkillDescriptor) {
  return {
    descriptor,
    instructions: "只增强当前图片 Tool。",
    references: {
      "references/prompting.md": "描述当前图片用途、构图和连续性。",
    },
    provenance: {
      entrypointSha256: `sha256:${"b".repeat(64)}`,
      referenceSha256: {
        "references/prompting.md": `sha256:${"c".repeat(64)}`,
      },
    },
  };
}

function skillDescriptor(overrides: {
  requiredCapabilities?: SkillCapability[];
  sideEffects?: SkillSideEffect[];
  humanGateConditions?: SkillHumanGateCondition[];
} = {}): SkillDescriptor {
  return {
    name: "shanhai-imagegen",
    version: "1.1",
    displayName: "山海图像生成",
    responsibility: "执行当前 Tool 已定义的图片请求",
    triggers: ["生成图片"],
    inputArtifacts: [],
    outputArtifacts: ["image-generation-result.json"],
    contracts: {
      consumes: [],
      produces: [{ artifactType: "image-generation-result", contractVersion: "shanhai-imagegen/v2" }],
    },
    capabilities: {
      required: overrides.requiredCapabilities ?? ["image.generate", "artifact.write", "quality.validate"],
      optional: ["image.edit", "image.reference", "human.request_decision"],
    },
    sideEffects: overrides.sideEffects ?? ["artifact_write", "external_generation"],
    humanGateConditions: overrides.humanGateConditions ?? ["missing_authorization", "paid_external_generation"],
    upstream: [],
    downstream: [],
    status: "active",
  };
}

function imagePolicy(): SkillBoundBusinessToolPolicy {
  return {
    toolName: "generate_video_assets",
    mode: "skill",
    skillName: "shanhai-imagegen",
    compatibleVersions: ["1.1"],
    referencePaths: ["references/prompting.md"],
    semanticGuidance: [{
      sourcePath: "references/prompting.md",
      objective: "生成当前独立创意短片所需的参考图。",
      rules: ["保持角色和场景连续性。"],
      exclusions: ["不得扩张为完整视频或最终材料包。"],
    }],
    artifactCompatibility: {
      consumes: [{
        toolArtifactKind: "asset_brief_generate",
        skillContract: null,
        adapterId: "image-request-context.v1",
      }],
      produces: [{
        toolArtifactKind: "asset_image_generate",
        skillContract: {
          artifactType: "image-generation-result",
          contractVersion: "shanhai-imagegen/v2",
        },
        adapterId: "image-result-single.v2",
      }],
    },
    contracts: {
      tool: {
        consumes: ["asset_brief_generate"],
        produces: ["asset_image_generate"],
      },
      skill: {
        consumes: [],
        produces: [{ artifactType: "image-generation-result", contractVersion: "shanhai-imagegen/v2" }],
      },
    },
  };
}
