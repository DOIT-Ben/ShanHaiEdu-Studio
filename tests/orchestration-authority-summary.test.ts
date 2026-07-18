import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readOrchestrationAuthoritySummary } from "@/server/conversation/orchestration-authority-summary";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { createExecutionEnvelope, createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import {
  runWithOrchestrationIngressAudit,
  type OrchestrationIngressAuditStore,
} from "@/server/workbench/orchestration-ingress-audit";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService } from "@/server/workbench/service";
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

async function createSubject() {
  const service = createWorkbenchService(createPrismaWorkbenchRepository(client), undefined, {
    actorUserId,
    actorAuthMode: "password",
    authSessionId: "auth-session-secret",
  });
  const project = await service.createProject({ title: `authority-summary-${randomUUID()}` });
  const teacherMessage = await service.addMessage(project.id, { role: "teacher", content: "只做需求规格" });
  const taskBrief = createTaskBrief({
    taskId: `task:${randomUUID()}`,
    projectId: project.id,
    intentEpoch: 0,
    goal: teacherMessage.content,
    requestedOutputs: ["requirement_spec"],
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

async function appendIngressPair(
  projectId: string,
  operation: "project_create" | "teacher_message_submit" | "project_lifecycle_update" | "unclassified_external",
  eventActorUserId = actorUserId,
) {
  const store = prismaAuditStore();
  const request = operation === "project_create"
    ? new Request("https://localhost/api/workbench/projects", { method: "POST" })
    : operation === "teacher_message_submit"
      ? new Request(`https://localhost/api/workbench/projects/${projectId}/messages`, { method: "POST" })
      : operation === "project_lifecycle_update"
        ? new Request(`https://localhost/api/workbench/projects/${projectId}`, { method: "PATCH" })
        : new Request(`https://localhost/api/workbench/projects/${projectId}/unknown-write`, { method: "POST" });
  await runWithOrchestrationIngressAudit({
    request,
    identity: { actorUserId: eventActorUserId, actorAuthMode: "password", authSessionId: "auth-session-secret" },
    store,
    handler: async () => operation === "project_create"
      ? Response.json({ project: { id: projectId }, secret: "request-secret" }, { status: 201 })
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
  } = {},
) {
  const authority = options.authority ?? "main_agent";
  const toolOrdinal = options.toolOrdinal ?? 1;
  const toolName = "create_requirement_spec";
  const request = { requirement: "request-secret" };
  const envelope = createExecutionEnvelope({
    actorUserId,
    taskBrief: fixture.taskBrief,
    planRevision: 0,
    intensity: "standard",
    intentGrant: fixture.intentGrant,
    action: { toolName, arguments: request },
  });
  const invocationId = `invocation:${randomUUID()}`;
  const observationId = `observation:${randomUUID()}`;
  const artifactId = `artifact:${randomUUID()}`;
  const executionEnvelopeJson = JSON.stringify(envelope);
  const requestJson = JSON.stringify(request);
  await client.toolInvocationRecord.create({
    data: {
      invocationId,
      projectId: fixture.projectId,
      taskId: fixture.taskBrief.taskId,
      intentEpoch: 0,
      planRevision: 0,
      toolName,
      executionEnvelopeJson,
      requestJson,
      idempotencyKey: envelope.idempotencyKey,
      status: "succeeded",
      artifactId: options.observationOnly ? null : artifactId,
      observationId,
      finishedAt: new Date(),
    },
  });
  if (!options.observationOnly) await client.artifact.create({
    data: {
      id: artifactId,
      projectId: fixture.projectId,
      taskId: fixture.taskBrief.taskId,
      taskBriefDigest: fixture.taskBrief.digest,
      intentEpoch: 0,
      planRevision: 0,
      origin: "main_agent",
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
      intentEpoch: 0,
      status: "succeeded",
      payloadJson: JSON.stringify({ private: "request-secret" }),
      artifactId: options.observationOnly ? null : artifactId,
    },
  });
  await client.agentEventRecord.create({
    data: {
      eventId: `agent-event:${randomUUID()}`,
      projectId: fixture.projectId,
      taskId: fixture.taskBrief.taskId,
      runId: `turn:${fixture.teacherMessageId}`,
      intentEpoch: 0,
      sequence: 1,
      kind: options.observationOnly ? "tool_observed" : "artifact_committed",
      visibility: "internal",
      envelopeJson: "{}",
      payloadJson: JSON.stringify({ observationId, status: "succeeded" }),
      occurredAt: new Date(),
    },
  });
  const attemptId = invocationId;
  const common = {
    attemptId,
    operationKind: "tool_invocation",
    authority,
    claimedProjectId: fixture.projectId,
    resolvedProjectId: fixture.projectId,
    actorUserId,
    actorAuthMode: options.actorAuthMode ?? "password",
    authSessionDigest: sha256("auth-session-secret"),
    taskId: fixture.taskBrief.taskId,
    turnJobId: fixture.turnJobId,
    teacherMessageId: fixture.teacherMessageId,
    toolInvocationId: invocationId,
    intentEpoch: 0,
    planRevision: 0,
    planId: fixture.planId,
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
    payloadJson: JSON.stringify({ schemaVersion: "tool-invocation-audit.v1" }),
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
    payloadJson: JSON.stringify({ schemaVersion: "tool-invocation-audit.v1" }),
    occurredAt: new Date().toISOString(),
  } as const;
  await client.orchestrationAuditEvent.create({
    data: { ...attempted, eventDigest: auditEventDigest(attempted), occurredAt: new Date(attempted.occurredAt) },
  });
  await client.orchestrationAuditEvent.create({
    data: { ...resolved, eventDigest: auditEventDigest(resolved), occurredAt: new Date(resolved.occurredAt) },
  });
  return { invocationId, observationId, artifactId };
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function auditEventDigest(value: Record<string, unknown>) {
  return createHash("sha256")
    .update("shanhai-orchestration-audit-event.v1\0", "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(",")}}`;
}
