import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { ToolExecutionResult } from "@/server/tools/tool-types";
import {
  BusinessToolSkillOutputContractError,
  validateFormalBusinessToolSkillOutput,
  type FormalBusinessToolOutputContract,
} from "./business-tool-skill-output-contract";
import type { LoadedSkill } from "./skill-loader";
import type {
  BusinessToolSkillContext,
  BusinessToolSkillResultValidation,
} from "./business-tool-skill-runtime";
import type { SkillBoundBusinessToolPolicy } from "./business-tool-skill-bindings";

export function createBusinessToolSkillResultValidator(input: {
  loadedFormalBindings: Map<string, { policy: SkillBoundBusinessToolPolicy; loaded: LoadedSkill }>;
}): (input: {
  businessToolName: string;
  context: BusinessToolSkillContext;
  result: ToolExecutionResult;
}) => Promise<BusinessToolSkillResultValidation> {
  const schemaValidators = new Map<string, ValidateFunction>();
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateSchema: true });
  addFormats(ajv);

  return async (value) => {
    if (value.context.semanticSlice.toolName !== value.businessToolName) {
      throw new BusinessToolSkillOutputContractError(
        "formal_skill_output_contract_mismatch",
        "Formal Skill context does not match the selected business Tool.",
      );
    }
    if (value.context.semanticSlice.bindingMode === "guidance_only") {
      return { status: "not_applicable", bindingMode: "guidance_only" };
    }
    if (value.result.status !== "succeeded") {
      throw new BusinessToolSkillOutputContractError(
        "formal_skill_output_source_invalid",
        "Formal Skill output validation requires a successful Tool result.",
      );
    }
    const cached = input.loadedFormalBindings.get(businessSkillValidationCacheKey(value.context));
    if (!cached || cached.policy.toolName !== value.businessToolName ||
        cached.policy.skillName !== value.context.skillName ||
        !cached.policy.compatibleVersions.includes(value.context.skillVersion)) {
      throw new BusinessToolSkillOutputContractError(
        "formal_skill_output_contract_mismatch",
        "Formal Skill validation context is missing or stale.",
      );
    }
    const producedArtifactKind = value.result.artifactDraft.kind;
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
      skillName: value.context.skillName,
      skillVersion: value.context.skillVersion,
      artifactType: skillContract.artifactType,
      contractVersion: skillContract.contractVersion,
    };
    const validated = validateFormalBusinessToolSkillOutput({
      adapterId: mapping.adapterId,
      businessToolName: value.businessToolName,
      contract,
      result: value.result,
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
  };
}

export function businessSkillValidationCacheKey(context: BusinessToolSkillContext) {
  return hashRunInput({
    toolName: context.semanticSlice.toolName,
    skillName: context.skillName,
    skillVersion: context.skillVersion,
    bindingPolicyDigest: context.provenance.bindingPolicyDigest,
    entrypointSha256: context.provenance.entrypointSha256,
    references: context.provenance.references,
  });
}
