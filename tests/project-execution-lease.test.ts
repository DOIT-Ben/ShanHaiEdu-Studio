import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { assertExecutionIdentityCanWriteProject } from "@/server/execution/execution-identity";
import { createProjectExecutionLeaseRepository } from "@/server/execution/project-execution-lease";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService } from "@/server/workbench/service";
import { drainProjectConversationQueue } from "@/server/conversation/conversation-turn-queue";
import { createWorkbenchActor } from "@/server/auth/actor";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

const root = process.cwd();
const stageRoot = path.join(root, ".tmp", "stage1a-tests");
const databasePath = path.join(stageRoot, `execution-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;

let clientA: PrismaClient;
let clientB: PrismaClient;

beforeAll(async () => {
  mkdirSync(stageRoot, { recursive: true });
  const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
    encoding: "utf8",
  });
  if (initialized.status !== 0) {
    throw new Error(initialized.stderr || initialized.stdout || "Stage 1A test database initialization failed.");
  }
  clientA = createClient();
  clientB = createClient();
});

afterAll(async () => {
  await Promise.allSettled([clientA?.$disconnect(), clientB?.$disconnect()]);
  rmSync(databasePath, { force: true });
});

describe("V1 Stage 1A project execution lease", () => {
  it("allows only one of two independent clients to acquire the same project", async () => {
    const project = await createProject(clientA, "same-project");
    const leaseA = createProjectExecutionLeaseRepository(clientA);
    const leaseB = createProjectExecutionLeaseRepository(clientB);
    const now = new Date("2026-07-12T00:00:00.000Z");

    const acquired = await Promise.all([
      leaseA.acquire({ projectId: project.id, holderId: "worker-a", leaseMs: 60_000, now }),
      leaseB.acquire({ projectId: project.id, holderId: "worker-b", leaseMs: 60_000, now }),
    ]);

    expect(acquired.filter(Boolean)).toHaveLength(1);
    const persisted = await leaseA.get(project.id);
    expect(persisted).toMatchObject({ fencingToken: 1 });
    expect(["worker-a", "worker-b"]).toContain(persisted?.holderId);
  });

  it("allows independent projects to hold leases concurrently", async () => {
    const [projectA, projectB] = await Promise.all([
      createProject(clientA, "parallel-project-a"),
      createProject(clientB, "parallel-project-b"),
    ]);
    const now = new Date("2026-07-12T01:00:00.000Z");
    const [leaseA, leaseB] = await Promise.all([
      createProjectExecutionLeaseRepository(clientA).acquire({ projectId: projectA.id, holderId: "parallel-a", now }),
      createProjectExecutionLeaseRepository(clientB).acquire({ projectId: projectB.id, holderId: "parallel-b", now }),
    ]);

    expect(leaseA).toMatchObject({ projectId: projectA.id, holderId: "parallel-a", fencingToken: 1 });
    expect(leaseB).toMatchObject({ projectId: projectB.id, holderId: "parallel-b", fencingToken: 1 });
  });

  it("increments the fence on takeover and rejects the old worker", async () => {
    const project = await createProject(clientA, "takeover-project");
    const repositoryA = createProjectExecutionLeaseRepository(clientA);
    const repositoryB = createProjectExecutionLeaseRepository(clientB);
    const first = await repositoryA.acquire({
      projectId: project.id,
      holderId: "old-worker",
      leaseMs: 1_000,
      now: new Date("2026-07-12T02:00:00.000Z"),
    });
    const next = await repositoryB.acquire({
      projectId: project.id,
      holderId: "new-worker",
      leaseMs: 60_000,
      now: new Date("2026-07-12T02:00:02.000Z"),
    });

    expect(first?.fencingToken).toBe(1);
    expect(next?.fencingToken).toBe(2);
    await expect(repositoryA.assertCurrent({
      projectId: project.id,
      holderId: "old-worker",
      fencingToken: first!.fencingToken,
    }, new Date("2026-07-12T02:00:02.500Z"))).rejects.toMatchObject({ code: "execution_lease_rejected" });
    await expect(repositoryB.assertCurrent({
      projectId: project.id,
      holderId: "new-worker",
      fencingToken: next!.fencingToken,
    }, new Date("2026-07-12T02:00:02.500Z"))).resolves.toMatchObject({ holderId: "new-worker" });
  });

  it("renews without changing the token and ignores an old release", async () => {
    const project = await createProject(clientA, "renew-project");
    const repository = createProjectExecutionLeaseRepository(clientA);
    const lease = await repository.acquire({
      projectId: project.id,
      holderId: "renew-worker",
      leaseMs: 10_000,
      now: new Date("2026-07-12T03:00:00.000Z"),
    });
    const renewed = await repository.renew({
      projectId: project.id,
      holderId: "renew-worker",
      fencingToken: lease!.fencingToken,
      leaseMs: 20_000,
      now: new Date("2026-07-12T03:00:05.000Z"),
    });

    expect(renewed?.fencingToken).toBe(lease?.fencingToken);
    expect(renewed?.leasedUntil.toISOString()).toBe("2026-07-12T03:00:25.000Z");
    expect(await repository.release({ projectId: project.id, holderId: "other-worker", fencingToken: 1 })).toBe(false);
    expect((await repository.get(project.id))?.holderId).toBe("renew-worker");
  });

  it("increments the token when an expired holder id is reused", async () => {
    const project = await createProject(clientA, "reused-holder-project");
    const repository = createProjectExecutionLeaseRepository(clientA);
    const first = await repository.acquire({
      projectId: project.id,
      holderId: "reused-worker",
      leaseMs: 1_000,
      now: new Date("2026-07-12T03:30:00.000Z"),
    });
    const second = await repository.acquire({
      projectId: project.id,
      holderId: "reused-worker",
      leaseMs: 1_000,
      now: new Date("2026-07-12T03:30:02.000Z"),
    });

    expect(second?.fencingToken).toBe(first!.fencingToken + 1);
  });
});

describe("V1 Stage 1A execution identity", () => {
  it("fails closed when the actor is disabled or the session is revoked", async () => {
    const userId = `user-${randomUUID()}`;
    const sessionId = `session-${randomUUID()}`;
    await clientA.localUser.create({
      data: { id: userId, displayName: "Stage 1A Teacher", role: "teacher", authMode: "password" },
    });
    const project = await createProject(clientA, "identity-project", userId);
    await clientA.authSession.create({
      data: {
        id: sessionId,
        userId,
        sessionTokenHash: `hash-${randomUUID()}`,
        authMode: "password",
        expiresAt: new Date("2026-07-13T00:00:00.000Z"),
      },
    });
    const identity = { actorUserId: userId, actorAuthMode: "password" as const, authSessionId: sessionId };
    const now = new Date("2026-07-12T04:00:00.000Z");

    await expect(assertExecutionIdentityCanWriteProject(clientA, identity, project.id, now)).resolves.toBeUndefined();
    await clientA.localUser.update({ where: { id: userId }, data: { disabledAt: now } });
    await expect(assertExecutionIdentityCanWriteProject(clientA, identity, project.id, now)).rejects.toMatchObject({ code: "session_inactive" });
    await clientA.localUser.update({ where: { id: userId }, data: { disabledAt: null } });
    await clientA.authSession.update({ where: { id: sessionId }, data: { revokedAt: now } });
    await expect(assertExecutionIdentityCanWriteProject(clientA, identity, project.id, now)).rejects.toMatchObject({ code: "session_inactive" });
  });

  it("fails closed when the public session is expired", async () => {
    const userId = `expired-user-${randomUUID()}`;
    const sessionId = `expired-session-${randomUUID()}`;
    await clientA.localUser.create({
      data: { id: userId, displayName: "Expired Teacher", role: "teacher", authMode: "password" },
    });
    const project = await createProject(clientA, "expired-identity-project", userId);
    await clientA.authSession.create({
      data: {
        id: sessionId,
        userId,
        sessionTokenHash: `expired-hash-${randomUUID()}`,
        authMode: "password",
        expiresAt: new Date("2026-07-12T04:59:59.000Z"),
      },
    });

    await expect(assertExecutionIdentityCanWriteProject(clientA, {
      actorUserId: userId,
      actorAuthMode: "password",
      authSessionId: sessionId,
    }, project.id, new Date("2026-07-12T05:00:00.000Z"))).rejects.toMatchObject({ code: "session_inactive" });
  });

  it("rejects a public actor without a session snapshot", async () => {
    await expect(assertExecutionIdentityCanWriteProject(clientA, {
      actorUserId: "missing-session-user",
      actorAuthMode: "password",
      authSessionId: null,
    }, "missing-project")).rejects.toMatchObject({ code: "session_missing" });
  });

  it("quarantines a queued job with no actor snapshot before calling the executor", async () => {
    const project = await createProject(clientA, "missing-actor-project");
    const message = await clientA.conversationMessage.create({
      data: { projectId: project.id, role: "teacher", content: "missing actor" },
    });
    const job = await clientA.conversationTurnJob.create({
      data: { projectId: project.id, teacherMessageId: message.id },
    });
    const service = createWorkbenchService(createPrismaWorkbenchRepository(clientA), undefined, {
      actorUserId: "local-stage1a-worker",
      actorAuthMode: "local",
      authSessionId: null,
    });
    let executorCalls = 0;

    const result = await drainProjectConversationQueue(project.id, {
      service,
      workerId: `missing-actor-${randomUUID()}`,
      executor: async () => {
        executorCalls += 1;
        return {};
      },
    });

    expect(executorCalls).toBe(0);
    expect(result).toMatchObject({ started: 0, succeeded: 0, failed: 1 });
    expect(await clientA.conversationTurnJob.findUnique({ where: { id: job.id } })).toMatchObject({
      status: "quarantined",
      errorCode: "execution_identity_invalid",
    });
  });

  it("quarantines a public job after its session is revoked", async () => {
    const userId = `queue-user-${randomUUID()}`;
    const sessionId = `queue-session-${randomUUID()}`;
    await clientA.localUser.create({
      data: { id: userId, displayName: "Queue Teacher", role: "teacher", authMode: "password" },
    });
    const project = await createProject(clientA, "revoked-queue-project", userId);
    await clientA.authSession.create({
      data: {
        id: sessionId,
        userId,
        sessionTokenHash: `queue-hash-${randomUUID()}`,
        authMode: "password",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const identity = { actorUserId: userId, actorAuthMode: "password" as const, authSessionId: sessionId };
    const actor = createWorkbenchActor({ userId, displayName: "Queue Teacher", authMode: "password", projectRoles: {} });
    const service = createWorkbenchService(createPrismaWorkbenchRepository(clientA), actor, identity);
    const message = await service.addMessage(project.id, { role: "teacher", content: "revoke before execute" });
    const job = await service.enqueueConversationTurn(project.id, { teacherMessageId: message.id });
    await clientA.authSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });

    const result = await drainProjectConversationQueue(project.id, {
      service,
      workerId: `revoked-${randomUUID()}`,
      executor: async () => {
        throw new Error("revoked executor must not run");
      },
    });

    expect(result).toMatchObject({ started: 0, succeeded: 0, failed: 1 });
    expect(await clientA.conversationTurnJob.findUnique({ where: { id: job.id } })).toMatchObject({
      status: "quarantined",
      errorCode: "execution_identity_invalid",
    });
  });

  it("quarantines an old worker completion after a new fence takes over", async () => {
    const project = await createProject(clientA, "fenced-commit-project");
    const repository = createPrismaWorkbenchRepository(clientA);
    const identity = { actorUserId: "local-fenced-worker", actorAuthMode: "local" as const, authSessionId: null };
    const service = createWorkbenchService(repository, undefined, identity);
    const message = await service.addMessage(project.id, { role: "teacher", content: "fenced completion" });
    const queued = await service.enqueueConversationTurn(project.id, { teacherMessageId: message.id });
    const oldNow = new Date(Date.now() - 2_000);
    const leaseRepositoryA = createProjectExecutionLeaseRepository(clientA);
    const leaseRepositoryB = createProjectExecutionLeaseRepository(clientB);
    const oldLease = await leaseRepositoryA.acquire({ projectId: project.id, holderId: "old-commit-worker", leaseMs: 1_000, now: oldNow });
    const oldFence = { projectId: project.id, holderId: "old-commit-worker", fencingToken: oldLease!.fencingToken };
    const running = await service.startNextConversationTurnJob(project.id, {
      lockedBy: oldFence.holderId,
      lockMs: 10_000,
      fence: oldFence,
      now: new Date(oldNow.getTime() + 500),
    });
    const newLease = await leaseRepositoryB.acquire({ projectId: project.id, holderId: "new-commit-worker", leaseMs: 60_000 });
    const oldExecution = service.withExecutionGuard({ ...oldFence, identity });

    const completed = await oldExecution.finishConversationTurnJob(project.id, running!.id, { status: "succeeded" });

    expect(newLease?.fencingToken).toBe(oldLease!.fencingToken + 1);
    expect(completed).toMatchObject({ id: queued.id, status: "quarantined", errorCode: "execution_fence_rejected" });
  });
});

describe("V1 Stage 1A SQLite upgrade", () => {
  it("adds execution columns and lease storage without losing an existing turn job", () => {
    const legacyPath = path.join(stageRoot, `legacy-${randomUUID()}.db`);
    const legacyUrl = `file:${legacyPath.replaceAll("\\", "/")}`;
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE "Project" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "title" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'active',
        "currentNodeKey" TEXT NOT NULL,
        "ownerUserId" TEXT,
        "grade" TEXT,
        "subject" TEXT,
        "textbookVersion" TEXT,
        "lessonTopic" TEXT,
        "archivedAt" DATETIME,
        "deletedAt" DATETIME,
        "lifecycleVersion" INTEGER NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL
      );
      CREATE TABLE "ConversationTurnJob" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "projectId" TEXT NOT NULL,
        "teacherMessageId" TEXT NOT NULL,
        "assistantMessageId" TEXT,
        "status" TEXT NOT NULL DEFAULT 'queued',
        "attempts" INTEGER NOT NULL DEFAULT 0,
        "maxAttempts" INTEGER NOT NULL DEFAULT 2,
        "idempotencyKey" TEXT,
        "lockedBy" TEXT,
        "lockedUntil" DATETIME,
        "errorCode" TEXT,
        "errorMessage" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        "startedAt" DATETIME,
        "finishedAt" DATETIME
      );
      INSERT INTO "Project" ("id", "title", "currentNodeKey", "updatedAt")
      VALUES ('legacy-project', 'Legacy', 'requirement_spec', CURRENT_TIMESTAMP);
      INSERT INTO "ConversationTurnJob" (
        "id", "projectId", "teacherMessageId", "status", "updatedAt"
      ) VALUES ('legacy-job', 'legacy-project', 'legacy-message', 'queued', CURRENT_TIMESTAMP);
    `);
    legacy.close();

    try {
      const upgraded = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
        cwd: root,
        env: { ...process.env, DATABASE_URL: legacyUrl, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
        encoding: "utf8",
      });
      expect(upgraded.status, upgraded.stderr || upgraded.stdout).toBe(0);
      const inspected = new Database(legacyPath, { readonly: true });
      const columns = inspected.prepare('PRAGMA table_info("ConversationTurnJob")').all() as Array<{ name: string }>;
      const preserved = inspected.prepare('SELECT "id", "status" FROM "ConversationTurnJob" WHERE "id" = ?').get("legacy-job");
      const leaseTable = inspected.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ProjectExecutionLease'").get();
      inspected.close();

      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
        "actorUserId",
        "actorAuthMode",
        "authSessionId",
        "fencingToken",
      ]));
      expect(preserved).toEqual({ id: "legacy-job", status: "queued" });
      expect(leaseTable).toEqual({ name: "ProjectExecutionLease" });
    } finally {
      rmSync(legacyPath, { force: true });
    }
  });
});

function createClient() {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
}

async function createProject(client: PrismaClient, label: string, ownerUserId?: string) {
  return client.project.create({
    data: {
      id: `${label}-${randomUUID()}`,
      title: label,
      currentNodeKey: "requirement_spec",
      ownerUserId,
    },
  });
}
