import type { LoadedSkill } from "./skill-loader";
import type { SemanticBoundBusinessToolPolicy } from "./business-tool-skill-bindings";

export function assertLoadedSkillProvenance(policy: SemanticBoundBusinessToolPolicy, loaded: LoadedSkill) {
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

export function compileSemanticGuidance(guidance: SemanticBoundBusinessToolPolicy["semanticGuidance"][number]) {
  return [
    `目标：${guidance.objective}`,
    ...guidance.rules.map((rule) => `要求：${rule}`),
    ...guidance.exclusions.map((exclusion) => `排除：${exclusion}`),
  ].join("\n");
}

export function sameSkillContracts(
  expected: Array<{ artifactType: string; contractVersion: string }>,
  actual: Array<{ artifactType: string; contractVersion: string }>,
) {
  const normalize = (items: Array<{ artifactType: string; contractVersion: string }>) => items
    .map(({ artifactType, contractVersion }) => `${artifactType}@${contractVersion}`)
    .sort();
  return JSON.stringify(normalize(expected)) === JSON.stringify(normalize(actual));
}
