import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildSemanticContextSnapshot } from "@/server/conversation/context-semantic-snapshot";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { persistPendingDecisionStatus } from "@/server/conversation/pending-decision-lifecycle";
import { createTaskBrief, type IntentGrant, type PendingDecision } from "@/server/conversation/task-contract";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService } from "@/server/workbench/service";

const root = process.cwd();
const stageRoot = path.join(root, ".tmp", "pending-decision-atomic-tests");
const databasePath = path.join(stageRoot, `pending-decision-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;
let client: PrismaClient;

beforeAll(() => {
  mkdirSync(stageRoot, { recursive: true });
  const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
    encoding: "utf8",
  });
  if (initialized.status !== 0) {
    throw new Error(initialized.stderr || initialized.stdout || "PendingDecision test database initialization failed.");
  }
  client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
});

afterAll(async () => {
  await client?.$disconnect();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${databasePath}${suffix}`, { force: true });
});

describe("PendingDecision atomic persistence", () => {
  it("rolls back the aggregate, messages and event when the semantic snapshot write fails", async () => {
    const fixture = await createPendingFixture("原子回滚");
    const { service, store, project, taskBrief, decision, pendingMessage, triggerMessage,
      initialSnapshot, confirmedGrant, activeAggregate } = fixture;
    const failingStore = {
      ...createControlPlaneStore(failSemanticSnapshotUpsert(client)),
      saveSemanticSnapshot: async () => {
        throw new Error("injected semantic snapshot failure");
      },
    };

    await expect(persistPendingDecisionStatus({
      service,
      controlPlaneStore: failingStore as never,
      projectId: project.id,
      triggerMessage: {
        ...triggerMessage,
        metadata: { ...triggerMessage.metadata, taskBrief, intentGrant: confirmedGrant },
      },
      taskBrief,
      aggregate: activeAggregate,
      previousSnapshot: initialSnapshot,
      decision,
      status: "confirmed",
    })).rejects.toThrow("injected semantic snapshot failure");

    const messages = await service.getMessages(project.id);
    expect(decisionStatus(messages.find((message) => message.id === pendingMessage.id)?.metadata)).toBe("pending");
    expect(decisionStatus(messages.find((message) => message.id === triggerMessage.id)?.metadata)).toBeUndefined();
    expect(messages.find((message) => message.id === triggerMessage.id)?.metadata.intentGrant).toBeUndefined();
    expect(await store.getTaskAggregate(project.id, 0)).toMatchObject({
      status: "paused_recovery",
      intentGrant: { maxCostCredits: null },
      plan: { status: "paused_recovery" },
    });
    expect((await store.listEvents(project.id)).some((event) => event.payload.actionId === decision.actionId)).toBe(false);
    expect(await store.getLatestSemanticSnapshot({
      projectId: project.id,
      taskId: taskBrief.taskId,
      intentEpoch: 0,
      maxPlanRevision: 0,
    })).toMatchObject({ snapshot: { pendingDecision: { status: "pending" }, plan: { status: "paused_recovery" } } });
  });

  it("reuses the same action event and rejects a conflicting terminal replay", async () => {
    const fixture = await createPendingFixture("幂等重放");
    const input = pendingCommitInput(fixture, "confirmed");
    const first = await persistPendingDecisionStatus(input);
    const replay = await persistPendingDecisionStatus(input);

    expect(replay.sequence).toBe(first.sequence);
    const actionEvents = (await fixture.store.listEvents(fixture.project.id))
      .filter((event) => event.payload.actionId === fixture.decision.actionId);
    expect(actionEvents).toHaveLength(1);
    await expect(persistPendingDecisionStatus(pendingCommitInput(fixture, "canceled")))
      .rejects.toThrow("conflicting payload");
    const messages = await fixture.service.getMessages(fixture.project.id);
    expect(decisionStatus(messages.find((message) => message.id === fixture.pendingMessage.id)?.metadata))
      .toBe("confirmed");
    expect((await fixture.store.listEvents(fixture.project.id))
      .filter((event) => event.payload.actionId === fixture.decision.actionId)).toHaveLength(1);
  });
});

async function createPendingFixture(label: string) {
  const service = createWorkbenchService(createPrismaWorkbenchRepository(client));
  const store = createControlPlaneStore(client);
  const project = await service.createProject({ title: `PendingDecision${label}` });
  const source = await service.addMessage(project.id, { role: "teacher", content: "只做需求规格" });
  const taskBrief = createTaskBrief({
    taskId: `task:${source.id}`,
    projectId: project.id,
    intentEpoch: 0,
    goal: source.content,
    requestedOutputs: ["requirement_spec"],
    constraints: [],
    excludedOutputs: ["lesson_plan", "ppt", "video", "package"],
    generationIntensity: "standard",
    sourceMessageId: source.id,
  });
  const grant = intentGrant(taskBrief.taskId, project.id);
  const plan = { planId: `plan:${taskBrief.taskId}`, revision: 0, status: "paused_recovery" };
  const decision = pendingDecision(taskBrief.taskId, project.id, plan.planId, grant);
  const pendingMessage = await service.addMessage(project.id, {
    role: "assistant",
    content: decision.question,
    metadata: { pendingDecision: decision },
  });
  const triggerMessage = await service.addMessage(project.id, {
    role: "teacher",
    content: "确认继续",
    metadata: { confirmedActionId: decision.actionId },
  });
  const initialSnapshot = buildSemanticContextSnapshot({
    taskBrief,
    plan,
    pendingDecision: decision,
    trustedArtifactRefs: [],
    observationRefs: [],
    recentMessages: [{ role: "teacher", content: source.content }],
  });
  await store.upsertTaskAggregate({ taskBrief, intentGrant: grant, plan, status: plan.status, checkpoint: null });
  await store.saveSemanticSnapshot(initialSnapshot, 0);
  const confirmedGrant = { ...grant, maxCostCredits: 20 };
  const activeAggregate = {
    taskBrief,
    intentGrant: confirmedGrant,
    plan: { ...plan, status: "active" },
    status: "active",
    checkpoint: null,
  };
  return {
    service, store, project, taskBrief, grant, decision, pendingMessage, triggerMessage,
    initialSnapshot, confirmedGrant, activeAggregate,
  };
}

function pendingCommitInput(
  fixture: Awaited<ReturnType<typeof createPendingFixture>>,
  status: "confirmed" | "canceled",
) {
  return {
    service: fixture.service,
    controlPlaneStore: fixture.store,
    projectId: fixture.project.id,
    triggerMessage: {
      ...fixture.triggerMessage,
      metadata: {
        ...fixture.triggerMessage.metadata,
        taskBrief: fixture.taskBrief,
        intentGrant: fixture.confirmedGrant,
      },
    },
    taskBrief: fixture.taskBrief,
    aggregate: fixture.activeAggregate,
    previousSnapshot: fixture.initialSnapshot,
    decision: fixture.decision,
    status,
  } as const;
}

function failSemanticSnapshotUpsert(base: PrismaClient): PrismaClient {
  return new Proxy(base, {
    get(target, property) {
      if (property !== "$transaction") return bindProperty(target, property);
      return async (callback: (transaction: object) => unknown) => target.$transaction(async (transaction) =>
        callback(new Proxy(transaction, {
          get(transactionTarget, transactionProperty) {
            if (transactionProperty !== "semanticContextSnapshotRecord") {
              return bindProperty(transactionTarget, transactionProperty);
            }
            return new Proxy(transactionTarget.semanticContextSnapshotRecord, {
              get(delegate, delegateProperty) {
                if (delegateProperty === "upsert") {
                  return async () => { throw new Error("injected semantic snapshot failure"); };
                }
                return bindProperty(delegate, delegateProperty);
              },
            });
          },
        })),
      );
    },
  });
}

function bindProperty(target: object, property: PropertyKey) {
  const value = Reflect.get(target, property);
  return typeof value === "function" ? value.bind(target) : value;
}

function intentGrant(taskId: string, projectId: string): IntentGrant {
  return {
    schemaVersion: "intent-grant.v1",
    taskId,
    projectId,
    intentEpoch: 0,
    standardWorkAuthorized: true,
    intensity: "standard",
    budgetPolicyVersion: "standard.v1",
    maxCostCredits: null,
    maxExternalProviderCalls: 2,
    requiredCheckpoints: [],
    expiresAt: null,
  };
}

function pendingDecision(taskId: string, projectId: string, planId: string, grant: IntentGrant): PendingDecision {
  return {
    schemaVersion: "pending-decision.v1",
    decisionId: `decision:${randomUUID()}`,
    status: "pending",
    kind: "budget_disclosure",
    reasonCode: "budget_not_disclosed",
    question: "是否确认费用范围？",
    impactSummary: "确认前不会发起付费生成。",
    options: [
      { id: "confirm", label: "确认继续", recommended: true },
      { id: "cancel", label: "暂不继续", recommended: false },
    ],
    actorUserId: "teacher-1",
    projectId,
    taskId,
    intentEpoch: 0,
    planId,
    actionId: `action:${randomUUID()}`,
    budgetPolicyVersion: grant.budgetPolicyVersion,
    maxCostCredits: grant.maxCostCredits,
    maxExternalProviderCalls: grant.maxExternalProviderCalls,
    expiresAt: null,
  };
}

function decisionStatus(metadata?: Record<string, unknown>) {
  const value = metadata?.pendingDecision;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).status
    : undefined;
}
