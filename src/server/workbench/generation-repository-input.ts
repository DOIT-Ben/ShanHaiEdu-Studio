import type { PrismaClient } from "@/generated/prisma/client";
import { canonicalizeRunInput, hashRunInput } from "@/server/execution/run-input-snapshot";
import type { CreateGenerationJobInput } from "./types";

export async function prepareGenerationJobInput(
  client: PrismaClient,
  projectId: string,
  input: CreateGenerationJobInput,
) {
  const [project, sourceArtifact] = await Promise.all([
    client.project.findUnique({ where: { id: projectId }, select: { intentEpoch: true } }),
    client.artifact.findFirst({
      where: { id: input.sourceArtifactId, projectId },
      select: { id: true, nodeKey: true, kind: true, version: true, updatedAt: true },
    }),
  ]);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  if (!sourceArtifact) throw new Error(`Artifact not found: ${input.sourceArtifactId}`);

  const capabilityId = input.capabilityId?.trim() || input.kind;
  const sourceArtifactIds = input.sourceArtifactIds?.length ? [...input.sourceArtifactIds] : [sourceArtifact.id];
  const payload = {
    projectId,
    intentEpoch: project.intentEpoch,
    capabilityId,
    kind: input.kind,
    sourceArtifactIds,
    sourceArtifact: {
      id: sourceArtifact.id,
      nodeKey: sourceArtifact.nodeKey,
      kind: sourceArtifact.kind,
      version: sourceArtifact.version,
      updatedAt: sourceArtifact.updatedAt,
    },
    input: { ...(input.inputSnapshot ?? {}), ...(input.unitId?.trim() ? { unitId: input.unitId.trim() } : {}) },
  };
  const inputHash = hashRunInput(payload);
  const payloadJson = canonicalizeRunInput(payload);
  const idempotencyKey = input.idempotencyKey?.trim()
    || `generation:${capabilityId}:${sourceArtifact.id}:unit:${input.unitId?.trim() || "whole"}:epoch:${project.intentEpoch}`;
  if (!idempotencyKey) throw new Error("GenerationJob idempotencyKey is required.");

  return {
    capabilityId,
    sourceArtifactIds,
    intentEpoch: project.intentEpoch,
    inputHash,
    payloadJson,
    idempotencyKey,
  };
}

export function isUniqueConstraintError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

export function isSqliteWriteContentionError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  return code === "P1008" || message.includes("operation has timed out") || message.includes("database is locked");
}

export function waitForConcurrentCommit(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
