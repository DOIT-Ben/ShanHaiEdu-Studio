import type { LoadedSkill } from "./skill-loader";
import {
  businessToolSkillBindingDigest,
  hasCompatibleBusinessToolSkillArtifacts,
  hasValidBusinessToolSemanticGuidance,
  type BusinessToolSkillPolicy,
} from "./business-tool-skill-bindings";
import { businessSkillValidationCacheKey, createBusinessToolSkillResultValidator } from "./business-tool-skill-result-validator";
import type {
  BusinessToolSkillContext,
  BusinessToolSkillResultValidation,
  BusinessToolSkillSafetyContract,
} from "./business-tool-skill-runtime";
import { compileSemanticGuidance, assertLoadedSkillProvenance, sameSkillContracts } from "./business-tool-skill-runtime-execution-helpers";

export function createBusinessToolSkillRuntimeCore(dependencies: {
  resolveBusinessSkillPolicy: (toolName: string) => BusinessToolSkillPolicy | undefined;
  loadSelected: (input: {
    selectedBy: "main_agent";
    skillName: string;
    referencePaths: string[];
  }) => Promise<LoadedSkill>;
  resolveBusinessToolSafetyContract: (toolName: string) => BusinessToolSkillSafetyContract;
  assertBusinessToolSkillSafetyParity: (
    descriptor: LoadedSkill["descriptor"],
    contract: BusinessToolSkillSafetyContract,
  ) => void;
  createPreflightError: (reasonCode: import("./business-tool-skill-runtime").SkillRuntimePreflightReason) => Error;
}) {
  const loadedFormalBindings = new Map<string, { policy: Extract<BusinessToolSkillPolicy, { mode: "skill" }>; loaded: LoadedSkill }>();
  const validateSelectedToolResult = createBusinessToolSkillResultValidator({ loadedFormalBindings });

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
        throw dependencies.createPreflightError("skill_runtime_binding_contract_mismatch");
      }
      if (policy.mode === "skill") {
        if (!sameSkillContracts(policy.contracts.skill.consumes, loaded.descriptor.contracts.consumes) ||
            !sameSkillContracts(policy.contracts.skill.produces, loaded.descriptor.contracts.produces) ||
            !hasCompatibleBusinessToolSkillArtifacts({ policy, skillContracts: loaded.descriptor.contracts })) {
          throw dependencies.createPreflightError("skill_runtime_binding_contract_mismatch");
        }
        dependencies.assertBusinessToolSkillSafetyParity(
          loaded.descriptor,
          dependencies.resolveBusinessToolSafetyContract(policy.toolName),
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
            .map((guidance) => ({ sourcePath: guidance.sourcePath, content: compileSemanticGuidance(guidance) }))
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
    validateSelectedToolResult: validateSelectedToolResult as (
      input: { businessToolName: string; context: BusinessToolSkillContext; result: import("@/server/tools/tool-types").ToolExecutionResult }
    ) => Promise<BusinessToolSkillResultValidation>,
  };
}
