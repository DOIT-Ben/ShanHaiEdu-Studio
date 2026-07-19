import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { validateToolExecutionResult } from "@/server/contracts/contract-validator";
import { readOrchestrationAuthoritySummary } from "@/server/conversation/orchestration-authority-summary";
import { digestToolAuditEvent } from "@/server/conversation/orchestration-tool-audit-event";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import {
  createExecutionEnvelope,
  createTaskBrief,
  type IntentGrant,
  type TaskRequestedOutput,
} from "@/server/conversation/task-contract";
import {
  runWithOrchestrationIngressAudit,
  type OrchestrationIngressAuditStore,
} from "@/server/workbench/orchestration-ingress-audit";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService } from "@/server/workbench/service";
import { getToolDefinition } from "@/server/tools/tool-registry";
import { normalizeV1_9OrchestrationAuthoritySummary } from "../scripts/lib/v1-9-orchestration-authority.mjs";
import { readV1_9OrchestrationAuthoritySummaryFromSqlite } from "../scripts/lib/v1-9-orchestration-authority-sqlite";

const root = process.cwd();
const stageRoot = path.join(root, ".tmp", "orchestration-authority-summary-tests");
const databasePath = path.join(stageRoot, `summary-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
const actorUserId = "authority-summary-teacher";
let client: PrismaClient;

beforeAll(() => {
  mkdirSync(stageRoot, { recursive: true });
  const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
    encoding: "utf8",
  });
  if (initialized.status !== 0) {
    throw new Error(initialized.stderr || initialized.stdout || "Authority summary test database initialization failed.");
  }
  client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
});

afterAll(async () => {
  await client?.$disconnect();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${databasePath}${suffix}`, { force: true });
});

describe("VR-A13B product orchestration authority summary", () => {
  it("rejects caller-supplied window controls before reading SQLite", async () => {
    await expect(readOrchestrationAuthoritySummary({
      projectId: "project-cropped",
      actor: { userId: actorUserId },
      afterSequence: 100,
    } as never, client)).rejects.toThrow("orchestration_authority_input_invalid");
  });

  it("derives its subject and complete project window from SQLite with deterministic digests", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "project_create");

    const beforeSubmission = await read(fixture.projectId);
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    const first = await read(fixture.projectId);
    const repeated = await read(fixture.projectId);
    const readonlyBridge = await readV1_9OrchestrationAuthoritySummaryFromSqlite({
      databasePath,
      projectId: fixture.projectId,
      actorUserId,
    });

    expect(first.subject).toEqual({
      projectId: fixture.projectId,
      actorUserId,
      taskId: fixture.taskBrief.taskId,
      taskBriefDigest: fixture.taskBrief.digest,
      intentEpoch: 0,
      teacherMessageId: fixture.teacherMessageId,
      turnJobId: fixture.turnJobId,
      planId: fixture.planId,
      planRevision: 0,
    });
    expect(first).toMatchObject({
      schemaVersion: "orchestration-authority-summary.v1",
      eventCount: 4,
      attemptCount: 2,
      resolvedCount: 2,
      openAttemptCount: 0,
      toolClaimCount: 0,
      toolTerminalCount: 0,
      mainAgentToolCount: 0,
      nonMainAgentToolCount: 0,
      firstToolOrdinal: null,
      lastToolOrdinal: null,
      toolOrdinalsContiguous: true,
      authorities: ["teacher_http"],
      violationReasonCodes: [],
      complete: true,
      readyEligible: true,
    });
    expect(first.windowStartSequence).toBeGreaterThan(0);
    expect(first.watermark).toBeGreaterThan(beforeSubmission.watermark);
    expect(first.factsDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.summaryDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(normalizeV1_9OrchestrationAuthoritySummary(first)).toEqual(first);
    expect(repeated).toEqual(first);
    expect(readonlyBridge).toEqual(first);
    expect(first.factsDigest).not.toBe(beforeSubmission.factsDigest);
    expect(first.summaryDigest).not.toBe(beforeSubmission.summaryDigest);
    expect(JSON.stringify(first)).not.toMatch(/auth-session-secret|request-secret|private-error|payloadJson|requestJson/);
  });

  it("keeps an early unclassified mutation visible after later clean events", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "unclassified_external");
    await appendIngressPair(fixture.projectId, "teacher_message_submit");

    const summary = await read(fixture.projectId);

    expect(summary.eventCount).toBe(4);
    expect(summary.violationReasonCodes).toContain("unclassified_external_mutation");
    expect(summary.complete).toBe(true);
    expect(summary.readyEligible).toBe(false);
  });

  it("fails closed on an open attempt without exposing its identifier", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    await appendOpenAttempt(fixture.projectId);

    const summary = await read(fixture.projectId);

    expect(summary).toMatchObject({ openAttemptCount: 1, complete: false, readyEligible: false });
    expect(summary.violationReasonCodes).toContain("open_attempt");
    expect(JSON.stringify(summary)).not.toContain("open-attempt-private-id");
  });

  it("cross-checks a Main Agent Tool claim and terminal against persisted product facts", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    await appendToolPair(fixture);
    await client.taskAggregate.update({ where: { taskId: fixture.taskBrief.taskId }, data: { planRevision: 1 } });

    const summary = await read(fixture.projectId);

    expect(summary).toMatchObject({
      toolClaimCount: 1,
      toolTerminalCount: 1,
      mainAgentToolCount: 1,
      nonMainAgentToolCount: 0,
      firstToolOrdinal: 1,
      lastToolOrdinal: 1,
      toolOrdinalsContiguous: true,
      violationReasonCodes: [],
      complete: true,
      readyEligible: true,
    });
    expect(summary.authorities).toEqual(["main_agent", "teacher_http"]);
    expect(summary.subject.planRevision).toBe(1);
  });

  it("rejects non-Main-Agent selector authority and discontinuous Tool ordinals", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    await appendToolPair(fixture, { authority: "artifact_route", actorAuthMode: "local", toolOrdinal: 2 });

    const summary = await read(fixture.projectId);

    expect(summary.nonMainAgentToolCount).toBe(1);
    expect(summary.toolOrdinalsContiguous).toBe(false);
    expect(summary.violationReasonCodes).toEqual(expect.arrayContaining([
      "tool_ordinal_discontinuous",
      "tool_claim_subject_binding_invalid",
      "tool_selector_authority_invalid",
    ]));
    expect(summary.readyEligible).toBe(false);
  });

  it("rejects a Tool terminal that changes any frozen claim binding", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    await appendToolPair(fixture, { terminalToolName: "create_ppt_outline" });

    const summary = await read(fixture.projectId);

    expect(summary.violationReasonCodes).toContain("tool_terminal_binding_invalid");
    expect(summary.readyEligible).toBe(false);
  });

  it("accepts the exact facts produced by a real Main Agent atomic Tool commit", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    const request = { goal: "只做需求规格" };
    const envelope = createExecutionEnvelope({
      actorUserId,
      taskBrief: fixture.taskBrief,
      planRevision: 0,
      intensity: fixture.taskBrief.generationIntensity,
      intentGrant: fixture.intentGrant,
      action: { toolName: "create_requirement_spec", arguments: request },
    });
    const invocationId = `invocation:${randomUUID()}`;
    const observationId = `observation:${randomUUID()}`;
    const store = createControlPlaneStore(client);
    const service = createWorkbenchService(createPrismaWorkbenchRepository(client), undefined, {
      actorUserId,
      actorAuthMode: "password",
      authSessionId: "auth-session-secret",
    });
    await expect(service.startNextConversationTurnJob(fixture.projectId, {
      expectedJobId: fixture.turnJobId,
      lockedBy: "authority-summary-test-worker",
    })).resolves.toMatchObject({ id: fixture.turnJobId, status: "running" });
    await store.startToolInvocation({
      invocationId,
      envelope,
      toolName: "create_requirement_spec",
      request,
    });
    await store.commitToolResult({
      invocationId,
      artifact: {
        nodeKey: "requirement_spec",
        kind: "requirement_spec",
        title: "需求规格",
        status: "needs_review",
        summary: "目标与排除项已经冻结。",
        markdownContent: "# 需求规格",
        structuredContent: { requestedOutputs: ["requirement_spec"] },
      },
      observation: {
        observationId,
        status: "succeeded",
        reasonCodes: ["business_tool_succeeded"],
        payload: { summary: "需求规格已生成" },
      },
      event: {
        eventId: `agent-event:${randomUUID()}`,
        projectId: fixture.projectId,
        taskId: fixture.taskBrief.taskId,
        runId: `turn:${fixture.teacherMessageId}`,
        intentEpoch: fixture.taskBrief.intentEpoch,
        kind: "artifact_committed",
        visibility: "internal",
        occurredAt: new Date().toISOString(),
        payload: { observationId, status: "succeeded" },
      },
    });

    const summary = await read(fixture.projectId);
    expect(summary).toMatchObject({
      violationReasonCodes: [],
      readyEligible: true,
      mainAgentToolCount: 1,
      nonMainAgentToolCount: 0,
      toolClaimCount: 1,
      toolTerminalCount: 1,
      subject: { planRevision: 1 },
    });
  });

  it("accepts a Provider commit only when Job, Artifact, Event, and ValidationReport form one closed chain", async () => {
    const fixture = await createSubject(["image"]);
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    await commitProviderToolPair(fixture);

    const summary = await read(fixture.projectId);
    expect(summary.violationReasonCodes).toEqual([]);
    expect(summary.readyEligible).toBe(true);
  });

  it("rejects deletion or payload tampering of a terminal Provider ValidationReport", async () => {
    const deleted = await createSubject(["image"]);
    await appendIngressPair(deleted.projectId, "teacher_message_submit");
    const deletedCommit = await commitProviderToolPair(deleted);
    const beforeDelete = await read(deleted.projectId);
    await client.validationReportRecord.delete({ where: { id: deletedCommit.reportId } });
    const afterDelete = await read(deleted.projectId);
    expect(afterDelete.violationReasonCodes).toContain("tool_validation_report_cardinality_invalid");
    expect(afterDelete.factsDigest).not.toBe(beforeDelete.factsDigest);
    expect(afterDelete.readyEligible).toBe(false);

    const tampered = await createSubject(["image"]);
    await appendIngressPair(tampered.projectId, "teacher_message_submit");
    const tamperedCommit = await commitProviderToolPair(tampered);
    const report = await client.validationReportRecord.findUniqueOrThrow({ where: { id: tamperedCommit.reportId } });
    const payload = JSON.parse(report.payloadJson) as Record<string, unknown>;
    await client.validationReportRecord.update({
      where: { id: report.id },
      data: { payloadJson: JSON.stringify({ ...payload, domain: "video" }) },
    });
    const afterTamper = await read(tampered.projectId);
    expect(afterTamper.violationReasonCodes).toContain("tool_validation_report_binding_invalid");
    expect(afterTamper.readyEligible).toBe(false);
  });

  it("rejects an orphan succeeded GenerationJob that claims an existing Provider Artifact", async () => {
    const fixture = await createSubject(["image"]);
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    const committed = await commitProviderToolPair(fixture);
    const service = summaryWorkbenchService();
    const duplicate = await service.createGenerationJob(fixture.projectId, {
      kind: "image",
      sourceArtifactId: committed.sourceArtifactId,
      capabilityId: "image_asset",
      idempotencyKey: `orphan:${randomUUID()}`,
      sourceArtifactIds: [committed.sourceArtifactId],
      inputSnapshot: committed.inputSnapshot,
    });
    await client.generationJob.update({
      where: { id: duplicate.id },
      data: { status: "succeeded", pollState: "completed", resultArtifactId: committed.artifactId },
    });

    const summary = await read(fixture.projectId);
    expect(summary.violationReasonCodes).toContain("tool_generation_reverse_binding_invalid");
    expect(summary.readyEligible).toBe(false);
  });

  it("rejects and digests a succeeded GenerationJob with no result Artifact", async () => {
    const fixture = await createSubject(["image"]);
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    const committed = await commitProviderToolPair(fixture);
    const before = await read(fixture.projectId);
    const service = summaryWorkbenchService();
    const orphan = await service.createGenerationJob(fixture.projectId, {
      kind: "image",
      sourceArtifactId: committed.sourceArtifactId,
      capabilityId: "image_asset",
      idempotencyKey: `orphan-without-result:${randomUUID()}`,
      sourceArtifactIds: [committed.sourceArtifactId],
      inputSnapshot: committed.inputSnapshot,
    });
    await client.generationJob.update({
      where: { id: orphan.id },
      data: { status: "succeeded", pollState: "completed", resultArtifactId: null },
    });

    const after = await read(fixture.projectId);
    expect(after.violationReasonCodes).toContain("tool_generation_reverse_binding_invalid");
    expect(after.factsDigest).not.toBe(before.factsDigest);
    expect(after.readyEligible).toBe(false);
  });

  it("rejects persisted Observation and event statuses that drift from the Invocation terminal", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    const tool = await appendToolPair(fixture);
    await client.observationRecord.update({
      where: { observationId: tool.observationId },
      data: { status: "failed" },
    });

    const summary = await read(fixture.projectId);

    expect(summary.violationReasonCodes).toEqual(expect.arrayContaining([
      "tool_observation_status_invalid",
      "tool_event_binding_invalid",
    ]));
    expect(summary.readyEligible).toBe(false);
  });

  it("accepts a succeeded Observation-only Tool without inventing an Artifact requirement", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    await appendToolPair(fixture, { observationOnly: true });

    const summary = await read(fixture.projectId);

    expect(summary.violationReasonCodes).toEqual([]);
    expect(summary.readyEligible).toBe(true);
  });

  it("scopes Tool ordinals and product facts to the current TaskBrief without losing project history", async () => {
    const firstTask = await createSubject();
    await appendIngressPair(firstTask.projectId, "teacher_message_submit");
    await appendToolPair(firstTask);
    await client.taskAggregate.update({ where: { taskId: firstTask.taskBrief.taskId }, data: { planRevision: 1 } });

    const secondTask = await createNextSubject(firstTask);
    await appendIngressPair(secondTask.projectId, "teacher_message_submit");
    const beforeSecondTool = await read(secondTask.projectId);
    expect(beforeSecondTool).toMatchObject({
      toolClaimCount: 0,
      toolTerminalCount: 0,
      firstToolOrdinal: null,
      lastToolOrdinal: null,
      violationReasonCodes: [],
      readyEligible: true,
    });

    await appendToolPair(secondTask);
    await client.taskAggregate.update({ where: { taskId: secondTask.taskBrief.taskId }, data: { planRevision: 1 } });
    const afterSecondTool = await read(secondTask.projectId);
    expect(afterSecondTool).toMatchObject({
      toolClaimCount: 1,
      toolTerminalCount: 1,
      firstToolOrdinal: 1,
      lastToolOrdinal: 1,
      toolOrdinalsContiguous: true,
      violationReasonCodes: [],
      readyEligible: true,
    });
  });

  it("keeps terminal-matrix violations from an earlier IntentEpoch visible", async () => {
    const firstTask = await createSubject();
    await appendIngressPair(firstTask.projectId, "teacher_message_submit");
    await appendToolPair(firstTask, { eventKind: "tool_observed" });
    await client.taskAggregate.update({ where: { taskId: firstTask.taskBrief.taskId }, data: { planRevision: 1 } });

    const secondTask = await createNextSubject(firstTask);
    await appendIngressPair(secondTask.projectId, "teacher_message_submit");

    const summary = await read(secondTask.projectId);
    expect(summary.violationReasonCodes).toContain("tool_event_kind_invalid");
    expect(summary.readyEligible).toBe(false);
  });

  it.each([
    { label: "TurnJob", options: { turnJobId: "missing-turn-job" } },
    { label: "session", options: { authSessionDigest: sha256("wrong-session") } },
    { label: "plan", options: { planId: "forged-plan" } },
  ])("keeps an earlier IntentEpoch $label subject violation visible", async ({ options }) => {
    const firstTask = await createSubject();
    await appendIngressPair(firstTask.projectId, "teacher_message_submit");
    await appendToolPair(firstTask, options);
    await client.taskAggregate.update({ where: { taskId: firstTask.taskBrief.taskId }, data: { planRevision: 1 } });
    const secondTask = await createNextSubject(firstTask);
    await appendIngressPair(secondTask.projectId, "teacher_message_submit");

    const summary = await read(secondTask.projectId);
    expect(summary.violationReasonCodes).toContain("tool_historical_subject_binding_invalid");
    expect(summary.readyEligible).toBe(false);
  });

  it("fails closed when an earlier IntentEpoch loses its TaskAggregate", async () => {
    const firstTask = await createSubject();
    await appendIngressPair(firstTask.projectId, "teacher_message_submit");
    await appendToolPair(firstTask);
    await client.taskAggregate.delete({ where: { taskId: firstTask.taskBrief.taskId } });
    const secondTask = await createNextSubject(firstTask);
    await appendIngressPair(secondTask.projectId, "teacher_message_submit");

    const summary = await read(secondTask.projectId);
    expect(summary.violationReasonCodes).toContain("tool_historical_subject_binding_invalid");
    expect(summary.readyEligible).toBe(false);
  });

  it("validates Tool ordinal and plan revision in audit sequence order", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    await appendToolPair(fixture, { toolOrdinal: 2, planRevision: 0 });
    await appendToolPair(fixture, { toolOrdinal: 1, planRevision: 1 });
    await client.taskAggregate.update({ where: { taskId: fixture.taskBrief.taskId }, data: { planRevision: 2 } });

    const summary = await read(fixture.projectId);
    expect(summary.violationReasonCodes).toEqual(expect.arrayContaining([
      "tool_ordinal_discontinuous",
      "tool_historical_sequence_invalid",
    ]));
    expect(summary.readyEligible).toBe(false);
  });

  it("recomputes Tool result mode from the registry instead of trusting audit payloads", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    await appendToolPair(fixture, {
      auditResultMode: "observation_only",
      omitArtifact: true,
      eventKind: "tool_observed",
    });

    const summary = await read(fixture.projectId);
    expect(summary.violationReasonCodes).toContain("tool_result_mode_contract_invalid");
    expect(summary.readyEligible).toBe(false);
  });

  it("rejects an Artifact event kind or origin that conflicts with the Tool registry", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    await appendToolPair(fixture, { eventKind: "tool_observed", artifactOrigin: "main_agent" });

    const summary = await read(fixture.projectId);
    expect(summary.violationReasonCodes).toEqual(expect.arrayContaining([
      "tool_event_kind_invalid",
      "tool_artifact_binding_invalid",
    ]));
    expect(summary.readyEligible).toBe(false);
  });

  it("requires every reused Artifact to retain its original producing Invocation", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    const original = await appendToolPair(fixture, { toolOrdinal: 1, planRevision: 0 });
    await appendToolPair(fixture, {
      toolOrdinal: 2,
      planRevision: 1,
      reuseArtifactId: original.artifactId,
    });
    await client.taskAggregate.update({
      where: { taskId: fixture.taskBrief.taskId },
      data: { planRevision: 2 },
    });
    expect((await read(fixture.projectId)).violationReasonCodes)
      .not.toContain("tool_artifact_reverse_binding_invalid");

    await client.toolInvocationRecord.update({
      where: { invocationId: original.invocationId },
      data: { artifactId: null },
    });
    await client.observationRecord.update({
      where: { observationId: original.observationId },
      data: { artifactId: null },
    });
    const originalEvent = await client.agentEventRecord.findUniqueOrThrow({
      where: { eventId: original.agentEventId },
    });
    const originalPayload = JSON.parse(originalEvent.payloadJson) as Record<string, unknown>;
    delete originalPayload.artifactId;
    await client.agentEventRecord.update({
      where: { eventId: original.agentEventId },
      data: { payloadJson: JSON.stringify(originalPayload) },
    });

    const summary = await read(fixture.projectId);
    expect(summary.violationReasonCodes).toContain("tool_artifact_reverse_binding_invalid");
    expect(summary.readyEligible).toBe(false);
  });

  it("requires plan revision to increase with each current-task Tool ordinal", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    await appendToolPair(fixture, { toolOrdinal: 1, planRevision: 0 });
    await appendToolPair(fixture, { toolOrdinal: 2, planRevision: 0 });
    await client.taskAggregate.update({ where: { taskId: fixture.taskBrief.taskId }, data: { planRevision: 1 } });

    const summary = await read(fixture.projectId);
    expect(summary.violationReasonCodes).toContain("tool_plan_revision_non_monotonic");
    expect(summary.readyEligible).toBe(false);
  });

  it("keeps factsDigest stable when only post-audit aggregate and TurnJob statuses change", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    const before = await read(fixture.projectId);

    await client.taskAggregate.update({ where: { taskId: fixture.taskBrief.taskId }, data: { status: "completed" } });
    await client.conversationTurnJob.update({ where: { id: fixture.turnJobId }, data: { status: "succeeded" } });

    const after = await read(fixture.projectId);
    expect(after.watermark).toBe(before.watermark);
    expect(after.factsDigest).toBe(before.factsDigest);
  });

  it("keeps uncommitted GenerationJob lifecycle changes out of the terminal authority digest", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    const before = await read(fixture.projectId);
    const inputHash = sha256(`unbound-generation:${fixture.projectId}`);
    const snapshot = await client.runInputSnapshot.create({
      data: {
        projectId: fixture.projectId,
        intentEpoch: fixture.taskBrief.intentEpoch,
        capabilityId: "image_asset",
        sourceArtifactIdsJson: JSON.stringify(["unbound-source"]),
        payloadJson: JSON.stringify({ unbound: true }),
        inputHash,
      },
    });
    const job = await client.generationJob.create({
      data: {
        projectId: fixture.projectId,
        kind: "image",
        sourceArtifactId: "unbound-source",
        runInputSnapshotId: snapshot.id,
        intentEpoch: fixture.taskBrief.intentEpoch,
        inputHash,
        status: "queued",
      },
    });
    const queued = await read(fixture.projectId);
    await client.generationJob.update({
      where: { id: job.id },
      data: { status: "running", pollState: "submitting", startedAt: new Date() },
    });
    const running = await read(fixture.projectId);

    expect(queued.watermark).toBe(before.watermark);
    expect(running.watermark).toBe(before.watermark);
    expect(queued.factsDigest).toBe(before.factsDigest);
    expect(running.factsDigest).toBe(before.factsDigest);
    expect(running.summaryDigest).toBe(before.summaryDigest);
  });

  it("deduplicates idempotent teacher submission retries by persisted message identity", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    await appendIngressPair(fixture.projectId, "teacher_message_submit", actorUserId, "another-session");

    const summary = await read(fixture.projectId);
    expect(summary.violationReasonCodes).not.toEqual(expect.arrayContaining([
      "duplicate_teacher_task_submission",
      "teacher_task_submission_session_invalid",
    ]));
    expect(summary.readyEligible).toBe(true);
  });

  it("reports legacy v1 teacher submissions as explicitly unbound instead of current evidence", async () => {
    const fixture = await createSubject();
    await appendLegacyIngressPair(fixture.projectId);

    const summary = await read(fixture.projectId);
    expect(summary.violationReasonCodes).toContain("teacher_task_submission_legacy_unbound");
    expect(summary.violationReasonCodes).not.toContain("teacher_task_submission_missing");
    expect(summary.complete).toBe(false);
    expect(summary.readyEligible).toBe(false);
  });

  it("rejects extra Observation and Event facts that are not in the one-to-one terminal matrix", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    const tool = await appendToolPair(fixture);
    await client.taskAggregate.update({ where: { taskId: fixture.taskBrief.taskId }, data: { planRevision: 1 } });
    await client.observationRecord.create({
      data: {
        observationId: `observation:${randomUUID()}`,
        projectId: fixture.projectId,
        taskId: fixture.taskBrief.taskId,
        invocationId: tool.invocationId,
        intentEpoch: fixture.taskBrief.intentEpoch,
        status: "succeeded",
        reasonCodesJson: JSON.stringify(["extra_observation"]),
        payloadJson: "{}",
      },
    });
    await client.agentEventRecord.create({
      data: {
        eventId: `agent-event:${randomUUID()}`,
        projectId: fixture.projectId,
        taskId: fixture.taskBrief.taskId,
        runId: `turn:${fixture.teacherMessageId}`,
        intentEpoch: fixture.taskBrief.intentEpoch,
        sequence: 2,
        kind: "tool_observed",
        visibility: "internal",
        envelopeJson: "{}",
        payloadJson: JSON.stringify({
          observationId: tool.observationId,
          status: "succeeded",
          reasonCodes: ["tool_succeeded"],
          toolName: "create_requirement_spec",
        }),
        occurredAt: new Date(),
      },
    });

    const summary = await read(fixture.projectId);
    expect(summary.violationReasonCodes).toEqual(expect.arrayContaining([
      "tool_observation_cardinality_invalid",
      "tool_event_cardinality_invalid",
    ]));
    expect(summary.readyEligible).toBe(false);
  });

  it("binds session, claimed project, event run and Observation reason codes into legality and digest", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    const otherProject = await createWorkbenchService(createPrismaWorkbenchRepository(client), undefined, {
      actorUserId,
      actorAuthMode: "password",
      authSessionId: "auth-session-secret",
    }).createProject({ title: `other-${randomUUID()}` });
    const tool = await appendToolPair(fixture, {
      claimedProjectId: otherProject.id,
      authSessionDigest: sha256("another-session"),
    });
    await client.taskAggregate.update({ where: { taskId: fixture.taskBrief.taskId }, data: { planRevision: 1 } });
    const before = await read(fixture.projectId);
    await client.observationRecord.update({
      where: { observationId: tool.observationId },
      data: { reasonCodesJson: JSON.stringify(["tampered_reason"]) },
    });
    const agentEvent = await client.agentEventRecord.findFirstOrThrow({
      where: { projectId: fixture.projectId, taskId: fixture.taskBrief.taskId },
    });
    await client.agentEventRecord.update({
      where: { eventId: agentEvent.eventId },
      data: { runId: "turn:another-message" },
    });

    const summary = await read(fixture.projectId);
    expect(summary.violationReasonCodes).toEqual(expect.arrayContaining([
      "tool_claim_subject_binding_invalid",
      "tool_historical_project_binding_invalid",
      "tool_event_binding_invalid",
    ]));
    expect(summary.factsDigest).not.toBe(before.factsDigest);
    expect(summary.readyEligible).toBe(false);
  });

  it("allows ordinary teacher writes without granting them Tool selector authority", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    await appendIngressPair(fixture.projectId, "project_lifecycle_update");

    const summary = await read(fixture.projectId);

    expect(summary.violationReasonCodes).toEqual([]);
    expect(summary.mainAgentToolCount).toBe(0);
    expect(summary.readyEligible).toBe(true);
  });

  it("rejects project-window mutations from a different authenticated actor", async () => {
    const fixture = await createSubject();
    await appendIngressPair(fixture.projectId, "teacher_message_submit");
    await appendIngressPair(fixture.projectId, "project_lifecycle_update", "another-teacher");

    const summary = await read(fixture.projectId);

    expect(summary.violationReasonCodes).toContain("external_actor_binding_invalid");
    expect(summary.readyEligible).toBe(false);
  });
});

async function read(projectId: string) {
  return readOrchestrationAuthoritySummary({ projectId, actor: { userId: actorUserId } }, client);
}

function summaryWorkbenchService() {
  return createWorkbenchService(createPrismaWorkbenchRepository(client), undefined, {
    actorUserId,
    actorAuthMode: "password",
    authSessionId: "auth-session-secret",
  });
}

async function createSubject(requestedOutputs: TaskRequestedOutput[] = ["requirement_spec"]) {
  const service = summaryWorkbenchService();
  const project = await service.createProject({ title: `authority-summary-${randomUUID()}` });
  const teacherMessage = await service.addMessage(project.id, { role: "teacher", content: "只做需求规格" });
  const taskBrief = createTaskBrief({
    taskId: `task:${randomUUID()}`,
    projectId: project.id,
    intentEpoch: 0,
    goal: teacherMessage.content,
    requestedOutputs,
    constraints: [],
    excludedOutputs: [],
    generationIntensity: "standard",
    sourceMessageId: teacherMessage.id,
  });
  const intentGrant: IntentGrant = {
    schemaVersion: "intent-grant.v1",
    taskId: taskBrief.taskId,
    projectId: project.id,
    intentEpoch: 0,
    standardWorkAuthorized: true,
    intensity: "standard",
    budgetPolicyVersion: null,
    maxCostCredits: null,
    maxExternalProviderCalls: null,
    requiredCheckpoints: [],
    expiresAt: null,
  };
  const turnJob = await service.enqueueConversationTurn(project.id, {
    teacherMessageId: teacherMessage.id,
    idempotencyKey: `turn:${randomUUID()}`,
    maxAttempts: 1,
  });
  const planId = `plan:${taskBrief.taskId}`;
  await createControlPlaneStore(client).upsertTaskAggregate({
    taskBrief,
    intentGrant,
    plan: { planId, revision: 0, status: "active" },
    checkpoint: null,
  });
  return {
    projectId: project.id,
    teacherMessageId: teacherMessage.id,
    turnJobId: turnJob.id,
    taskBrief,
    intentGrant,
    planId,
  };
}

async function createNextSubject(previous: Awaited<ReturnType<typeof createSubject>>) {
  const service = createWorkbenchService(createPrismaWorkbenchRepository(client), undefined, {
    actorUserId,
    actorAuthMode: "password",
    authSessionId: "auth-session-secret",
  });
  const intentEpoch = await service.advanceProjectIntentEpoch(previous.projectId, previous.taskBrief.intentEpoch);
  const teacherMessage = await service.addMessage(previous.projectId, {
    role: "teacher",
    content: "新任务仍然只做需求规格",
  });
  const taskBrief = createTaskBrief({
    taskId: `task:${randomUUID()}`,
    projectId: previous.projectId,
    intentEpoch,
    goal: teacherMessage.content,
    requestedOutputs: previous.taskBrief.requestedOutputs,
    constraints: [],
    excludedOutputs: [],
    generationIntensity: "standard",
    sourceMessageId: teacherMessage.id,
  });
  const intentGrant: IntentGrant = {
    ...previous.intentGrant,
    taskId: taskBrief.taskId,
    intentEpoch,
  };
  const turnJob = await service.enqueueConversationTurn(previous.projectId, {
    teacherMessageId: teacherMessage.id,
    idempotencyKey: `turn:${randomUUID()}`,
    maxAttempts: 1,
  });
  const planId = `plan:${taskBrief.taskId}`;
  await createControlPlaneStore(client).upsertTaskAggregate({
    taskBrief,
    intentGrant,
    plan: { planId, revision: 0, status: "active" },
    checkpoint: null,
  });
  return {
    projectId: previous.projectId,
    teacherMessageId: teacherMessage.id,
    turnJobId: turnJob.id,
    taskBrief,
    intentGrant,
    planId,
  };
}

async function commitProviderToolPair(fixture: Awaited<ReturnType<typeof createSubject>>) {
  const service = summaryWorkbenchService();
  await service.startNextConversationTurnJob(fixture.projectId, {
    expectedJobId: fixture.turnJobId,
    lockedBy: "authority-summary-provider-worker",
  });
  const source = await client.artifact.create({
    data: {
      id: `source:${randomUUID()}`,
      projectId: fixture.projectId,
      taskId: fixture.taskBrief.taskId,
      taskBriefDigest: fixture.taskBrief.digest,
      intentEpoch: fixture.taskBrief.intentEpoch,
      planRevision: 0,
      origin: "teacher_input",
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "PPT大纲",
      status: "needs_review",
      summary: "课堂图片来源",
      markdownContent: "# PPT大纲",
      structuredContentJson: "{}",
      version: 1,
    },
  });
  await service.approveArtifact(fixture.projectId, source.id);
  const tool = getToolDefinition("generate_classroom_image");
  const request = { pageIds: ["page-1"] };
  const envelope = createExecutionEnvelope({
    actorUserId,
    taskBrief: fixture.taskBrief,
    planRevision: 0,
    intensity: fixture.taskBrief.generationIntensity,
    intentGrant: fixture.intentGrant,
    action: { toolName: tool.id, arguments: request },
  });
  const invocationId = `provider-invocation:${randomUUID()}`;
  const store = createControlPlaneStore(client);
  await store.startToolInvocation({ invocationId, envelope, toolName: tool.id, request });
  const inputSnapshot = {
    toolName: tool.id,
    arguments: request,
    taskBriefDigest: fixture.taskBrief.digest,
    intentEpoch: fixture.taskBrief.intentEpoch,
    sourceArtifacts: [{ artifactId: source.id, kind: source.kind, version: source.version }],
  };
  const queued = await service.createGenerationJob(fixture.projectId, {
    kind: "image",
    sourceArtifactId: source.id,
    capabilityId: tool.capabilityId,
    idempotencyKey: envelope.idempotencyKey,
    sourceArtifactIds: [source.id],
    inputSnapshot,
  });
  const job = (await service.startGenerationJobForExecution(fixture.projectId, queued.id)).job;
  const artifactDraft = {
    nodeKey: "image_prompts" as const,
    kind: "image_prompts" as const,
    title: "课堂图片",
    summary: "真实Provider合同夹具",
    markdownContent: "# 课堂图片",
    structuredContent: { providerEvidence: { fixture: true } },
  };
  const validationReport = validateToolExecutionResult({
    tool,
    projectId: fixture.projectId,
    result: {
      status: "succeeded",
      artifactDraft,
      artifactTruth: {
        created: true,
        persisted: true,
        placeholder: false,
        producedArtifactKind: artifactDraft.kind,
      },
      qualityGate: { passed: true, gates: ["offline_provider_contract"] },
    },
    inputHash: job.inputHash!,
    intentEpoch: fixture.taskBrief.intentEpoch,
  });
  const observationId = `provider-observation:${randomUUID()}`;
  await store.commitToolResult({
    invocationId,
    generationJobId: job.id,
    artifact: { ...artifactDraft, status: "needs_review", validationReport },
    observation: {
      observationId,
      status: "succeeded",
      reasonCodes: ["provider_tool_succeeded"],
      payload: { summary: "Provider合同闭环" },
    },
    event: {
      eventId: `provider-event:${randomUUID()}`,
      projectId: fixture.projectId,
      taskId: fixture.taskBrief.taskId,
      runId: `turn:${fixture.teacherMessageId}`,
      intentEpoch: fixture.taskBrief.intentEpoch,
      kind: "artifact_committed",
      visibility: "internal",
      occurredAt: new Date().toISOString(),
      payload: { observationId, status: "succeeded" },
    },
  });
  const invocation = await store.getToolInvocation(invocationId);
  if (!invocation?.artifactId) throw new Error("Provider fixture Artifact was not committed.");
  return {
    artifactId: invocation.artifactId,
    reportId: validationReport.reportId,
    sourceArtifactId: source.id,
    inputSnapshot,
  };
}

async function appendIngressPair(
  projectId: string,
  operation: "project_create" | "teacher_message_submit" | "project_lifecycle_update" | "unclassified_external",
  eventActorUserId = actorUserId,
  authSessionId = "auth-session-secret",
) {
  const store = prismaAuditStore();
  const request = operation === "project_create"
    ? new Request("https://localhost/api/workbench/projects", { method: "POST" })
    : operation === "teacher_message_submit"
      ? new Request(`https://localhost/api/workbench/projects/${projectId}/messages`, { method: "POST" })
      : operation === "project_lifecycle_update"
        ? new Request(`https://localhost/api/workbench/projects/${projectId}`, { method: "PATCH" })
        : new Request(`https://localhost/api/workbench/projects/${projectId}/unknown-write`, { method: "POST" });
  const submittedMessage = operation === "teacher_message_submit"
    ? await client.conversationMessage.findFirst({
        where: { projectId, role: "teacher" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
    : null;
  await runWithOrchestrationIngressAudit({
    request,
    identity: { actorUserId: eventActorUserId, actorAuthMode: "password", authSessionId },
    store,
    handler: async () => operation === "project_create"
      ? Response.json({ project: { id: projectId }, secret: "request-secret" }, { status: 201 })
      : operation === "teacher_message_submit"
        ? Response.json({ message: { id: submittedMessage?.id } }, { status: 202 })
        : new Response(null, { status: 204 }),
  });
}

async function appendOpenAttempt(projectId: string) {
  let appendCount = 0;
  const persistent = prismaAuditStore();
  const store: OrchestrationIngressAuditStore = {
    async append(event) {
      appendCount += 1;
      if (appendCount === 2) throw new Error("private-error");
      return persistent.append({ ...event, attemptId: "open-attempt-private-id" });
    },
  };
  await expect(runWithOrchestrationIngressAudit({
    request: new Request(`https://localhost/api/workbench/projects/${projectId}`, { method: "PATCH" }),
    identity: { actorUserId, actorAuthMode: "password", authSessionId: "auth-session-secret" },
    store,
    handler: async () => new Response(null, { status: 204 }),
  })).rejects.toThrow("private-error");
}

function prismaAuditStore(): OrchestrationIngressAuditStore {
  return {
    async append(event) {
      const row = await client.orchestrationAuditEvent.create({
        data: { ...event, occurredAt: new Date(event.occurredAt) },
      });
      return { ...event, sequence: row.sequence };
    },
  };
}

async function appendToolPair(
  fixture: Awaited<ReturnType<typeof createSubject>>,
  options: {
    authority?: "main_agent" | "artifact_route";
    actorAuthMode?: "local" | "password";
    toolOrdinal?: number;
    terminalToolName?: string;
    observationOnly?: boolean;
    claimedProjectId?: string;
    authSessionDigest?: string;
    turnJobId?: string;
    planId?: string;
    auditResultMode?: "artifact_required" | "observation_only";
    omitArtifact?: boolean;
    artifactOrigin?: string;
    eventKind?: string;
    planRevision?: number;
    reuseArtifactId?: string;
  } = {},
) {
  const authority = options.authority ?? "main_agent";
  const toolOrdinal = options.toolOrdinal ?? 1;
  const toolName = options.observationOnly ? "ppt_director.plan_or_repair" : "create_requirement_spec";
  const planRevision = options.planRevision ?? 0;
  const resultMode = options.auditResultMode ?? (options.observationOnly ? "observation_only" : "artifact_required");
  const hasArtifact = !options.observationOnly && !options.omitArtifact;
  const request = { requirement: `request-secret-${toolOrdinal}` };
  const envelope = createExecutionEnvelope({
    actorUserId,
    taskBrief: fixture.taskBrief,
    planRevision,
    intensity: "standard",
    intentGrant: fixture.intentGrant,
    action: { toolName, arguments: request },
  });
  const invocationId = `invocation:${randomUUID()}`;
  const observationId = `observation:${randomUUID()}`;
  const artifactId = options.reuseArtifactId ?? `artifact:${randomUUID()}`;
  const agentEventId = `agent-event:${randomUUID()}`;
  const executionEnvelopeJson = JSON.stringify(envelope);
  const requestJson = JSON.stringify(request);
  const latestAgentEvent = await client.agentEventRecord.findFirst({
    where: { projectId: fixture.projectId },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  await client.toolInvocationRecord.create({
    data: {
      invocationId,
      projectId: fixture.projectId,
      taskId: fixture.taskBrief.taskId,
      intentEpoch: fixture.taskBrief.intentEpoch,
      planRevision,
      toolName,
      executionEnvelopeJson,
      requestJson,
      idempotencyKey: envelope.idempotencyKey,
      status: "succeeded",
      artifactId: hasArtifact ? artifactId : null,
      observationId,
      finishedAt: new Date(),
    },
  });
  if (hasArtifact && !options.reuseArtifactId) await client.artifact.create({
    data: {
      id: artifactId,
      projectId: fixture.projectId,
      taskId: fixture.taskBrief.taskId,
      taskBriefDigest: fixture.taskBrief.digest,
      intentEpoch: fixture.taskBrief.intentEpoch,
      planRevision,
      origin: options.artifactOrigin ?? "tool_result",
      nodeKey: "requirement_spec",
      title: "需求规格",
      kind: "requirement_spec",
      status: "draft",
      summary: "summary",
      markdownContent: "content",
      structuredContentJson: "{}",
      version: 1,
    },
  });
  await client.observationRecord.create({
    data: {
      observationId,
      projectId: fixture.projectId,
      taskId: fixture.taskBrief.taskId,
      invocationId,
      intentEpoch: fixture.taskBrief.intentEpoch,
      status: "succeeded",
      reasonCodesJson: JSON.stringify(["tool_succeeded"]),
      payloadJson: JSON.stringify({ private: "request-secret" }),
      artifactId: hasArtifact ? artifactId : null,
    },
  });
  await client.agentEventRecord.create({
    data: {
      eventId: agentEventId,
      projectId: fixture.projectId,
      taskId: fixture.taskBrief.taskId,
      runId: `turn:${fixture.teacherMessageId}`,
      intentEpoch: fixture.taskBrief.intentEpoch,
      sequence: (latestAgentEvent?.sequence ?? 0) + 1,
      kind: options.eventKind ?? (options.observationOnly ? "tool_observed" : "artifact_committed"),
      visibility: "internal",
      envelopeJson: "{}",
      payloadJson: JSON.stringify({
        observationId,
        status: "succeeded",
        reasonCodes: ["tool_succeeded"],
        toolName,
        ...(hasArtifact ? { artifactId } : {}),
      }),
      occurredAt: new Date(),
    },
  });
  const attemptId = invocationId;
  const common = {
    attemptId,
    operationKind: "tool_invocation",
    authority,
    claimedProjectId: options.claimedProjectId ?? fixture.projectId,
    resolvedProjectId: fixture.projectId,
    actorUserId,
    actorAuthMode: options.actorAuthMode ?? "password",
    authSessionDigest: options.authSessionDigest ?? sha256("auth-session-secret"),
    taskId: fixture.taskBrief.taskId,
    turnJobId: options.turnJobId ?? fixture.turnJobId,
    teacherMessageId: fixture.teacherMessageId,
    toolInvocationId: invocationId,
    intentEpoch: fixture.taskBrief.intentEpoch,
    planRevision,
    planId: options.planId ?? fixture.planId,
    toolOrdinal,
    toolName,
    actionDigest: envelope.actionDigest,
    idempotencyKey: envelope.idempotencyKey,
    executionEnvelopeDigest: sha256(executionEnvelopeJson),
    requestDigest: sha256(requestJson),
  } as const;
  const attempted = {
    ...common,
    eventId: `tool-event:${randomUUID()}`,
    recordType: "attempted",
    outcome: null,
    observationId: null,
    invocationStatus: "running",
    reasonCode: "tool_invocation_claimed",
    payloadJson: JSON.stringify({
      schemaVersion: "tool-invocation-audit.v2",
      resultMode,
    }),
    occurredAt: new Date().toISOString(),
  } as const;
  const resolved = {
    ...common,
    toolName: options.terminalToolName ?? common.toolName,
    eventId: `tool-event:${randomUUID()}`,
    recordType: "resolved",
    outcome: "committed",
    observationId,
    invocationStatus: "succeeded",
    reasonCode: "tool_invocation_succeeded",
    payloadJson: JSON.stringify({
      schemaVersion: "tool-invocation-audit.v2",
      resultMode,
    }),
    occurredAt: new Date().toISOString(),
  } as const;
  await client.orchestrationAuditEvent.create({
    data: { ...attempted, eventDigest: digestToolAuditEvent(attempted as never), occurredAt: new Date(attempted.occurredAt) },
  });
  await client.orchestrationAuditEvent.create({
    data: { ...resolved, eventDigest: digestToolAuditEvent(resolved as never), occurredAt: new Date(resolved.occurredAt) },
  });
  return {
    invocationId,
    observationId,
    artifactId,
    agentEventId,
    auditEventIds: [attempted.eventId, resolved.eventId],
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function legacyIngressAuditDigest(value: Record<string, unknown>) {
  const payload = Object.fromEntries([
    "eventId", "attemptId", "recordType", "outcome", "operationKind", "authority",
    "claimedProjectId", "resolvedProjectId", "actorUserId", "actorAuthMode", "authSessionDigest",
    "reasonCode", "payloadJson", "occurredAt",
  ].map((key) => [key, value[key] instanceof Date ? (value[key] as Date).toISOString() : value[key]]));
  return createHash("sha256")
    .update("shanhai-orchestration-audit-event.v1\0", "utf8")
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
}

async function appendLegacyIngressPair(projectId: string) {
  const attemptId = `legacy-ingress:${randomUUID()}`;
  const occurredAt = new Date();
  const payload = JSON.stringify({
    operation: "teacher_message_submit",
    routeTemplate: "/api/workbench/projects/:projectId/messages",
    method: "POST",
    controlImpact: "teacher_task_submission",
    httpStatus: null,
  });
  const common = {
    attemptId,
    operationKind: "external_mutation",
    authority: "teacher_http",
    claimedProjectId: projectId,
    actorUserId,
    actorAuthMode: "password",
    authSessionDigest: sha256("auth-session-secret"),
    teacherMessageId: null,
  } as const;
  const attempted = {
    ...common,
    eventId: `legacy-ingress-event:${randomUUID()}`,
    recordType: "attempted",
    outcome: null,
    resolvedProjectId: null,
    reasonCode: null,
    payloadJson: payload,
    occurredAt,
  } as const;
  const resolvedPayload = JSON.stringify({ ...JSON.parse(payload), httpStatus: 202 });
  const resolved = {
    ...common,
    eventId: `legacy-ingress-event:${randomUUID()}`,
    recordType: "resolved",
    outcome: "committed",
    resolvedProjectId: projectId,
    reasonCode: "http_2xx",
    payloadJson: resolvedPayload,
    occurredAt: new Date(occurredAt.getTime() + 1),
  } as const;
  await client.orchestrationAuditEvent.create({
    data: { ...attempted, eventDigest: legacyIngressAuditDigest(attempted) },
  });
  await client.orchestrationAuditEvent.create({
    data: { ...resolved, eventDigest: legacyIngressAuditDigest(resolved) },
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
}
