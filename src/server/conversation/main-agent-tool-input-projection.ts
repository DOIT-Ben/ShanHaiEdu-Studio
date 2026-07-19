import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import type { AgentToolArtifactRef } from "@/server/tools/agent-tool-invocation";
import type { ArtifactRecord, ProjectRecord } from "@/server/workbench/types";

import { resolveProjectSemanticScope } from "./project-semantic-scope";
import type { TaskBrief } from "./task-contract";

export function toRuntimeProjectContext(project: ProjectRecord, taskBrief?: TaskBrief) {
  const teacherGoal = taskBrief?.goal ?? project.title;
  const scope = resolveProjectSemanticScope(project, teacherGoal);
  return {
    ...scope,
    textbookVersion: project.textbookVersion ?? undefined,
    teacherGoal,
    requestedOutputs: taskBrief?.requestedOutputs ?? [],
  };
}

export function toApprovedRuntimeArtifact(artifact: ArtifactRecord) {
  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    version: artifact.version,
    digest: artifactDigest(artifact),
    nodeKey: artifact.nodeKey,
    title: artifact.title,
    summary: artifact.summary,
    markdown: artifact.markdownContent,
  };
}

export function resolveReviewTarget(
  argumentsValue: Record<string, unknown>,
  artifacts: ArtifactRecord[],
): AgentToolArtifactRef | null {
  const direct = isRecord(argumentsValue.courseAnchorRef) && typeof argumentsValue.courseAnchorRef.artifactId === "string"
    ? argumentsValue.courseAnchorRef.artifactId
    : null;
  const locator = Array.isArray(argumentsValue.targetLocators)
    ? argumentsValue.targetLocators.find((item) =>
        isRecord(item) && item.kind === "artifact" && typeof item.artifactId === "string")
    : null;
  const artifactId = direct ?? (isRecord(locator) ? locator.artifactId as string : null);
  const artifact = artifactId ? artifacts.find((item) => item.id === artifactId) : undefined;
  return artifact ? toArtifactRef(artifact) : null;
}

export function toArtifactRef(artifact: ArtifactRecord): AgentToolArtifactRef {
  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    version: artifact.version,
    digest: artifactDigest(artifact),
  };
}

export function resolveBusinessToolInstruction(argumentsValue: Record<string, unknown>, fallback: string) {
  const toolInstruction = typeof argumentsValue.userInstruction === "string"
    ? argumentsValue.userInstruction.trim()
    : "";
  return toolInstruction || fallback;
}

function artifactDigest(artifact: ArtifactRecord) {
  return hashArtifactDraft({
    nodeKey: artifact.nodeKey,
    kind: artifact.kind,
    title: artifact.title,
    summary: artifact.summary,
    markdownContent: artifact.markdownContent,
    structuredContent: artifact.structuredContent,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
