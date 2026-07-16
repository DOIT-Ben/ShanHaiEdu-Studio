import type { LoadedSkill } from "./skill-loader";
import { SkillLoader } from "./skill-loader";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import {
  SkillRegistry,
  SkillRegistryConfigurationError,
  SkillRegistryIntegrityError,
  skillRegistryConfigFromEnv,
  type SkillRegistryConfig,
} from "./skill-registry";
import {
  businessToolSkillBindingDigest,
  businessToolSkillPolicyDigest,
  hasCompatibleBusinessToolSkillArtifacts,
  hasValidBusinessToolSemanticGuidance,
  listBusinessToolSkillPolicies,
  resolveBusinessToolSkillPolicy,
  type BusinessToolSkillPolicy,
  type SemanticBoundBusinessToolPolicy,
  type SkillBoundBusinessToolPolicy,
} from "./business-tool-skill-bindings";
import { listMainAgentBusinessToolNames } from "@/server/tools/main-agent-tool-registry";
import { resolveMainAgentToolDefinition } from "@/server/tools/main-agent-tool-registry";
import type { BusinessSkillContext } from "@/server/agent-runtime/types";
import type { ToolDefinition } from "@/server/tools/tool-types";
import { actionRiskForTool } from "@/server/guards/action-policy";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { ToolExecutionResult } from "@/server/tools/tool-types";
import {
  BusinessToolSkillOutputContractError,
  validateFormalBusinessToolSkillOutput,
  type FormalBusinessToolOutputContract,
} from "./business-tool-skill-output-contract";
import type {
  SkillCapability,
  SkillDescriptor,
  SkillHumanGateCondition,
  SkillSideEffect,
} from "./skill-runtime-types";

export type BusinessToolSkillContext = BusinessSkillContext;

export type BusinessToolSkillRuntime = ReturnType<typeof createBusinessToolSkillRuntime>;

export type BusinessToolSkillResultValidation =
  | {
      status: "not_applicable";
      bindingMode: "guidance_only";
    }
  | {
      status: "passed";
      bindingMode: "formal_contract";
      contract: FormalBusinessToolOutputContract & {
        adapterId: string;
        schemaDigest: string;
        payloadDigest: string;
      };
    };

export type SkillRuntimePreflightReason =
  | "skill_runtime_config_missing"
  | "skill_runtime_config_partial"
  | "skill_runtime_config_ambiguous"
  | "skill_runtime_registry_invalid"
  | "skill_runtime_lock_digest_mismatch"
  | "skill_runtime_binding_missing_or_inactive"
  | "skill_runtime_binding_contract_mismatch"
  | "skill_runtime_capability_mismatch"
  | "skill_runtime_side_effect_mismatch"
  | "skill_runtime_human_gate_mismatch"
  | "skill_runtime_version_incompatible"
  | "skill_runtime_frozen_lock_mismatch";

export class SkillRuntimePreflightError extends Error {
  constructor(readonly reasonCode: SkillRuntimePreflightReason) {
    super(preflightMessage(reasonCode));
    this.name = "SkillRuntimePreflightError";
  }
}

type RegistrySurface = Pick<SkillRegistry,
  "discoverActive" | "get" | "getProjectionLockDigest" | "validateReferencePaths" | "loadContractSchemasForLoader"
> & Partial<Pick<SkillRegistry, "verifyIntegrity">>;

export type BusinessToolSkillSafetyContract = {
  requiredCapabilities: SkillCapability[];
  supportedCapabilities: SkillCapability[];
  sideEffects: SkillSideEffect[];
  humanGateConditions: SkillHumanGateCondition[];
};

type SkillRuntimePreflightDependencies = {
  openRegistry?: (config: SkillRegistryConfig) => Promise<RegistrySurface>;
  listBindings?: typeof listBusinessToolSkillPolicies;
  listBusinessToolNames?: typeof listMainAgentBusinessToolNames;
  resolveBusinessToolContract?: (toolName: string) => { consumes: string[]; produces: string[] };
  resolveBusinessToolSafetyContract?: (toolName: string) => BusinessToolSkillSafetyContract;
};

type ConfiguredSkillRuntimeDependencies = {
  openRegistry?: (config: SkillRegistryConfig) => Promise<RegistrySurface>;
  loadSelected?: (input: {
    selectedBy: "main_agent";
    skillName: string;
    referencePaths: string[];
  }) => Promise<LoadedSkill>;
};

export type SkillRuntimePreflightResult =
  | {
      status: "optional_not_configured";
      runtime: undefined;
      activeSkillNames: [];
      activeSkills: [];
      checkedBindingCount: 0;
      bindingPolicyDigest: null;
      projectionLockDigest: null;
    }
  | {
      status: "ready";
      runtime: BusinessToolSkillRuntime;
      activeSkillNames: string[];
      activeSkills: Array<{ name: string; version: string }>;
      checkedBindingCount: number;
      bindingPolicyDigest: string;
      projectionLockDigest: string;
    };

export function createBusinessToolSkillRuntime(dependencies: {
  resolveBusinessSkillPolicy: (toolName: string) => BusinessToolSkillPolicy | undefined;
  loadSelected: (input: {
    selectedBy: "main_agent";
    skillName: string;
    referencePaths: string[];
  }) => Promise<LoadedSkill>;
  resolveBusinessToolSafetyContract?: (toolName: string) => BusinessToolSkillSafetyContract;
}) {
  const loadedFormalBindings = new Map<string, { policy: SkillBoundBusinessToolPolicy; loaded: LoadedSkill }>();
  const schemaValidators = new Map<string, ValidateFunction>();
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateSchema: true });
  addFormats(ajv);

  return {
    async loadForSelectedTool(input: {
      selectedBy: "main_agent";
      businessToolName: string;
    }): Promise<BusinessToolSkillContext> {
      if (input.selectedBy !== "main_agent") {
        throw new Error("Only the Main Agent may select a business Tool Skill.");
      }
      const policy = dependencies.resolveBusinessSkillPolicy(input.businessToolName);
      if (!policy || policy.mode === "exempt") {
        throw new Error(`Skill binding is missing for business Tool: ${input.businessToolName}`);
      }
      const loaded = await dependencies.loadSelected({
        selectedBy: "main_agent",
        skillName: policy.skillName,
        referencePaths: policy.referencePaths,
      });
      if (loaded.descriptor.name !== policy.skillName || loaded.descriptor.status !== "active") {
        throw new Error(`Skill binding resolved an inactive or mismatched Skill: ${policy.skillName}`);
      }
      if (!policy.compatibleVersions.includes(loaded.descriptor.version)) {
        throw new Error(`Skill version is incompatible with business Tool: ${input.businessToolName}`);
      }
      if (!hasValidBusinessToolSemanticGuidance(policy)) {
        throw new SkillRuntimePreflightError("skill_runtime_binding_contract_mismatch");
      }
      if (policy.mode === "skill") {
        if (!sameSkillContracts(policy.contracts.skill.consumes, loaded.descriptor.contracts.consumes) ||
            !sameSkillContracts(policy.contracts.skill.produces, loaded.descriptor.contracts.produces) ||
            !hasCompatibleBusinessToolSkillArtifacts({
              policy,
              skillContracts: loaded.descriptor.contracts,
            })) {
          throw new SkillRuntimePreflightError("skill_runtime_binding_contract_mismatch");
        }
        assertBusinessToolSkillSafetyParity(
          loaded.descriptor,
          (dependencies.resolveBusinessToolSafetyContract ?? resolveBusinessToolSkillSafetyContract)(policy.toolName),
        );
      }
      assertLoadedSkillProvenance(policy, loaded);
      const guidanceOnly = policy.mode === "guidance";
      const responsibility = guidanceOnly
        ? policy.semanticGuidance.map((guidance) => guidance.objective).join("；")
        : loaded.descriptor.responsibility;
      const context: BusinessToolSkillContext = {
        skillName: policy.skillName,
        skillVersion: loaded.descriptor.version,
        displayName: loaded.descriptor.displayName,
        responsibility,
        semanticSlice: {
          schemaVersion: "business-tool-skill-slice.v1",
          bindingMode: guidanceOnly ? "guidance_only" : "formal_contract",
          artifactContractAuthority: guidanceOnly ? "tool" : "skill",
          toolName: policy.toolName,
          responsibility,
          contracts: structuredClone(policy.contracts),
          guidance: policy.semanticGuidance
            .map((guidance) => ({
              sourcePath: guidance.sourcePath,
              content: compileSemanticGuidance(guidance),
            }))
            .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
        },
        provenance: {
          schemaVersion: "business-tool-skill-provenance.v1",
          entrypointSha256: loaded.provenance.entrypointSha256,
          references: Object.entries(loaded.provenance.referenceSha256)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([sourcePath, sha256]) => ({ sourcePath, sha256 })),
          bindingPolicyDigest: businessToolSkillBindingDigest(policy),
        },
      };
      if (policy.mode === "skill") {
        loadedFormalBindings.set(businessSkillValidationCacheKey(context), { policy, loaded });
      }
      return context;
    },

    async validateSelectedToolResult(input: {
      businessToolName: string;
      context: BusinessToolSkillContext;
      result: ToolExecutionResult;
    }): Promise<BusinessToolSkillResultValidation> {
      if (input.context.semanticSlice.toolName !== input.businessToolName) {
        throw new BusinessToolSkillOutputContractError(
          "formal_skill_output_contract_mismatch",
          "Formal Skill context does not match the selected business Tool.",
        );
      }
      if (input.context.semanticSlice.bindingMode === "guidance_only") {
        return { status: "not_applicable", bindingMode: "guidance_only" };
      }
      if (input.result.status !== "succeeded") {
        throw new BusinessToolSkillOutputContractError(
          "formal_skill_output_source_invalid",
          "Formal Skill output validation requires a successful Tool result.",
        );
      }
      const cached = loadedFormalBindings.get(businessSkillValidationCacheKey(input.context));
      if (!cached || cached.policy.toolName !== input.businessToolName ||
          cached.policy.skillName !== input.context.skillName ||
          !cached.policy.compatibleVersions.includes(input.context.skillVersion)) {
        throw new BusinessToolSkillOutputContractError(
          "formal_skill_output_contract_mismatch",
          "Formal Skill validation context is missing or stale.",
        );
      }
      const producedArtifactKind = input.result.artifactDraft.kind;
      const mappings = cached.policy.artifactCompatibility.produces.filter((mapping) =>
        mapping.toolArtifactKind === producedArtifactKind && mapping.skillContract !== null);
      if (mappings.length !== 1) {
        throw new BusinessToolSkillOutputContractError(
          "formal_skill_output_contract_mismatch",
          "Formal Skill output contract mapping is missing or ambiguous.",
        );
      }
      const mapping = mappings[0];
      const skillContract = mapping.skillContract!;
      const schemas = (cached.loaded.contractSchemas ?? []).filter((schema) =>
        schema.artifactType === skillContract.artifactType &&
        schema.contractVersion === skillContract.contractVersion);
      if (schemas.length !== 1) {
        throw new BusinessToolSkillOutputContractError(
          "formal_skill_output_contract_mismatch",
          "Formal Skill output Schema is missing or ambiguous.",
        );
      }
      const contract: FormalBusinessToolOutputContract = {
        skillName: input.context.skillName,
        skillVersion: input.context.skillVersion,
        artifactType: skillContract.artifactType,
        contractVersion: skillContract.contractVersion,
      };
      const validated = validateFormalBusinessToolSkillOutput({
        adapterId: mapping.adapterId,
        businessToolName: input.businessToolName,
        contract,
        result: input.result,
        contractSchema: schemas[0],
        validator: ({ schema, payload }) => {
          let validate = schemaValidators.get(schemas[0].schemaSha256);
          if (!validate) {
            validate = ajv.compile(schema);
            schemaValidators.set(schemas[0].schemaSha256, validate);
          }
          const valid = validate(payload);
          return {
            valid: Boolean(valid),
            errors: valid ? [] : (validate.errors ?? []).map((error) =>
              `${error.instancePath || "/"} ${error.message ?? "is invalid"}`),
          };
        },
      });
      return {
        status: "passed",
        bindingMode: "formal_contract",
        contract: {
          ...contract,
          adapterId: validated.adapterId,
          schemaDigest: validated.schemaSha256,
          payloadDigest: `sha256:${hashRunInput(validated.payload)}`,
        },
      };
    },
  };
}

export function createConfiguredBusinessToolSkillRuntime(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: ConfiguredSkillRuntimeDependencies = {},
): BusinessToolSkillRuntime | undefined {
  const config = skillRegistryConfigFromEnv(env);
  if (!config) return undefined;
  let runtimePromise: Promise<BusinessToolSkillRuntime> | undefined;
  const resolveRuntime = () => {
    runtimePromise ??= (dependencies.openRegistry?.(config) ?? SkillRegistry.open(config)).then((registry) => {
      assertFrozenRuntimeLock(registry, env);
      const loader = dependencies.loadSelected ? undefined : new SkillLoader(registry);
      return createBusinessToolSkillRuntime({
        resolveBusinessSkillPolicy: resolveBusinessToolSkillPolicy,
        loadSelected: dependencies.loadSelected ?? ((selection) => loader!.loadSelected(selection)),
      });
    });
    return runtimePromise;
  };
  const configured: BusinessToolSkillRuntime = {
    async loadForSelectedTool(input) {
      return (await resolveRuntime()).loadForSelectedTool(input);
    },
    async validateSelectedToolResult(input) {
      return (await resolveRuntime()).validateSelectedToolResult(input);
    },
  };
  return configured;
}

export function skillRuntimeFailureReason(error: unknown): SkillRuntimePreflightReason | undefined {
  if (!error || typeof error !== "object" || !("reasonCode" in error)) return undefined;
  const reasonCode = error.reasonCode;
  return isSkillRuntimeReason(reasonCode) ? reasonCode : undefined;
}

export async function preflightBusinessToolSkillRuntime(input: {
  mode: "optional" | "required";
  env?: NodeJS.ProcessEnv;
  dependencies?: SkillRuntimePreflightDependencies;
}): Promise<SkillRuntimePreflightResult> {
  const env = input.env ?? process.env;
  let config: SkillRegistryConfig | null;
  try {
    config = skillRegistryConfigFromEnv(env);
  } catch (error) {
    if (error instanceof SkillRegistryConfigurationError) {
      throw new SkillRuntimePreflightError(error.reasonCode);
    }
    throw new SkillRuntimePreflightError("skill_runtime_registry_invalid");
  }
  if (!config) {
    if (input.mode === "required") throw new SkillRuntimePreflightError("skill_runtime_config_missing");
    return {
      status: "optional_not_configured",
      runtime: undefined,
      activeSkillNames: [],
      activeSkills: [],
      checkedBindingCount: 0,
      bindingPolicyDigest: null,
      projectionLockDigest: null,
    };
  }

  const openRegistry = input.dependencies?.openRegistry ?? ((value) => SkillRegistry.open(value));
  let registry: RegistrySurface;
  try {
    registry = await openRegistry(config);
  } catch (error) {
    if (error instanceof SkillRegistryIntegrityError || hasReasonCode(error, "skill_runtime_lock_digest_mismatch")) {
      throw new SkillRuntimePreflightError("skill_runtime_lock_digest_mismatch");
    }
    throw new SkillRuntimePreflightError("skill_runtime_registry_invalid");
  }

  const policies = (input.dependencies?.listBindings ?? listBusinessToolSkillPolicies)();
  const expectedToolNames = (input.dependencies?.listBusinessToolNames ?? listMainAgentBusinessToolNames)().sort();
  const policyToolNames = policies.map((policy) => policy.toolName).sort();
  const activeSkills = registry.discoverActive()
    .filter((skill) => skill.status === "active")
    .map((skill) => ({ name: skill.name, version: skill.version }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const activeSkillNames = activeSkills.map((skill) => skill.name);
  const active = new Map(activeSkills.map((skill) => [skill.name, skill.version]));
  const formalSchemasBySkill = new Map<string, Awaited<ReturnType<SkillRegistry["loadContractSchemasForLoader"]>>>();
  const projectionLockDigest = registry.getProjectionLockDigest();
  const resolveBusinessToolContract = input.dependencies?.resolveBusinessToolContract ?? ((toolName: string) => {
    const tool = resolveMainAgentToolDefinition(toolName);
    if (typeof tool.internalToolId !== "string") throw new Error("not a business Tool");
    return {
      consumes: [...tool.requiredArtifactKinds],
      produces: tool.producedArtifactKind ? [tool.producedArtifactKind] : [],
    };
  });
  const resolveBusinessToolSafetyContract = input.dependencies?.resolveBusinessToolSafetyContract ??
    resolveBusinessToolSkillSafetyContract;
  try {
    if (policies.length === 0 || new Set(policyToolNames).size !== policyToolNames.length) throw new Error("invalid policies");
    if (JSON.stringify(policyToolNames) !== JSON.stringify(expectedToolNames)) throw new Error("incomplete policies");
    if (!projectionLockDigest || !/^[a-f0-9]{64}$/i.test(projectionLockDigest)) throw new Error("projection lock missing");
    for (const policy of policies) {
      if (policy.mode === "exempt") continue;
      const version = active.get(policy.skillName);
      if (!version) throw new Error("inactive binding");
      if (!policy.compatibleVersions.includes(version)) {
        throw new SkillRuntimePreflightError("skill_runtime_version_incompatible");
      }
      const resolved = registry.get(policy.skillName);
      if (resolved.name !== policy.skillName || resolved.status !== "active") throw new Error("mismatched binding");
      const actualToolContract = resolveBusinessToolContract(policy.toolName);
      if (!sameTextSet(policy.contracts.tool.consumes, actualToolContract.consumes) ||
          !sameTextSet(policy.contracts.tool.produces, actualToolContract.produces) ||
          !hasValidBusinessToolSemanticGuidance(policy)) {
        throw new SkillRuntimePreflightError("skill_runtime_binding_contract_mismatch");
      }
      if (policy.mode === "skill") {
        if (!sameSkillContracts(policy.contracts.skill.consumes, resolved.contracts.consumes) ||
            !sameSkillContracts(policy.contracts.skill.produces, resolved.contracts.produces) ||
            !hasCompatibleBusinessToolSkillArtifacts({
              policy,
              toolContract: actualToolContract,
              skillContracts: resolved.contracts,
            })) {
          throw new SkillRuntimePreflightError("skill_runtime_binding_contract_mismatch");
        }
        assertBusinessToolSkillSafetyParity(
          resolved,
          resolveBusinessToolSafetyContract(policy.toolName),
        );
        let schemas = formalSchemasBySkill.get(policy.skillName);
        if (!schemas) {
          try {
            schemas = await registry.loadContractSchemasForLoader(policy.skillName);
          } catch {
            throw new SkillRuntimePreflightError("skill_runtime_binding_contract_mismatch");
          }
          formalSchemasBySkill.set(policy.skillName, schemas);
        }
        if (!formalSkillSchemasMatch(policy, schemas)) {
          throw new SkillRuntimePreflightError("skill_runtime_binding_contract_mismatch");
        }
      }
      await registry.validateReferencePaths(policy.skillName, policy.referencePaths);
    }
  } catch (error) {
    if (error instanceof SkillRuntimePreflightError) throw error;
    throw new SkillRuntimePreflightError("skill_runtime_binding_missing_or_inactive");
  }

  return {
    status: "ready",
    runtime: createRuntimeFromRegistry(registry),
    activeSkillNames,
    activeSkills,
    checkedBindingCount: policies.length,
    bindingPolicyDigest: businessToolSkillPolicyDigest(),
    projectionLockDigest,
  };
}

function createRuntimeFromRegistry(
  registry: Pick<SkillRegistry, "get" | "loadContractSchemasForLoader"> & Partial<Pick<SkillRegistry, "verifyIntegrity">>,
) {
  const loader = new SkillLoader(registry);
  return createBusinessToolSkillRuntime({
    resolveBusinessSkillPolicy: resolveBusinessToolSkillPolicy,
    loadSelected: (selection) => loader.loadSelected(selection),
  });
}

function formalSkillSchemasMatch(
  policy: SkillBoundBusinessToolPolicy,
  schemas: Awaited<ReturnType<SkillRegistry["loadContractSchemasForLoader"]>>,
) {
  const expected = policy.contracts.skill.produces;
  if (schemas.length !== expected.length) return false;
  return expected.every((contract) => schemas.filter((schema) =>
    schema.artifactType === contract.artifactType &&
    schema.contractVersion === contract.contractVersion &&
    /^sha256:[a-f0-9]{64}$/i.test(schema.schemaSha256)
  ).length === 1);
}

function hasReasonCode(value: unknown, reasonCode: SkillRuntimePreflightReason) {
  return typeof value === "object" && value !== null && "reasonCode" in value && value.reasonCode === reasonCode;
}

function assertFrozenRuntimeLock(registry: Pick<SkillRegistry, "getProjectionLockDigest">, env: NodeJS.ProcessEnv) {
  const expectedProjection = env.SHANHAI_SKILLS_EXPECTED_PROJECTION_LOCK_DIGEST?.trim().toLowerCase();
  const expectedPolicy = env.SHANHAI_SKILLS_EXPECTED_BINDING_POLICY_DIGEST?.trim().toLowerCase();
  if (!expectedProjection && !expectedPolicy) return;
  const actualProjection = registry.getProjectionLockDigest()?.toLowerCase();
  const actualPolicy = businessToolSkillPolicyDigest().toLowerCase();
  if (!isDigest(expectedProjection) || !isDigest(expectedPolicy) ||
      actualProjection !== expectedProjection || actualPolicy !== expectedPolicy) {
    throw new SkillRuntimePreflightError("skill_runtime_frozen_lock_mismatch");
  }
}

function isDigest(value: string | undefined): value is string {
  return Boolean(value && /^[a-f0-9]{64}$/i.test(value));
}

function isSkillRuntimeReason(value: unknown): value is SkillRuntimePreflightReason {
  return value === "skill_runtime_config_missing" || value === "skill_runtime_config_partial" ||
    value === "skill_runtime_config_ambiguous" || value === "skill_runtime_registry_invalid" ||
    value === "skill_runtime_lock_digest_mismatch" || value === "skill_runtime_binding_missing_or_inactive" ||
    value === "skill_runtime_binding_contract_mismatch" || value === "skill_runtime_capability_mismatch" ||
    value === "skill_runtime_side_effect_mismatch" || value === "skill_runtime_human_gate_mismatch" ||
    value === "skill_runtime_version_incompatible" ||
    value === "skill_runtime_frozen_lock_mismatch";
}

function preflightMessage(reasonCode: SkillRuntimePreflightReason) {
  const messages: Record<SkillRuntimePreflightReason, string> = {
    skill_runtime_config_missing: "Skill Runtime configuration is required.",
    skill_runtime_config_partial: "Skill Runtime configuration is incomplete.",
    skill_runtime_config_ambiguous: "Skill Runtime configuration has multiple sources.",
    skill_runtime_registry_invalid: "Skill Runtime registry could not be validated.",
    skill_runtime_lock_digest_mismatch: "Skill Runtime projection integrity check failed.",
    skill_runtime_binding_missing_or_inactive: "Business Tool Skill bindings are incomplete.",
    skill_runtime_binding_contract_mismatch: "Business Tool Skill contracts do not match.",
    skill_runtime_capability_mismatch: "Business Tool Skill capabilities do not match.",
    skill_runtime_side_effect_mismatch: "Business Tool Skill side effects do not match.",
    skill_runtime_human_gate_mismatch: "Business Tool Skill HumanGate conditions do not match.",
    skill_runtime_version_incompatible: "Business Tool Skill version is incompatible.",
    skill_runtime_frozen_lock_mismatch: "Skill Runtime frozen lock does not match.",
  };
  return messages[reasonCode];
}

function assertLoadedSkillProvenance(policy: SemanticBoundBusinessToolPolicy, loaded: LoadedSkill) {
  if (!/^sha256:[a-f0-9]{64}$/i.test(loaded.provenance?.entrypointSha256 ?? "")) {
    throw new Error(`Skill entrypoint provenance is missing for business Tool: ${policy.toolName}`);
  }
  for (const referencePath of policy.referencePaths) {
    if (!(referencePath in loaded.references) ||
        !/^sha256:[a-f0-9]{64}$/i.test(loaded.provenance.referenceSha256[referencePath] ?? "")) {
      throw new Error(`Skill reference provenance is missing for business Tool: ${policy.toolName}`);
    }
  }
}

function compileSemanticGuidance(guidance: SemanticBoundBusinessToolPolicy["semanticGuidance"][number]) {
  return [
    `目标：${guidance.objective}`,
    ...guidance.rules.map((rule) => `要求：${rule}`),
    ...guidance.exclusions.map((exclusion) => `排除：${exclusion}`),
  ].join("\n");
}

function businessSkillValidationCacheKey(context: BusinessToolSkillContext) {
  return hashRunInput({
    toolName: context.semanticSlice.toolName,
    skillName: context.skillName,
    skillVersion: context.skillVersion,
    bindingPolicyDigest: context.provenance.bindingPolicyDigest,
    entrypointSha256: context.provenance.entrypointSha256,
    references: context.provenance.references,
  });
}

function sameTextSet(left: string[], right: string[]) {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function sameSkillContracts(
  expected: Array<{ artifactType: string; contractVersion: string }>,
  actual: Array<{ artifactType: string; contractVersion: string }>,
) {
  const normalize = (items: Array<{ artifactType: string; contractVersion: string }>) => items
    .map(({ artifactType, contractVersion }) => `${artifactType}@${contractVersion}`)
    .sort();
  return JSON.stringify(normalize(expected)) === JSON.stringify(normalize(actual));
}

function resolveBusinessToolSkillSafetyContract(toolName: string): BusinessToolSkillSafetyContract {
  const tool = resolveMainAgentToolDefinition(toolName);
  if (typeof tool.internalToolId !== "string") {
    throw new SkillRuntimePreflightError("skill_runtime_capability_mismatch");
  }
  const capabilityProfile = capabilityProfileForTool(tool);
  const sideEffects = skillSideEffectsForTool(tool);
  return {
    requiredCapabilities: capabilityProfile.required,
    supportedCapabilities: capabilityProfile.supported,
    sideEffects,
    humanGateConditions: humanGateConditionsForTool(tool, sideEffects),
  };
}

function capabilityProfileForTool(tool: ToolDefinition & { internalToolId: string }) {
  const supported = new Set<SkillCapability>();
  if (tool.requiredArtifactKinds.length > 0) supported.add("artifact.read");
  if (tool.producedArtifactKind) supported.add("artifact.write");
  supported.add("quality.validate");

  let required: SkillCapability[];
  if (tool.providerToolId?.startsWith("image_asset.")) {
    supported.add("image.generate");
    required = ["image.generate", "artifact.write", "quality.validate"];
  } else if (tool.providerToolId === "video_segment_generate.generate") {
    for (const capability of ["video.generate", "video.query", "media.download"] as const) {
      supported.add(capability);
    }
    required = ["artifact.read", "artifact.write", "video.generate", "video.query", "media.download"];
  } else if (tool.internalToolId === "create_final_package") {
    for (const capability of ["archive.write", "file.hash"] as const) {
      supported.add(capability);
    }
    required = ["artifact.read", "archive.write", "file.hash", "quality.validate"];
  } else {
    throw new SkillRuntimePreflightError("skill_runtime_capability_mismatch");
  }

  return {
    required: [...required].sort(),
    supported: [...supported].sort(),
  };
}

function skillSideEffectsForTool(tool: Pick<ToolDefinition, "sideEffectLevel" | "producedArtifactKind">): SkillSideEffect[] {
  switch (tool.sideEffectLevel) {
    case "none":
      return [];
    case "artifact_write":
    case "file_write":
    case "package_write":
      return ["artifact_write"];
    case "external_call":
      return tool.producedArtifactKind
        ? ["artifact_write", "external_generation"]
        : ["external_generation"];
  }
}

function humanGateConditionsForTool(
  tool: Pick<ToolDefinition, "adapterKind" | "sideEffectLevel">,
  sideEffects: SkillSideEffect[],
): SkillHumanGateCondition[] {
  const conditions = new Set<SkillHumanGateCondition>(["missing_authorization"]);
  if (actionRiskForTool(tool) === "external_generation") conditions.add("paid_external_generation");
  if (sideEffects.includes("external_publish")) conditions.add("external_publish");
  if (sideEffects.includes("destructive_write")) conditions.add("destructive_write");
  return [...conditions].sort();
}

function assertBusinessToolSkillSafetyParity(
  descriptor: SkillDescriptor,
  contract: BusinessToolSkillSafetyContract,
) {
  if (!isSubset(descriptor.capabilities.required, contract.supportedCapabilities) ||
      !isSubset(contract.requiredCapabilities, descriptor.capabilities.required)) {
    throw new SkillRuntimePreflightError("skill_runtime_capability_mismatch");
  }
  if (!sameTextSet(descriptor.sideEffects, contract.sideEffects)) {
    throw new SkillRuntimePreflightError("skill_runtime_side_effect_mismatch");
  }
  if (!sameTextSet(descriptor.humanGateConditions, contract.humanGateConditions)) {
    throw new SkillRuntimePreflightError("skill_runtime_human_gate_mismatch");
  }
}

function isSubset(left: string[], right: string[]) {
  const allowed = new Set(right);
  return left.every((value) => allowed.has(value));
}
