import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import { artifactSatisfiesRequestedOutput } from "@/server/quality/artifact-output-verifier";
import { isArtifactBoundToRequestedOutput } from "@/server/quality/artifact-truth-boundary";
import type { ArtifactRecord } from "@/server/workbench/types";

import type { TaskBrief } from "./task-contract";

export function evaluateTaskCompletionContract(taskBrief: TaskBrief | undefined, artifacts: ArtifactRecord[]) {
  const remainingRequestedOutputs = taskBrief ? findRemainingRequestedOutputs(taskBrief, artifacts) : [];
  return {
    status: remainingRequestedOutputs.length === 0 ? "satisfied" as const : "unsatisfied" as const,
    remainingRequestedOutputs,
  };
}

export function findRemainingRequestedOutputs(taskBrief: TaskBrief, artifacts: ArtifactRecord[]): string[] {
  const boundTrustedArtifacts = artifacts.filter((artifact) =>
    isArtifactTrustedForDownstream(artifact) && isArtifactBoundToRequestedOutput(artifact, taskBrief));
  return taskBrief.requestedOutputs.filter((output) =>
    !boundTrustedArtifacts.some((artifact) => artifactSatisfiesRequestedOutput(artifact, output)));
}
