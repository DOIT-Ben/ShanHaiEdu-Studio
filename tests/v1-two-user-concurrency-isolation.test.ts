import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { createWorkbenchActor } from "@/server/auth/actor";
import { createPrismaWorkbenchRepository } from "@/server/workbench/repository";
import { createWorkbenchService } from "@/server/workbench/service";
import { executeRecoverableVideoTask } from "@/server/video-generation/video-generation-run";
import { FixtureAgentRuntime } from "./helpers/fixture-agent-runtime";
import { createConversationTurnService } from "@/server/conversation/conversation-turn-service";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";

const root = process.cwd();
const temporaryRoot = path.join(root, ".tmp", "v1-8-two-user");
const databasePath = path.join(temporaryRoot, `two-user-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;

let clientA: PrismaClient;
let clientB: PrismaClient;

beforeAll(() => {
  mkdirSync(temporaryRoot, { recursive: true });
  const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
    encoding: "utf8",
  });
  if (initialized.status !== 0) throw new Error(initialized.stderr || initialized.stdout || "V1-8 database initialization failed.");
  clientA = createClient();
  clientB = createClient();
});

afterAll(async () => {
  await Promise.allSettled([clientA?.$disconnect(), clientB?.$disconnect()]);
  rmSync(databasePath, { force: true });
});

describe("V1-8 two invited users concurrency and recovery", () => {
  it("keeps actor, project, intensity, lease, job, shot, budget, and artifact state isolated", async () => {
    await expect(clientB.$queryRawUnsafe<Array<{ journal_mode: string }>>("PRAGMA journal_mode")).resolves.toEqual([{ journal_mode: "wal" }]);
    const actorA = createWorkbenchActor({ userId: "teacher-v1-8-a", displayName: "Teacher A", authMode: "password" });
    const actorB = createWorkbenchActor({ userId: "teacher-v1-8-b", displayName: "Teacher B", authMode: "password" });
    const sharedRepository = createPrismaWorkbenchRepository(clientA);
    const serviceA = createWorkbenchService(sharedRepository, actorA);
    const serviceB = createWorkbenchService(sharedRepository, actorB);
    const serviceAWorker2 = createWorkbenchService(sharedRepository, actorA);
    const projectA = await serviceA.createProject({ title: "教师甲公开课" });
    const projectB = await serviceB.createProject({ title: "教师乙公开课" });

    await expect(serviceB.getProjectSnapshot(projectA.id)).rejects.toThrow(/Project not found/);
    await expect(serviceA.getProjectSnapshot(projectB.id)).rejects.toThrow(/Project not found/);

    const [leaseA, leaseB] = await Promise.all([
      serviceA.acquireProjectExecutionLease({ projectId: projectA.id, holderId: "worker-a", leaseMs: 60_000 }),
      serviceB.acquireProjectExecutionLease({ projectId: projectB.id, holderId: "worker-b", leaseMs: 60_000 }),
    ]);
    expect(leaseA).toMatchObject({ projectId: projectA.id, holderId: "worker-a", fencingToken: 1 });
    expect(leaseB).toMatchObject({ projectId: projectB.id, holderId: "worker-b", fencingToken: 1 });
    await expect(serviceAWorker2.acquireProjectExecutionLease({ projectId: projectA.id, holderId: "worker-a-2", leaseMs: 60_000 })).resolves.toBeNull();

    const [intensityA, intensityB] = await Promise.all([
      serviceA.updateProjectGenerationIntensity(projectA.id, { intensity: "enhanced", expectedVersion: 0 }),
      serviceB.updateProjectGenerationIntensity(projectB.id, { intensity: "deep", expectedVersion: 0 }),
    ]);
    expect(intensityA).toMatchObject({ generationIntensity: "enhanced", intensityVersion: 1 });
    expect(intensityB).toMatchObject({ generationIntensity: "deep", intensityVersion: 1 });

    const [sourceA, sourceB] = await Promise.all([
      approvedSource(serviceA, projectA.id, "A"),
      approvedSource(serviceB, projectB.id, "B"),
    ]);
    const [jobA, jobB] = await Promise.all([
      serviceA.createGenerationJob(projectA.id, { kind: "video", capabilityId: "video_segment_generate", sourceArtifactId: sourceA.id, unitId: "shot_01", idempotencyKey: "shot:01", inputSnapshot: { prompt: "A" } }),
      serviceB.createGenerationJob(projectB.id, { kind: "video", capabilityId: "video_segment_generate", sourceArtifactId: sourceB.id, unitId: "shot_01", idempotencyKey: "shot:01", inputSnapshot: { prompt: "B" } }),
    ]);
    await Promise.all([serviceA.startGenerationJob(projectA.id, jobA.id), serviceB.startGenerationJob(projectB.id, jobB.id)]);
    const [acceptedA, acceptedB] = await Promise.all([
      serviceA.recordGenerationProviderTask(projectA.id, jobA.id, { providerTaskId: "task-a" }),
      serviceB.recordGenerationProviderTask(projectB.id, jobB.id, { providerTaskId: "task-b" }),
    ]);
    expect(acceptedA).toMatchObject({ projectId: projectA.id, unitId: "shot_01" });
    expect(acceptedB).toMatchObject({ projectId: projectB.id, unitId: "shot_01" });
    const [persistedJobA, persistedJobB] = await Promise.all([
      clientA.generationJob.findUniqueOrThrow({ where: { id: jobA.id } }),
      clientA.generationJob.findUniqueOrThrow({ where: { id: jobB.id } }),
    ]);
    expect(persistedJobA).toMatchObject({ projectId: projectA.id, providerTaskId: "task-a" });
    expect(persistedJobB).toMatchObject({ projectId: projectB.id, providerTaskId: "task-b" });

    await Promise.all([
      serviceA.upsertVideoShots(projectA.id, shotPlan(sourceA.id)),
      serviceB.upsertVideoShots(projectB.id, shotPlan(sourceB.id)),
      serviceA.addMessage(projectA.id, { role: "assistant", content: "甲任务已进入队列。", metadata: { agentHarnessBudgetEvent: { projectMarker: "A", status: "succeeded" } } }),
      serviceB.addMessage(projectB.id, { role: "assistant", content: "乙任务已进入队列。", metadata: { agentHarnessBudgetEvent: { projectMarker: "B", status: "succeeded" } } }),
    ]);

    let submits = 0;
    let polls = 0;
    const recovered = await executeRecoverableVideoTask({
      providerTaskId: persistedJobA.providerTaskId ?? undefined,
      submit: async () => { submits += 1; return "unexpected"; },
      poll: async (taskId) => { polls += 1; return `completed:${taskId}`; },
    });
    expect(recovered).toBe("completed:task-a");
    expect({ submits, polls }).toEqual({ submits: 0, polls: 1 });

    const [snapshotA, snapshotB] = await Promise.all([serviceA.getProjectSnapshot(projectA.id), serviceB.getProjectSnapshot(projectB.id)]);
    expect(snapshotA.project).toMatchObject({ generationIntensity: "enhanced" });
    expect(snapshotB.project).toMatchObject({ generationIntensity: "deep" });
    const persistedOwners = await clientA.project.findMany({ where: { id: { in: [projectA.id, projectB.id] } }, select: { id: true, ownerUserId: true } });
    expect(persistedOwners).toEqual(expect.arrayContaining([
      { id: projectA.id, ownerUserId: actorA.userId },
      { id: projectB.id, ownerUserId: actorB.userId },
    ]));
    expect(snapshotA.generationJobs.map((job) => job.id)).toEqual([jobA.id]);
    expect(snapshotB.generationJobs.map((job) => job.id)).toEqual([jobB.id]);
    expect(snapshotA.videoShots.map((shot) => [shot.shotId, shot.sourceArtifactId])).toEqual(shotPlan(sourceA.id).shots.map((shot) => [shot.shotId, sourceA.id]));
    expect(snapshotB.videoShots.map((shot) => [shot.shotId, shot.sourceArtifactId])).toEqual(shotPlan(sourceB.id).shots.map((shot) => [shot.shotId, sourceB.id]));
    expect(JSON.stringify(snapshotA.messages)).toContain('"projectMarker":"A"');
    expect(JSON.stringify(snapshotA.messages)).not.toContain('"projectMarker":"B"');
    expect(JSON.stringify(snapshotB.messages)).toContain('"projectMarker":"B"');
    expect(JSON.stringify(snapshotB.messages)).not.toContain('"projectMarker":"A"');

    await Promise.all([
      serviceA.releaseProjectExecutionLease({ projectId: projectA.id, holderId: "worker-a", fencingToken: leaseA!.fencingToken }),
      serviceB.releaseProjectExecutionLease({ projectId: projectB.id, holderId: "worker-b", fencingToken: leaseB!.fencingToken }),
    ]);
  });

  it("keeps task grants isolated without routine pending decisions when one teacher changes direction", async () => {
    const previousEnable = process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS;
    const previousToken = process.env.COZE_API_TOKEN;
    const previousRunUrl = process.env.COZE_PPT_RUN_URL;
    process.env.SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS = "1";
    process.env.COZE_API_TOKEN = "test-token";
    process.env.COZE_PPT_RUN_URL = "https://example.invalid/coze";
    try {
      const actorA = createWorkbenchActor({ userId: `teacher-r5-a-${randomUUID()}`, displayName: "Teacher A", authMode: "password" });
      const actorB = createWorkbenchActor({ userId: `teacher-r5-b-${randomUUID()}`, displayName: "Teacher B", authMode: "password" });
      const repository = createPrismaWorkbenchRepository(clientA);
      const serviceA = createWorkbenchService(repository, actorA);
      const serviceB = createWorkbenchService(repository, actorB);
      const [projectA, projectB] = await Promise.all([
        serviceA.createProject({ title: "教师甲 PPT" }),
        serviceB.createProject({ title: "教师乙 PPT" }),
      ]);
      await Promise.all([
        approvedPptDesign(serviceA, projectA.id, "甲"),
        approvedPptDesign(serviceB, projectB.id, "乙"),
      ]);
      const providerAgent = {
        async intakeTask(input: { userMessage: string }) {
          return {
            kind: "task" as const,
            proposal: {
              goal: input.userMessage,
              requestedOutputs: ["ppt"],
              constraints: [],
              excludedOutputs: [],
            },
          };
        },
        async respond() {
          return {
            assistantMessage: { body: "PPT 任务范围已经明确。" }, state: "succeeded" as const,
            quickReplies: [], recommendedOptions: [], runtimeKind: "openai" as const,
          };
        },
      };
      const controlPlaneStore = createControlPlaneStore(clientA);
      const turnA = createConversationTurnService({ service: serviceA, runtime: new FixtureAgentRuntime(), agent: providerAgent, controlPlaneStore });
      const turnB = createConversationTurnService({ service: serviceB, runtime: new FixtureAgentRuntime(), agent: providerAgent, controlPlaneStore });

      await Promise.all([
        turnA.createTurn(projectA.id, { role: "teacher", content: "生成真实 PPTX" }),
        turnB.createTurn(projectB.id, { role: "teacher", content: "生成真实 PPTX" }),
      ]);
      await turnA.createTurn(projectA.id, { role: "teacher", content: "取消当前任务" });
      const [snapshotA, snapshotB] = await Promise.all([serviceA.getProjectSnapshot(projectA.id), serviceB.getProjectSnapshot(projectB.id)]);
      const decisionA = latestPendingDecision(snapshotA);
      const decisionB = latestPendingDecision(snapshotB);

      expect(decisionA).toBeUndefined();
      expect(decisionB).toBeUndefined();
      const taskMessageA = snapshotA.messages.find((message) => message.role === "teacher" && message.content === "生成真实 PPTX")!;
      const taskMessageB = snapshotB.messages.find((message) => message.role === "teacher" && message.content === "生成真实 PPTX")!;
      expect(taskMessageA.metadata).toMatchObject({
        taskBrief: { projectId: projectA.id, intentEpoch: 0 },
        intentGrant: { projectId: projectA.id, intentEpoch: 0, maxExternalProviderCalls: 2 },
      });
      expect(taskMessageB.metadata).toMatchObject({
        taskBrief: { projectId: projectB.id, intentEpoch: 0 },
        intentGrant: { projectId: projectB.id, intentEpoch: 0, maxExternalProviderCalls: 2 },
      });
      expect(snapshotA.project.intentEpoch).toBe(1);
      expect(snapshotB.project.intentEpoch).toBe(0);
      expect(JSON.stringify(snapshotA.messages)).not.toContain(projectB.id);
      expect(JSON.stringify(snapshotB.messages)).not.toContain(projectA.id);
    } finally {
      restoreEnv("SHANHAI_ENABLE_PROVIDER_AVAILABILITY_IN_TESTS", previousEnable);
      restoreEnv("COZE_API_TOKEN", previousToken);
      restoreEnv("COZE_PPT_RUN_URL", previousRunUrl);
    }
  });
});

function createClient() {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl, timeout: 15_000 }) });
}

async function approvedSource(service: ReturnType<typeof createWorkbenchService>, projectId: string, marker: string) {
  const artifact = await service.saveArtifact(projectId, {
    nodeKey: "video_segment_plan", kind: "video_segment_plan", title: `${marker} 分镜计划`,
    status: "needs_review", summary: `${marker} source`, markdownContent: `# ${marker}`,
  });
  return service.approveArtifact(projectId, artifact.id);
}

async function approvedPptDesign(service: ReturnType<typeof createWorkbenchService>, projectId: string, marker: string) {
  const artifact = await service.saveArtifact(projectId, {
    nodeKey: "ppt_design_draft", kind: "ppt_design_draft", title: `${marker} PPT 设计稿`,
    status: "needs_review", summary: `${marker} design`, markdownContent: `# ${marker}`,
  });
  return service.approveArtifact(projectId, artifact.id);
}

function latestPendingDecision(snapshot: Awaited<ReturnType<ReturnType<typeof createWorkbenchService>["getProjectSnapshot"]>>) {
  return [...snapshot.messages].reverse()
    .map((message) => message.metadata.pendingDecision)
    .find((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)));
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function shotPlan(sourceArtifactId: string) {
  return {
    sourceArtifactId,
    shots: [1, 2, 3].map((ordinal) => ({ shotId: `shot_0${ordinal}`, ordinal, inputHash: String(ordinal).repeat(64) })),
  };
}
