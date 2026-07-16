import { describe, expect, it, vi } from "vitest";

import {
  createConfiguredBusinessToolSkillRuntime,
  preflightBusinessToolSkillRuntime,
} from "@/server/skills/business-tool-skill-runtime";
import type { SkillDescriptor } from "@/server/skills/skill-runtime-types";

describe("V1-9 business Tool Skill Runtime preflight", () => {
  it("keeps unconfigured ordinary development optional", () => {
    expect(createConfiguredBusinessToolSkillRuntime({ NODE_ENV: "development" })).toBeUndefined();
  });

  it("returns an explicit optional result when ordinary development has no Skill configuration", async () => {
    await expect(preflightBusinessToolSkillRuntime({
      mode: "optional",
      env: { NODE_ENV: "development" },
    })).resolves.toEqual({
      status: "optional_not_configured",
      runtime: undefined,
      activeSkillNames: [],
      activeSkills: [],
      checkedBindingCount: 0,
      bindingPolicyDigest: null,
      projectionLockDigest: null,
    });
  });

  it.each([
    [{}, "skill_runtime_config_missing"],
    [{ SHANHAI_SKILLS_REGISTRY_PATH: "private-registry.yaml" }, "skill_runtime_config_partial"],
    [{ SHANHAI_SKILLS_ROOT: "private-skills" }, "skill_runtime_config_partial"],
    [{
      SHANHAI_SKILLS_RUNTIME_ROOT: "runtime-projection",
      SHANHAI_SKILLS_REGISTRY_PATH: "private-registry.yaml",
      SHANHAI_SKILLS_ROOT: "private-skills",
    }, "skill_runtime_config_ambiguous"],
  ] as const)("fails closed before opening the registry for invalid required config", async (env, reasonCode) => {
    const openRegistry = vi.fn();

    const error = await preflightBusinessToolSkillRuntime({
      mode: "required",
      env: { NODE_ENV: "test", ...env } as NodeJS.ProcessEnv,
      dependencies: { openRegistry },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ reasonCode });
    expect(String((error as Error).message)).not.toMatch(/private-|runtime-projection|SHANHAI_SKILLS_/i);
    expect(openRegistry).not.toHaveBeenCalled();
  });

  it("eagerly opens the configured registry and verifies every business binding is active", async () => {
    const activeNames = new Set([
      "shanhai-jiaoan",
      "shanhai-ppt",
      "shanhai-video",
      "shanhai-imagegen",
      "shanhai-video-generation",
      "shanhai-delivery",
    ]);
    const registry = registryFixture(activeNames);
    const openRegistry = vi.fn(async () => registry);

    const result = await preflightBusinessToolSkillRuntime({
      mode: "required",
      env: { NODE_ENV: "test", SHANHAI_SKILLS_RUNTIME_ROOT: "runtime-projection" },
      dependencies: { openRegistry },
    });

    expect(openRegistry).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ready");
    expect(result.activeSkillNames).toEqual([...activeNames].sort());
    expect(result.checkedBindingCount).toBe(21);
    expect(result.bindingPolicyDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.projectionLockDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.activeSkills).toEqual(expect.arrayContaining([
      { name: "shanhai-video", version: "1.2" },
      { name: "shanhai-imagegen", version: "1.1" },
      { name: "shanhai-video-generation", version: "1.1" },
      { name: "shanhai-delivery", version: "1.3" },
    ]));
    expect(result.runtime).toBeDefined();
  });

  it("fails required preflight when a formal output Schema cannot be loaded and compiled", async () => {
    const registry = registryFixture(new Set([
      "shanhai-jiaoan",
      "shanhai-ppt",
      "shanhai-video",
      "shanhai-imagegen",
      "shanhai-video-generation",
      "shanhai-delivery",
    ]));
    const loadContractSchemasForLoader = vi.fn(async (skillName: string) => {
      if (skillName === "shanhai-imagegen") throw new Error("invalid private Schema path");
      return formalSchemasForSkill(skillName);
    });

    const error = await preflightBusinessToolSkillRuntime({
      mode: "required",
      env: { NODE_ENV: "test", SHANHAI_SKILLS_RUNTIME_ROOT: "runtime-projection" },
      dependencies: {
        openRegistry: async () => ({ ...registry, loadContractSchemasForLoader }),
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ reasonCode: "skill_runtime_binding_contract_mismatch" });
    expect(loadContractSchemasForLoader).toHaveBeenCalledWith("shanhai-imagegen");
    expect(String((error as Error).message)).not.toMatch(/private|path/i);
  });

  it("rejects a policy table that omits business Tools even when its one Skill is active", async () => {
    const error = await preflightBusinessToolSkillRuntime({
      mode: "required",
      env: { NODE_ENV: "test", SHANHAI_SKILLS_RUNTIME_ROOT: "runtime-projection" },
      dependencies: {
        openRegistry: async () => registryFixture(new Map([["shanhai-ppt", "1.0"]])),
        listBusinessToolNames: () => ["create_ppt_outline", "create_ppt_design_draft"],
        listBindings: () => [{
          toolName: "create_ppt_outline", mode: "skill", skillName: "shanhai-ppt",
          compatibleVersions: ["1.0"], referencePaths: [],
          contracts: {
            tool: { consumes: ["requirement_spec"], produces: ["ppt_draft"] },
            skill: { consumes: [], produces: [] },
          },
          artifactCompatibility: {
            consumes: [{ toolArtifactKind: "requirement_spec", skillContract: null, adapterId: "image-request-context.v1" }],
            produces: [{ toolArtifactKind: "ppt_draft", skillContract: null, adapterId: "identity.v1" }],
          },
          semanticGuidance: [{
            sourcePath: "references/page-design.md",
            objective: "生成课件大纲。",
            rules: ["保持逐页结构。"],
            exclusions: [],
          }],
        }],
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ reasonCode: "skill_runtime_binding_missing_or_inactive" });
  });

  it("fails closed when Tool consume/produce facts do not match the bound policy", async () => {
    const error = await preflightBusinessToolSkillRuntime({
      mode: "required",
      env: { NODE_ENV: "test", SHANHAI_SKILLS_RUNTIME_ROOT: "runtime-projection" },
      dependencies: {
        openRegistry: async () => registryFixture(new Map([["shanhai-ppt", "1.0"]]), {
          "shanhai-ppt": {
            consumes: [{ artifactType: "lesson-plan", contractVersion: "shanhai-jiaoan/v2" }],
            produces: [{ artifactType: "ppt-package", contractVersion: "1.0" }],
          },
        }),
        listBusinessToolNames: () => ["create_ppt_outline"],
        resolveBusinessToolContract: () => ({ consumes: ["requirement_spec"], produces: ["ppt_draft"] }),
        listBindings: () => [{
          toolName: "create_ppt_outline",
          mode: "skill",
          skillName: "shanhai-ppt",
          compatibleVersions: ["1.0"],
          referencePaths: [],
          contracts: {
            tool: { consumes: ["lesson_plan"], produces: ["ppt_design_draft"] },
            skill: {
              consumes: [{ artifactType: "lesson-plan", contractVersion: "shanhai-jiaoan/v2" }],
              produces: [{ artifactType: "ppt-package", contractVersion: "1.0" }],
            },
          },
          artifactCompatibility: {
            consumes: [{
              toolArtifactKind: "lesson_plan",
              skillContract: { artifactType: "lesson-plan", contractVersion: "shanhai-jiaoan/v2" },
              adapterId: "identity.v1",
            }],
            produces: [{
              toolArtifactKind: "ppt_design_draft",
              skillContract: { artifactType: "ppt-package", contractVersion: "1.0" },
              adapterId: "identity.v1",
            }],
          },
          semanticGuidance: [{
            sourcePath: "references/page-design.md",
            objective: "生成课件设计。",
            rules: ["保持逐页结构。"],
            exclusions: [],
          }],
        }],
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ reasonCode: "skill_runtime_binding_contract_mismatch" });
  });

  it("rejects the real ppt outline binding when its draft artifacts are only paired with the full-package Skill contract", async () => {
    const error = await preflightBusinessToolSkillRuntime({
      mode: "required",
      env: { NODE_ENV: "test", SHANHAI_SKILLS_RUNTIME_ROOT: "runtime-projection" },
      dependencies: {
        openRegistry: async () => registryFixture(new Map([["shanhai-ppt", "1.0"]]), {
          "shanhai-ppt": {
            consumes: [{ artifactType: "lesson-plan", contractVersion: "shanhai-jiaoan/v2" }],
            produces: [{ artifactType: "ppt-package", contractVersion: "1.0" }],
          },
        }),
        listBusinessToolNames: () => ["create_ppt_outline"],
        resolveBusinessToolContract: () => ({ consumes: ["requirement_spec"], produces: ["ppt_draft"] }),
        listBindings: () => [{
          toolName: "create_ppt_outline",
          mode: "skill",
          skillName: "shanhai-ppt",
          compatibleVersions: ["1.0"],
          referencePaths: ["references/page-design.md"],
          contracts: {
            tool: { consumes: ["requirement_spec"], produces: ["ppt_draft"] },
            skill: {
              consumes: [{ artifactType: "lesson-plan", contractVersion: "shanhai-jiaoan/v2" }],
              produces: [{ artifactType: "ppt-package", contractVersion: "1.0" }],
            },
          },
          artifactCompatibility: {
            consumes: [{
              toolArtifactKind: "requirement_spec",
              skillContract: { artifactType: "lesson-plan", contractVersion: "shanhai-jiaoan/v2" },
              adapterId: "identity.v1",
            }],
            produces: [{
              toolArtifactKind: "ppt_draft",
              skillContract: { artifactType: "ppt-package", contractVersion: "1.0" },
              adapterId: "identity.v1",
            }],
          },
          semanticGuidance: [{
            sourcePath: "references/page-design.md",
            objective: "只提供逐页课件领域约束。",
            rules: ["保持逐页结构。"],
            exclusions: [],
          }],
        }],
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ reasonCode: "skill_runtime_binding_contract_mismatch" });
  });

  it("fails with a stable binding reason when any bound Skill is inactive or missing", async () => {
    const error = await preflightBusinessToolSkillRuntime({
      mode: "required",
      env: { NODE_ENV: "test", SHANHAI_SKILLS_RUNTIME_ROOT: "runtime-projection" },
      dependencies: {
        openRegistry: async () => registryFixture(new Set([
          "shanhai-jiaoan",
          "shanhai-ppt",
          "shanhai-video",
          "shanhai-imagegen",
        ])),
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ reasonCode: "skill_runtime_binding_missing_or_inactive" });
    expect(String((error as Error).message)).not.toContain("shanhai-video-generation");
  });

  it("preserves the stable lock digest reason without leaking integrity details", async () => {
    const error = await preflightBusinessToolSkillRuntime({
      mode: "required",
      env: { NODE_ENV: "test", SHANHAI_SKILLS_RUNTIME_ROOT: "runtime-projection" },
      dependencies: {
        openRegistry: async () => {
          throw { reasonCode: "skill_runtime_lock_digest_mismatch", detail: "private projection path" };
        },
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ reasonCode: "skill_runtime_lock_digest_mismatch" });
    expect(String((error as Error).message)).not.toMatch(/private|path|runtime-projection/i);
  });

  it("sanitizes registry failures without leaking configured paths", async () => {
    const error = await preflightBusinessToolSkillRuntime({
      mode: "required",
      env: { NODE_ENV: "test", SHANHAI_SKILLS_RUNTIME_ROOT: "E:\\private\\skill-runtime" },
      dependencies: {
        openRegistry: async () => { throw new Error("failed at E:\\private\\skill-runtime with token=secret"); },
      },
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ reasonCode: "skill_runtime_registry_invalid" });
    expect(String((error as Error).message)).not.toMatch(/E:\\private|token|secret/i);
  });
});

function registryFixture(
  activeInput: Set<string> | Map<string, string>,
  contracts: Record<string, { consumes: Array<{ artifactType: string; contractVersion: string }>; produces: Array<{ artifactType: string; contractVersion: string }> }> = {},
) {
  const activeVersions = activeInput instanceof Map
    ? activeInput
    : new Map([...activeInput].map((name) => [name, defaultSkillVersion(name)]));
  const skills = [...activeVersions].map(([name, version]) => {
    const safety = safetyContractForSkill(name);
    return {
      name,
      version,
      displayName: name,
      responsibility: "fixture",
      triggers: [],
      inputArtifacts: [],
      outputArtifacts: [],
      contracts: contracts[name] ?? contractsForSkill(name),
      capabilities: safety.capabilities,
      sideEffects: safety.sideEffects,
      humanGateConditions: safety.humanGateConditions,
      upstream: [],
      downstream: [],
      status: "active" as const,
    };
  });
  return {
    discoverActive: () => structuredClone(skills),
    get: (name: string) => {
      if (!activeVersions.has(name)) throw new Error("inactive");
      return {
        ...skills.find((skill) => skill.name === name)!,
        directory: name,
        entrypoint: "SKILL.md",
        skillRoot: name,
        entrypointPath: `${name}/SKILL.md`,
      };
    },
    getProjectionLockDigest: () => "a".repeat(64),
    validateReferencePaths: async () => {},
    loadContractSchemasForLoader: async (name: string) => formalSchemasForSkill(name),
  };
}

function defaultSkillVersion(name: string) {
  if (name === "shanhai-jiaoan") return "1.1";
  if (name === "shanhai-video") return "1.2";
  if (name === "shanhai-imagegen" || name === "shanhai-video-generation") return "1.1";
  if (name === "shanhai-delivery") return "1.3";
  return "1.0";
}

function contractsForSkill(name: string) {
  if (name === "shanhai-jiaoan") return {
    consumes: [{ artifactType: "textbook-evidence", contractVersion: "shanhai-jiaocai/v1" }],
    produces: [{ artifactType: "lesson-plan", contractVersion: "shanhai-jiaoan/v2" }],
  };
  if (name === "shanhai-ppt") return {
    consumes: [{ artifactType: "lesson-plan", contractVersion: "shanhai-jiaoan/v2" }],
    produces: [{ artifactType: "ppt-package", contractVersion: "1.0" }],
  };
  if (name === "shanhai-video") return {
    consumes: [{ artifactType: "lesson-plan", contractVersion: "shanhai-jiaoan/v2" }],
    produces: [{ artifactType: "video-package", contractVersion: "shanhai-video/v1" }],
  };
  if (name === "shanhai-imagegen") return {
    consumes: [],
    produces: [{ artifactType: "image-generation-result", contractVersion: "shanhai-imagegen/v2" }],
  };
  if (name === "shanhai-video-generation") return {
    consumes: [{ artifactType: "video-package", contractVersion: "shanhai-video/v1" }],
    produces: [{ artifactType: "video-generation-result", contractVersion: "shanhai-video-generation/v2" }],
  };
  if (name === "shanhai-delivery") return {
    consumes: [
      { artifactType: "lesson-plan", contractVersion: "shanhai-jiaoan/v2" },
      { artifactType: "ppt-package", contractVersion: "1.0" },
      { artifactType: "image-generation-result", contractVersion: "shanhai-imagegen/v2" },
      { artifactType: "video-package", contractVersion: "shanhai-video/v1" },
      { artifactType: "video-generation-result", contractVersion: "shanhai-video-generation/v2" },
    ],
    produces: [{ artifactType: "delivery-package", contractVersion: "shanhai-delivery/v2" }],
  };
  return { consumes: [], produces: [] };
}

function formalSchemasForSkill(name: string) {
  return contractsForSkill(name).produces.map((contract) => ({
    artifactType: contract.artifactType,
    contractVersion: contract.contractVersion,
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { schemaVersion: { const: contract.contractVersion } },
    },
    schemaSha256: `sha256:${"a".repeat(64)}`,
  }));
}

function safetyContractForSkill(
  name: string,
): Pick<SkillDescriptor, "capabilities" | "sideEffects" | "humanGateConditions"> {
  if (name === "shanhai-imagegen") return {
    capabilities: { required: ["image.generate", "artifact.write", "quality.validate"], optional: [] },
    sideEffects: ["artifact_write", "external_generation"],
    humanGateConditions: ["missing_authorization", "paid_external_generation"],
  };
  if (name === "shanhai-video-generation") return {
    capabilities: {
      required: ["artifact.read", "artifact.write", "video.generate", "video.query", "media.download"],
      optional: ["quality.validate"],
    },
    sideEffects: ["artifact_write", "external_generation"],
    humanGateConditions: ["missing_authorization", "paid_external_generation"],
  };
  if (name === "shanhai-delivery") return {
    capabilities: { required: ["artifact.read", "archive.write", "file.hash", "quality.validate"], optional: [] },
    sideEffects: ["artifact_write"],
    humanGateConditions: ["missing_authorization"],
  };
  return {
    capabilities: { required: [], optional: [] },
    sideEffects: [],
    humanGateConditions: [],
  };
}
