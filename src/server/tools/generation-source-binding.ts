import type { ToolDefinition } from "./tool-types";

type GenerationSourceCandidate = {
  id: string;
  kind: string;
  nodeKey: string;
  version: number;
};

export function assertValidGenerationSourceContract(definition: ToolDefinition): void {
  const primaryKind = definition.primarySourceArtifactKind?.trim();
  if (definition.adapterKind === "provider") {
    if (!primaryKind || !definition.requiredArtifactKinds.includes(primaryKind)) {
      throw new Error(`Provider Tool must declare a required primary source Artifact kind: ${definition.id}`);
    }
  } else if (primaryKind) {
    throw new Error(`Only Provider Tools may declare a primary source Artifact kind: ${definition.id}`);
  }
}

export function orderedGenerationSourceKinds(
  requiredArtifactKinds: readonly string[],
  primarySourceArtifactKind: string | null,
): string[] | null {
  if (!primarySourceArtifactKind || requiredArtifactKinds.length === 0 ||
      new Set(requiredArtifactKinds).size !== requiredArtifactKinds.length ||
      !requiredArtifactKinds.includes(primarySourceArtifactKind)) {
    return null;
  }
  return [
    primarySourceArtifactKind,
    ...requiredArtifactKinds.filter((kind) => kind !== primarySourceArtifactKind),
  ];
}

export function selectLatestGenerationSources<T extends GenerationSourceCandidate>(input: {
  requiredArtifactKinds: readonly string[];
  primarySourceArtifactKind: string | null;
  artifacts: readonly T[];
  isTrusted: (artifact: T) => boolean;
}): T[] | null {
  const orderedKinds = orderedGenerationSourceKinds(
    input.requiredArtifactKinds,
    input.primarySourceArtifactKind,
  );
  if (!orderedKinds) return null;

  const selected: T[] = [];
  for (const kind of orderedKinds) {
    const candidates = input.artifacts.filter((artifact) =>
      artifact.kind === kind && artifact.nodeKey === kind &&
      Number.isInteger(artifact.version) && artifact.version >= 0 && input.isTrusted(artifact));
    if (candidates.length === 0) return null;
    const highestVersion = Math.max(...candidates.map((artifact) => artifact.version));
    const newest = candidates.filter((artifact) => artifact.version === highestVersion);
    if (newest.length !== 1) return null;
    selected.push(newest[0]);
  }
  return selected;
}

export function hasOrderedGenerationSourceKinds(input: {
  requiredArtifactKinds: readonly string[];
  primarySourceArtifactKind: string | null;
  sourceKinds: readonly string[];
}) {
  const expected = orderedGenerationSourceKinds(
    input.requiredArtifactKinds,
    input.primarySourceArtifactKind,
  );
  return expected !== null && expected.length === input.sourceKinds.length &&
    expected.every((kind, index) => input.sourceKinds[index] === kind);
}
