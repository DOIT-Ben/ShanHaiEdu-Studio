import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { omitFixtureFields } from "./support/omit-fixture-fields";

import { createValidationReport, validateToolExecutionResult } from "@/server/contracts/contract-validator";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { createExecutionEnvelope, createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { prisma } from "@/server/db/client";
import type { ValidationReport } from "@/server/quality/quality-types";
import { getToolDefinition } from "@/server/tools/tool-registry";
import { createWorkbenchService } from "@/server/workbench/service";

type ReportMutation = (report: ValidationReport) => ValidationReport;

const replayCases: Array<{
  label: string;
  mutate: ReportMutation;
  jobCapabilityId?: string;
  startJob?: boolean;
  errorPattern?: RegExp;
}> = [
  {
    label: "a non-draft target",
    mutate: (report) => reissue(report, { target: { ...report.target, kind: "tool_execution" } }),
  },
  {
    label: "a missing target digest",
    mutate: (report) => reissue(report, { target: { kind: "artifact_draft", targetId: report.target.targetId } }),
  },
  {
    label: "another Tool invocation target",
    mutate: (report) => reissue(report, { target: { ...report.target, targetId: "generate_video_segment" } }),
  },
  {
    label: "an old IntentEpoch",
    mutate: (report) => reissue(report, { intentEpoch: (report.intentEpoch ?? 0) + 1 }),
  },
  {
    label: "another Invocation input hash",
    mutate: (report) => reissue(report, { inputHash: "a".repeat(64) }),
  },
  {
    label: "another Tool stage",
    mutate: (report) => reissue(report, { stage: "video_segment_generate" }),
  },
  {
    label: "another Tool contract",
    mutate: (report) => reissue(report, { contract: { id: "tool:generate_video_segment", version: "tool-v1" } }),
  },
  {
    label: "an empty self-signed Provider gate set",
    mutate: (report) => reissue(report, { gates: [] }),
  },
  {
    label: "a contradictory failed gate under an overall passed status",
    mutate: (report) => reissue(report, {
      gates: [
        ...report.gates,
        {
          ...report.gates[0],
          gateId: "contradictory_provider_gate",
          status: "failed",
          reasonCode: "provider_output_invalid",
        },
      ],
    }),
  },
  {
    label: "a GenerationJob from another capability",
    mutate: (report) => report,
    jobCapabilityId: "video_segment_generate",
    errorPattern: /GenerationJob does not match the current Tool invocation contract/,
  },
  {
    label: "a GenerationJob that was never started",
    mutate: (report) => report,
    startJob: false,
  },
];

describe("ValidationReport Invocation and IntentEpoch binding", () => {
  it.each(replayCases)("rejects $label and rolls the whole Tool result transaction back", async (testCase) => {
    const fixture = await createFixture({
      jobCapabilityId: testCase.jobCapabilityId,
      startJob: testCase.startJob,
    });
    const report = testCase.mutate(fixture.validationReport);

    await expect(fixture.store.commitToolResult({
      invocationId: fixture.invocationId,
      generationJobId: fixture.job.id,
      artifact: { ...fixture.artifactDraft, validationReport: report },
      observation: {
        observationId: fixture.observationId,
        status: "succeeded",
        reasonCodes: ["business_tool_succeeded"],
        payload: { summary: "This replay must not be persisted." },
      },
      event: {
        eventId: fixture.eventId,
        projectId: fixture.projectId,
        taskId: fixture.taskId,
        runId: `turn:${fixture.teacherMessageId}`,
        intentEpoch: fixture.intentEpoch,
        kind: "artifact_committed",
        visibility: "internal",
        occurredAt: "2026-07-15T00:00:00.000Z",
        payload: { observationId: fixture.observationId },
      },
    })).rejects.toThrow(testCase.errorPattern ?? /Validation report rejected during atomic Tool result commit/);

    const [artifacts, observations, events, reports, invocation, job, aggregate] = await Promise.all([
      prisma.artifact.findMany({ where: { projectId: fixture.projectId } }),
      prisma.observationRecord.findMany({ where: { projectId: fixture.projectId } }),
      prisma.agentEventRecord.findMany({ where: { projectId: fixture.projectId } }),
      prisma.validationReportRecord.findMany({ where: { projectId: fixture.projectId } }),
      fixture.store.getToolInvocation(fixture.invocationId),
      prisma.generationJob.findUniqueOrThrow({ where: { id: fixture.job.id } }),
      fixture.store.getTaskAggregate(fixture.projectId, fixture.intentEpoch),
    ]);

    expect(artifacts.map((artifact) => artifact.id)).toEqual([fixture.sourceArtifactId]);
    expect(observations).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(reports).toHaveLength(0);
    expect(invocation).toMatchObject({ status: "running", artifactId: null, observationId: null });
    expect(job).toMatchObject({
      status: testCase.startJob === false ? "queued" : "running",
      resultArtifactId: null,
    });
    expect(aggregate).toMatchObject({ plan: { revision: 0 } });
  });
});

async function createFixture(input: { jobCapabilityId?: string; startJob?: boolean }) {
  const service = createWorkbenchService();
  const project = await service.createProject({ title: `Validation replay ${randomUUID()}` });
  const source = await service.saveArtifact(project.id, {
    nodeKey: "ppt_draft",
    kind: "ppt_draft",
    title: "Current PPT outline",
    status: "needs_review",
    summary: "Current source for the isolated contract fixture.",
    markdownContent: "# Current PPT outline",
    structuredContent: {
      artifactQualityState: {
        validationStatus: "passed",
        reviewStatus: "passed",
        downstreamEligibility: "eligible",
      },
    },
  });
  const intentEpoch = project.intentEpoch ?? 0;
  const taskBrief = createTaskBrief({
    taskId: `task:${project.id}`,
    projectId: project.id,
    intentEpoch,
    goal: "Generate one classroom image from the current PPT outline.",
    requestedOutputs: ["image"],
    constraints: ["offline_contract_fixture", "do_not_call_real_provider"],
    excludedOutputs: [],
    generationIntensity: project.generationIntensity ?? "standard",
    sourceMessageId: `message:${project.id}`,
  });
  const intentGrant: IntentGrant = {
    schemaVersion: "intent-grant.v1",
    taskId: taskBrief.taskId,
    projectId: taskBrief.projectId,
    intentEpoch,
    standardWorkAuthorized: true,
    intensity: taskBrief.generationIntensity,
    budgetPolicyVersion: "offline-contract.v1",
    maxCostCredits: 0,
    maxExternalProviderCalls: 1,
    requiredCheckpoints: [],
    expiresAt: null,
  };
  const store = createControlPlaneStore();
  await store.upsertTaskAggregate({
    taskBrief,
    intentGrant,
    plan: { planId: `plan:${project.id}`, revision: 0, status: "active" },
    checkpoint: null,
  });
  await prisma.artifact.update({
    where: { id: source.id },
    data: {
      taskId: taskBrief.taskId,
      taskBriefDigest: taskBrief.digest,
      intentEpoch,
      planRevision: 0,
      origin: "tool_result",
    },
  });

  const tool = getToolDefinition("generate_classroom_image");
  const action = {
    toolName: tool.id,
    arguments: { sourceArtifactId: source.id, sourceArtifactVersion: source.version },
  };
  const envelope = createExecutionEnvelope({
    actorUserId: "offline-contract-teacher",
    taskBrief,
    planRevision: 0,
    intensity: taskBrief.generationIntensity,
    intentGrant,
    action,
  });
  const invocationId = randomUUID();
  await prisma.conversationTurnJob.create({
    data: {
      projectId: project.id,
      teacherMessageId: taskBrief.sourceMessageId,
      status: "running",
      actorUserId: "offline-contract-teacher",
      actorAuthMode: "local",
    },
  });
  await store.startToolInvocation({
    invocationId,
    envelope,
    toolName: tool.id,
    request: action.arguments,
  });

  const queuedJob = await service.createGenerationJob(project.id, {
    kind: "image",
    sourceArtifactId: source.id,
    capabilityId: input.jobCapabilityId ?? tool.capabilityId,
    idempotencyKey: envelope.idempotencyKey,
    sourceArtifactIds: [source.id],
    inputSnapshot: {
      toolName: tool.id,
      arguments: action.arguments,
      taskBriefDigest: taskBrief.digest,
      intentEpoch,
      sourceArtifacts: [{ artifactId: source.id, kind: source.kind, version: source.version }],
    },
  });
  const job = input.startJob === false
    ? queuedJob
    : (await service.startGenerationJobForExecution(project.id, queuedJob.id)).job;
  if (!job.inputHash) throw new Error("Fixture GenerationJob requires inputHash.");

  const artifactDraft = {
    nodeKey: "image_prompts" as const,
    kind: "image_prompts" as const,
    title: "Offline classroom image",
    status: "needs_review" as const,
    summary: "Offline contract fixture result.",
    markdownContent: "# Offline classroom image",
    structuredContent: { fixture: true },
  };
  const validationReport = validateToolExecutionResult({
    tool,
    projectId: project.id,
    result: {
      status: "succeeded",
      artifactDraft,
      artifactTruth: {
        created: true,
        persisted: true,
        placeholder: false,
        producedArtifactKind: artifactDraft.kind,
      },
      qualityGate: { passed: true, gates: ["offline_contract_fixture"] },
    },
    inputHash: job.inputHash,
    intentEpoch,
  });

  return {
    store,
    projectId: project.id,
    sourceArtifactId: source.id,
    taskId: taskBrief.taskId,
    teacherMessageId: taskBrief.sourceMessageId,
    intentEpoch,
    invocationId,
    job,
    artifactDraft,
    validationReport,
    observationId: randomUUID(),
    eventId: randomUUID(),
  };
}

function reissue(report: ValidationReport, patch: Partial<ValidationReport>): ValidationReport {
  const input = omitFixtureFields(report, "authority", "reportDigest");
  return createValidationReport({
    ...input,
    ...patch,
    reportId: randomUUID(),
  });
}
