import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { omitFixtureFields } from "./support/omit-fixture-fields";

import { createValidationReport, hashArtifactDraft } from "@/server/contracts/contract-validator";
import { resolveRuntimeContract } from "@/server/contracts/runtime-contract";
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
    label: "a GenerationJob from another capability",
    mutate: (report) => report,
    jobCapabilityId: "video_segment_generate",
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
        runId: `run:${fixture.invocationId}`,
        intentEpoch: fixture.intentEpoch,
        kind: "artifact_committed",
        visibility: "internal",
        occurredAt: "2026-07-15T00:00:00.000Z",
        payload: { observationId: fixture.observationId },
      },
    })).rejects.toThrow(/Validation report rejected during atomic Tool result commit/);

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
    inputSnapshot: { sourceArtifactId: source.id, sourceArtifactVersion: source.version },
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
  const contract = resolveRuntimeContract(tool);
  const validationReport = createValidationReport({
    reportId: randomUUID(),
    createdAt: "2026-07-15T00:00:00.000Z",
    domain: "ppt",
    stage: contract.capabilityId,
    target: {
      kind: "artifact_draft",
      targetId: tool.id,
      targetDigest: hashArtifactDraft(artifactDraft),
    },
    contract: { id: contract.id, version: contract.version },
    inputHash: job.inputHash,
    intentEpoch,
    overallStatus: "passed",
    gates: [],
  });

  return {
    store,
    projectId: project.id,
    sourceArtifactId: source.id,
    taskId: taskBrief.taskId,
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
