import { prisma } from "@/server/db/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { createHumanGateActionId } from "@/server/guards/human-gate";
import {
  attachVerifiedArtifactApprovalEvidence,
  hasVerifiedArtifactApprovalEvidence,
} from "@/server/quality/artifact-truth-boundary";
import type { ValidationReport } from "@/server/quality/quality-types";
import type {
  PptAssetManifest,
  PptAssetRequestBatch,
  PptKeySampleSet,
  PptSampleApproval,
} from "@/server/ppt-quality/ppt-asset-types";
import { validatePptFullDeckPackage } from "@/server/ppt-quality/ppt-full-deck-candidate";
import { validatePptKeySampleSet, validatePptSampleApproval } from "@/server/ppt-quality/ppt-sample-validator";
import type { PptFullDeckPackage } from "@/server/ppt-quality/ppt-production-types";
import type { PptDesignPackage } from "@/server/ppt-quality/ppt-quality-types";
import { assertActiveProjectForWrite } from "./project-lifecycle-service";
import { validationReportIssue, validationReportRecordData } from "./validation-report-repository-helpers";
import type {
  ArtifactKind,
  ArtifactOrigin,
  ArtifactStatus,
  RegenerateArtifactInput,
  SaveArtifactInput,
} from "./types";

export type ArtifactRepository = ReturnType<typeof createArtifactRepository>;

export function createArtifactRepository(client: PrismaClient = prisma) {
  return {
    saveArtifact: saveArtifact.bind(null, client),
    approveArtifact: approveArtifact.bind(null, client),
    getArtifact: getArtifact.bind(null, client),
    regenerateArtifact: regenerateArtifact.bind(null, client),
    getArtifactsByKinds: getArtifactsByKinds.bind(null, client),
    getArtifacts: getArtifacts.bind(null, client),
  };
}

async function saveArtifact(client: PrismaClient, projectId: string, input: SaveArtifactInput) {
  return client.$transaction(async (tx) => {
    const project = await assertActiveProjectForWrite(tx, projectId);
    if (input.validationReport) {
      assertPassedValidationReportForDraft(input.validationReport, input);
    }
    const taskAggregate = await tx.taskAggregate.findUnique({
      where: { projectId_intentEpoch: { projectId, intentEpoch: project.intentEpoch } },
    });
    const latest = await tx.artifact.findFirst({
      where: { projectId, nodeKey: input.nodeKey },
      orderBy: { version: "desc" },
    });
    const artifact = await tx.artifact.create({
      data: {
        projectId,
        taskId: taskAggregate?.taskId ?? null,
        taskBriefDigest: taskBriefDigestFromJson(taskAggregate?.taskBriefJson),
        intentEpoch: project.intentEpoch,
        planRevision: taskAggregate?.planRevision ?? null,
        origin: input.origin ?? "teacher_input",
        nodeKey: input.nodeKey,
        kind: input.kind,
        title: input.title,
        status: input.status,
        summary: input.summary,
        markdownContent: input.markdownContent,
        structuredContentJson: JSON.stringify(input.structuredContent ?? {}),
        version: latest ? latest.version + 1 : 1,
      },
    });

    if (input.validationReport) {
      await tx.validationReportRecord.create({
        data: validationReportRecordData({
          projectId,
          report: input.validationReport,
          artifactId: artifact.id,
        }),
      });
    }

    return artifact;
  });
}

async function approveArtifact(client: PrismaClient, projectId: string, artifactId: string) {
  return client.$transaction(async (tx) => {
    await assertActiveProjectForWrite(tx, projectId);
    const existing = await tx.artifact.findFirst({
      where: { id: artifactId, projectId },
    });

    if (!existing) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    if (existing.status === "approved" && existing.isApproved) {
      if (!hasVerifiedArtifactApprovalEvidence({
        id: existing.id,
        projectId: existing.projectId,
        taskId: existing.taskId,
        taskBriefDigest: existing.taskBriefDigest,
        intentEpoch: existing.intentEpoch,
        planRevision: existing.planRevision,
        origin: existing.origin as ArtifactOrigin,
        nodeKey: existing.nodeKey as ArtifactKind,
        kind: existing.kind as ArtifactKind,
        title: existing.title,
        status: existing.status as ArtifactStatus,
        summary: existing.summary,
        markdownContent: existing.markdownContent,
        structuredContent: parseStructuredContent(existing.structuredContentJson),
        version: existing.version,
        isApproved: existing.isApproved,
        createdAt: existing.createdAt.toISOString(),
        updatedAt: existing.updatedAt.toISOString(),
      })) {
        throw new Error("artifact_truth_not_approvable:approval_evidence_missing");
      }
      return existing;
    }

    const validation = await tx.validationReportRecord.findUnique({
      where: { artifactId: existing.id },
      select: { overallStatus: true, reportDigest: true, targetDigest: true },
    });
    const specializedApproval = attachArtifactApprovalEvidence(existing);
    const approvalEvidence = attachVerifiedArtifactApprovalEvidence({
      nodeKey: existing.nodeKey as ArtifactKind,
      kind: existing.kind as ArtifactKind,
      title: existing.title,
      status: existing.status as ArtifactStatus,
      summary: existing.summary,
      markdownContent: existing.markdownContent,
      structuredContent: specializedApproval,
      origin: existing.origin as ArtifactOrigin,
    }, validation);

    await tx.artifact.updateMany({
      where: { projectId, nodeKey: existing.nodeKey, isApproved: true },
      data: { isApproved: false },
    });

    return tx.artifact.update({
      where: { id: artifactId },
      data: {
        status: "approved",
        isApproved: true,
        structuredContentJson: JSON.stringify(withRouteGenerationActions({
          projectId,
          artifactId,
          nodeKey: existing.nodeKey,
          kind: existing.kind,
          structuredContentJson: JSON.stringify(approvalEvidence),
        })),
      },
    });
  });
}

async function getArtifact(client: PrismaClient, projectId: string, artifactId: string) {
  return client.artifact.findFirst({
    where: { id: artifactId, projectId },
  });
}

async function regenerateArtifact(
  client: PrismaClient,
  projectId: string,
  artifactId: string,
  input: RegenerateArtifactInput,
) {
  return client.$transaction(async (tx) => {
    const project = await assertActiveProjectForWrite(tx, projectId);
    const existing = await tx.artifact.findFirst({
      where: { id: artifactId, projectId },
    });

    if (!existing) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }

    const latest = await tx.artifact.findFirst({
      where: { projectId, nodeKey: existing.nodeKey },
      orderBy: { version: "desc" },
    });

    if (input.expectedLatestVersion !== undefined && latest?.version !== input.expectedLatestVersion) {
      throw new Error(
        `Artifact version conflict: expected latest version ${input.expectedLatestVersion}, received ${latest?.version ?? "none"}`,
      );
    }

    const artifact = await tx.artifact.create({
      data: {
        projectId,
        taskId: null,
        taskBriefDigest: null,
        intentEpoch: project.intentEpoch + 1,
        planRevision: null,
        origin: "teacher_input",
        nodeKey: existing.nodeKey,
        kind: existing.kind,
        title: input.title ?? existing.title,
        status: "needs_review",
        summary: input.summary,
        markdownContent: input.markdownContent,
        structuredContentJson: JSON.stringify(input.structuredContent ?? {}),
        version: latest ? latest.version + 1 : existing.version + 1,
        isApproved: false,
      },
    });

    await tx.project.update({
      where: { id: projectId },
      data: { intentEpoch: { increment: 1 } },
    });

    return artifact;
  });
}

async function getArtifactsByKinds(client: PrismaClient, projectId: string, artifactKinds: string[]) {
  return client.artifact.findMany({
    where: {
      projectId,
      kind: { in: artifactKinds },
    },
    orderBy: [{ kind: "asc" }, { version: "desc" }],
  });
}

async function getArtifacts(client: PrismaClient, projectId: string) {
  return client.artifact.findMany({
    where: { projectId },
    orderBy: [{ nodeKey: "asc" }, { version: "asc" }],
  });
}

function assertPassedValidationReportForDraft(
  report: ValidationReport,
  draft: Pick<SaveArtifactInput, "nodeKey" | "kind" | "title" | "summary" | "markdownContent" | "structuredContent">,
) {
  const issue = validationReportIssue(report, draft);
  if (issue) throw new Error(`Validation report rejected: ${issue}`);
}

function withRouteGenerationActions(input: {
  projectId: string;
  artifactId: string;
  nodeKey: string;
  kind: string;
  structuredContentJson: string;
}) {
  const structuredContent = parseStructuredContent(input.structuredContentJson);
  const capabilityId = routeGenerationCapabilityForArtifact(input);
  if (!capabilityId) return structuredContent;

  return {
    ...structuredContent,
    routeGenerationActions: {
      ...(isRecord(structuredContent.routeGenerationActions) ? structuredContent.routeGenerationActions : {}),
      [capabilityId]: {
        actionId: createHumanGateActionId({
          projectId: input.projectId,
          capabilityId,
          messageId: input.artifactId,
        }),
      },
    },
  };
}

function routeGenerationCapabilityForArtifact(input: { nodeKey: string; kind: string }) {
  if (input.nodeKey === "ppt_design_draft" && input.kind === "ppt_design_draft") return "coze_ppt";
  if (input.nodeKey === "ppt_draft" && input.kind === "ppt_draft") return "image_asset";
  if (input.nodeKey === "video_segment_plan" && input.kind === "video_segment_plan") return "video_segment_generate";
  return null;
}

function parseStructuredContent(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function taskBriefDigestFromJson(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { digest?: unknown };
    return typeof parsed.digest === "string" && /^[a-f0-9]{64}$/i.test(parsed.digest)
      ? parsed.digest.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

function attachArtifactApprovalEvidence(artifact: {
  nodeKey: string;
  kind: string;
  structuredContentJson: string;
}): Record<string, unknown> {
  const structuredContent = parseStructuredContent(artifact.structuredContentJson);
  if (artifact.nodeKey === "creative_theme_generate" && artifact.kind === "creative_theme_generate") {
    const review = structuredContent.videoCourseAnchorReview;
    if (!isPassedVideoReview(review, "video-course-anchor-review.v1")) {
      throw new Error("Video concept approval blocked: course_anchor_review_required");
    }
    return {
      ...structuredContent,
      videoCourseAnchorApproval: {
        schemaVersion: "video-course-anchor-approval.v1",
        decision: "approved",
        decisionSource: "artifact_approve_action",
        reviewEvidenceDigest: review.evidenceDigest,
        approvedAt: new Date().toISOString(),
      },
    };
  }
  if (artifact.nodeKey === "concat_only_assemble" && artifact.kind === "concat_only_assemble") {
    const review = structuredContent.videoFinalReview;
    if (!isPassedVideoReview(review, "video-final-review.v1")) {
      throw new Error("Final video approval blocked: video_final_review_required");
    }
    return {
      ...structuredContent,
      videoFinalApproval: {
        schemaVersion: "video-final-approval.v1",
        decision: "approved",
        decisionSource: "artifact_approve_action",
        reviewEvidenceDigest: review.evidenceDigest,
        approvedAt: new Date().toISOString(),
      },
    };
  }
  if ("pptKeySampleCandidate" in structuredContent && !("pptKeySampleSet" in structuredContent)) {
    throw new Error("PPT key sample approval blocked: dvp_review_required");
  }
  if ("pptFullDeckCandidate" in structuredContent && !("pptFullDeckPackage" in structuredContent)) {
    throw new Error("PPT full deck approval blocked: delivery_review_required");
  }
  if (
    "pptFullDeckPackage" in structuredContent
    && !validatePptFullDeckPackage(structuredContent.pptFullDeckPackage as PptFullDeckPackage)
  ) {
    throw new Error("PPT full deck approval blocked: delivery_package_invalid");
  }
  if ("pptFullDeckPackage" in structuredContent) return structuredContent;
  if (!("pptKeySampleSet" in structuredContent)) return structuredContent;

  const designPackage = structuredContent.pptDesignPackage as PptDesignPackage | undefined;
  const requestBatch = structuredContent.pptAssetRequestBatch as PptAssetRequestBatch | undefined;
  const manifest = structuredContent.pptAssetManifest as PptAssetManifest | undefined;
  const sampleSet = structuredContent.pptKeySampleSet as PptKeySampleSet | undefined;
  if (!designPackage || !requestBatch || !manifest || !sampleSet) {
    throw new Error("PPT key sample approval evidence is incomplete.");
  }
  const sampleValidation = validatePptKeySampleSet({ designPackage, requestBatch, manifest, sampleSet });
  if (!sampleValidation.valid) {
    throw new Error(`PPT key sample approval blocked: ${sampleValidation.issues.map((item) => item.code).join(",")}`);
  }
  const approval: PptSampleApproval = {
    schemaVersion: "ppt-sample-approval.v1",
    decision: "approved",
    decisionSource: "artifact_approve_action",
    decisionText: "artifact_approve_action",
    teacherMessageId: null,
    designPackageDigest: sampleSet.designPackageDigest,
    sampleSetDigest: sampleSet.sampleSetDigest,
    approvedAt: new Date().toISOString(),
  };
  const approvalValidation = validatePptSampleApproval(sampleSet, approval);
  if (!approvalValidation.valid) {
    throw new Error(`PPT key sample approval blocked: ${approvalValidation.issues.map((item) => item.code).join(",")}`);
  }
  return { ...structuredContent, pptSampleApproval: approval };
}

function isPassedVideoReview(value: unknown, schemaVersion: string): value is Record<string, unknown> {
  return isRecord(value) && value.schemaVersion === schemaVersion && value.overallStatus === "passed"
    && typeof value.evidenceDigest === "string" && /^[a-f0-9]{64}$/i.test(value.evidenceDigest);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
