import type { PrismaClient } from "@/generated/prisma/client";
import { hasValidValidationReportDigest, hashArtifactDraft } from "@/server/contracts/contract-validator";
import { prisma } from "@/server/db/client";
import { assertExecutionIdentityCanWriteProject } from "@/server/execution/execution-identity";
import { ProjectExecutionLeaseRejectedError } from "@/server/execution/project-execution-lease";
import type { ProjectExecutionGuard } from "@/server/workbench/types";
import { assertActiveProjectForWrite } from "@/server/workbench/project-lifecycle-service";
import { hasValidCriticReportDigest, resolveEffectiveRubric } from "./critic-report";
import { hasValidQualityDecisionDigest } from "./quality-decision-engine";
import type { CriticReport, EffectiveRubric, QualityDecision, QualityTarget, ValidationReport } from "./quality-types";

export function createQualityReportRepository(client: PrismaClient = prisma) {
  return {
    async persistQualityReview(input: {
      projectId: string;
      criticReport: CriticReport;
      qualityDecision: QualityDecision;
      rubric: EffectiveRubric;
      guard: ProjectExecutionGuard;
    }) {
      return client.$transaction(async (tx) => {
        await assertActiveProjectForWrite(tx, input.projectId);
        await assertQualityPersistenceGuard(tx, input.projectId, input.guard);
        assertQualityPayloadIntegrity(input.criticReport, input.qualityDecision, input.rubric);

        const artifact = await tx.artifact.findFirst({
          where: { id: input.criticReport.target.artifactId, projectId: input.projectId },
        });
        if (!artifact) throw new Error("Quality target Artifact not found.");
        const latest = await tx.artifact.findFirst({
          where: { projectId: input.projectId, nodeKey: artifact.nodeKey },
          orderBy: { version: "desc" },
          select: { id: true, version: true },
        });
        if (!latest || latest.id !== artifact.id || artifact.version !== input.criticReport.target.artifactVersion) {
          throw new Error("Quality target is not the current Artifact version.");
        }
        const currentDigest = hashArtifactDraft({
          nodeKey: artifact.nodeKey,
          kind: artifact.kind,
          title: artifact.title,
          summary: artifact.summary,
          markdownContent: artifact.markdownContent,
          structuredContent: parseObject(artifact.structuredContentJson),
        });
        if (currentDigest !== input.criticReport.target.artifactDigest) {
          throw new Error("Quality target digest mismatch.");
        }

        const validationRecords = await tx.validationReportRecord.findMany({
          where: {
            projectId: input.projectId,
            id: { in: input.criticReport.validationReportRefs.map((ref) => ref.reportId) },
          },
        });
        assertValidationBindings(input.criticReport, validationRecords, artifact.id);

        let criticRecord = await tx.criticReportRecord.findUnique({
          where: {
            projectId_reportDigest: {
              projectId: input.projectId,
              reportDigest: input.criticReport.reportDigest,
            },
          },
        });
        if (!criticRecord) {
          criticRecord = await tx.criticReportRecord.create({
            data: {
              id: input.criticReport.reportId,
              projectId: input.projectId,
              artifactId: artifact.id,
              reportDigest: input.criticReport.reportDigest,
              authority: input.criticReport.authority,
              status: input.criticReport.status,
              domain: input.criticReport.domain,
              stage: input.criticReport.stage,
              targetVersion: input.criticReport.target.artifactVersion,
              targetDigest: input.criticReport.target.artifactDigest,
              productionPath: input.criticReport.target.productionPath,
              inputHash: input.criticReport.inputHash,
              rubricId: input.criticReport.effectiveRubric.id,
              rubricVersion: input.criticReport.effectiveRubric.version,
              rubricDigest: input.criticReport.effectiveRubric.digest,
              validationRefsJson: JSON.stringify(input.criticReport.validationReportRefs),
              payloadJson: JSON.stringify(input.criticReport),
              createdAt: parseDate(input.criticReport.createdAt, "CriticReport"),
            },
          });
        } else if (criticRecord.artifactId !== artifact.id || criticRecord.targetDigest !== currentDigest) {
          throw new Error("Critic report digest is already bound to a different target.");
        }

        let decisionRecord = await tx.qualityDecisionRecord.findUnique({
          where: {
            projectId_decisionDigest: {
              projectId: input.projectId,
              decisionDigest: input.qualityDecision.decisionDigest,
            },
          },
        });
        if (!decisionRecord) {
          decisionRecord = await tx.qualityDecisionRecord.create({
            data: {
              id: input.qualityDecision.decisionId,
              projectId: input.projectId,
              artifactId: artifact.id,
              criticReportId: criticRecord.id,
              decisionDigest: input.qualityDecision.decisionDigest,
              authority: input.qualityDecision.authority,
              domain: input.qualityDecision.domain,
              stage: input.qualityDecision.stage,
              targetVersion: input.qualityDecision.target.artifactVersion,
              targetDigest: input.qualityDecision.target.artifactDigest,
              productionPath: input.qualityDecision.target.productionPath,
              inputHash: input.qualityDecision.inputHash,
              outcome: input.qualityDecision.outcome,
              weightedScore: input.qualityDecision.weightedScore,
              reasonCodesJson: JSON.stringify(input.qualityDecision.reasonCodes),
              nextAction: input.qualityDecision.nextAction,
              repairTargetsJson: JSON.stringify(input.qualityDecision.repairTargets),
              deliveryEligibility: input.qualityDecision.deliveryEligibility,
              validationDigestsJson: JSON.stringify(input.qualityDecision.validationReportDigests),
              rubricDigest: input.qualityDecision.rubricDigest,
              payloadJson: JSON.stringify(input.qualityDecision),
              createdAt: parseDate(input.qualityDecision.createdAt, "QualityDecision"),
            },
          });
        } else if (decisionRecord.artifactId !== artifact.id || decisionRecord.criticReportId !== criticRecord.id) {
          throw new Error("Quality decision digest is already bound to a different review.");
        }

        return { criticReport: criticRecord, qualityDecision: decisionRecord };
      });
    },

    listQualityReviews(projectId: string, artifactId?: string) {
      return Promise.all([
        client.criticReportRecord.findMany({
          where: { projectId, ...(artifactId ? { artifactId } : {}) },
          orderBy: { createdAt: "asc" },
        }),
        client.qualityDecisionRecord.findMany({
          where: { projectId, ...(artifactId ? { artifactId } : {}) },
          orderBy: { createdAt: "asc" },
        }),
      ]).then(([criticReports, qualityDecisions]) => ({ criticReports, qualityDecisions }));
    },
  };
}

type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

async function assertQualityPersistenceGuard(
  tx: TransactionClient,
  projectId: string,
  guard: ProjectExecutionGuard,
) {
  if (guard.projectId !== projectId) throw new ProjectExecutionLeaseRejectedError("Quality review guard project mismatch.");
  const lease = await tx.projectExecutionLease.findFirst({
    where: {
      projectId,
      holderId: guard.holderId,
      fencingToken: guard.fencingToken,
      leasedUntil: { gt: new Date() },
    },
    select: { projectId: true },
  });
  if (!lease) throw new ProjectExecutionLeaseRejectedError("Quality review lease is missing, expired, or fenced out.");
  await assertExecutionIdentityCanWriteProject(tx, guard.identity, projectId);
}

function assertQualityPayloadIntegrity(critic: CriticReport, decision: QualityDecision, rubric: EffectiveRubric) {
  if (!hasValidCriticReportDigest(critic)) throw new Error("Critic report digest mismatch.");
  if (!hasValidQualityDecisionDigest(decision)) throw new Error("Quality decision digest mismatch.");
  const registered = resolveEffectiveRubric(rubric.target);
  if (registered.digest !== rubric.digest || registered.id !== rubric.id || registered.version !== rubric.version) {
    throw new Error("Effective rubric is not the registered immutable version.");
  }
  if (!sameTarget(critic.target, decision.target)) throw new Error("Critic and decision targets do not match.");
  if (critic.reportDigest !== decision.criticReportDigest) throw new Error("Quality decision does not bind the Critic report.");
  if (rubric.digest !== critic.effectiveRubric.digest || rubric.digest !== decision.rubricDigest) {
    throw new Error("Quality review rubric digest mismatch.");
  }
}

function assertValidationBindings(
  critic: CriticReport,
  records: Array<{ id: string; reportDigest: string; artifactId: string | null; payloadJson: string; inputHash: string | null }>,
  artifactId: string,
) {
  if (records.length !== critic.validationReportRefs.length) throw new Error("Validation report binding is incomplete.");
  const byId = new Map(records.map((record) => [record.id, record]));
  for (const ref of critic.validationReportRefs) {
    const record = byId.get(ref.reportId);
    if (!record || record.reportDigest !== ref.digest || record.artifactId !== artifactId) {
      throw new Error("Validation report binding mismatch.");
    }
    const payload = JSON.parse(record.payloadJson) as ValidationReport;
    if (!hasValidValidationReportDigest(payload) || payload.reportDigest !== record.reportDigest) {
      throw new Error("Persisted ValidationReport digest mismatch.");
    }
  }
  const inputHashes = [...new Set(records.map((record) => record.inputHash).filter((value): value is string => Boolean(value)))];
  if (inputHashes.length > 1 || (critic.inputHash && critic.inputHash !== inputHashes[0])) {
    throw new Error("Quality review inputHash mismatch.");
  }
}

function sameTarget(a: QualityTarget, b: QualityTarget) {
  return a.artifactId === b.artifactId &&
    a.artifactVersion === b.artifactVersion &&
    a.artifactDigest === b.artifactDigest &&
    a.productionPath === b.productionPath;
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseDate(value: string, label: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} createdAt is invalid.`);
  return parsed;
}
