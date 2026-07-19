import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import type { ArtifactRecord } from "@/server/workbench/types";

import { selectLatestGenerationSources } from "./generation-source-binding";
import type { ToolDefinition } from "./tool-types";

type ArtifactResolutionInput = {
  tool: Pick<ToolDefinition, "primarySourceArtifactKind" | "requiredArtifactKinds">;
  projectId: string;
  artifactRefs: readonly { kind: string; artifactId: string }[];
  resolvedArtifacts?: readonly ArtifactRecord[];
};

export function findMissingArtifactKinds(
  requiredArtifactKinds: string[],
  input: ArtifactResolutionInput,
) {
  return requiredArtifactKinds.filter((kind) => !findResolvedArtifact(input, kind));
}

export function findPrimarySourceArtifact(input: ArtifactResolutionInput) {
  const kind = input.tool.primarySourceArtifactKind;
  return kind && input.tool.requiredArtifactKinds.includes(kind)
    ? findResolvedArtifact(input, kind)
    : undefined;
}

export function findResolvedArtifact(input: ArtifactResolutionInput, kind: string) {
  const allowedIds = new Set(input.artifactRefs
    .filter((artifactRef) => artifactRef.kind === kind && artifactRef.artifactId.trim())
    .map((artifactRef) => artifactRef.artifactId));
  return selectLatestGenerationSources({
    requiredArtifactKinds: [kind],
    primarySourceArtifactKind: kind,
    artifacts: (input.resolvedArtifacts ?? []).filter((artifact) =>
      allowedIds.has(artifact.id) && artifact.projectId === input.projectId),
    isTrusted: isArtifactTrustedForDownstream,
  })?.[0];
}
