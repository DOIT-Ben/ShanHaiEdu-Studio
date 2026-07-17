import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { createAgentsSdkRuntimeAbAdapter } from "@/server/runtime-ab/agents-sdk-adapter";
import { evaluateRuntimeAbRun } from "@/server/runtime-ab/evaluator";
import { createEnvelopeBoundRuntimeAbGateway } from "@/server/runtime-ab/gateway";
import { runRuntimeAbEvaluation } from "@/server/runtime-ab/orchestrator";
import { createResponsesRuntimeAbAdapter } from "@/server/runtime-ab/responses-adapter";
import { createSqliteRuntimeAbCheckpointStore } from "@/server/runtime-ab/sqlite-checkpoint-store";
import {
  createRuntimeAbCallBinding,
  createRuntimeAbCheckpoint,
  type RuntimeAbCheckpoint,
  type RuntimeAbToolName,
} from "@/server/runtime-ab/types";
import { projectRuntimeAbToolDefinitions } from "@/server/runtime-ab/tool-projection";
import { createOfflineRuntimeAbFixture } from "./offline-runtime-ab-fixture";

const fixtureRoot = path.resolve(".tmp", "runtime-ab-isolation");
const stores: Array<ReturnType<typeof createSqliteRuntimeAbCheckpointStore>> = [];

afterEach(async () => {
  while (stores.length) stores.pop()!.close();
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe("isolated Responses Runtime and OpenAI Agents SDK A/B", () => {
  it("lets both transports form a dynamic three-tool trace through one Orchestrator and Envelope Gateway", async () => {
    const brief = taskBrief("为五年级百分数公开课形成一句话PPT结构候选");
    const responses = await runOffline("responses", brief);
    const sdk = await runOffline("agents_sdk", brief);
    const candidateToolNames = projectRuntimeAbToolDefinitions().map((tool) => tool.name);

    for (const experiment of [responses, sdk]) {
      expect(experiment.result.status, JSON.stringify(experiment.result)).toBe("completed");
      expect(new Set(experiment.result.trace.map((entry) => entry.toolName))).toEqual(new Set(candidateToolNames));
      expect(experiment.fixture.executionRecords).toHaveLength(3);
      expect(experiment.fixture.executionRecords.every((record) => /^[a-f0-9]{64}$/.test(record.idempotencyKey))).toBe(true);
      expect(experiment.fixture.externalProviderCalls).toBe(0);
    }
    expect(evaluateRuntimeAbRun(responses.result, brief)).toMatchObject({ accepted: true, fixedOrderRequired: false });
    expect(evaluateRuntimeAbRun(sdk.result, brief)).toMatchObject({ accepted: true, fixedOrderRequired: false });

    const alternate = await runOffline("responses", taskBrief("围绕百分数做一个可继续加工的PPT候选版本二甲"));
    expect(alternate.result.trace.map((entry) => entry.toolName)).not.toEqual(
      responses.result.trace.map((entry) => entry.toolName),
    );
  });

  it("keeps the real Agents SDK model transport in the evaluation-only isolation profile", async () => {
    const experiment = await runOffline("agents_sdk", taskBrief("生成百分数PPT结构候选"));

    expect(experiment.result).toMatchObject({
      runtimeKind: "agents_sdk",
      adoptionStatus: "evaluation_only",
      productionEligible: false,
      isolation: {
        tracing: false,
        retries: 0,
        maxFunctionToolConcurrency: 1,
        maxTurns: 6,
        session: false,
        handoffs: false,
        websocket: false,
        sdkOwnsBusinessState: false,
      },
    });
    expect(experiment.result.requestCount).toBeLessThanOrEqual(6);
  });

  it("restores caller-owned committed observations without re-executing completed work", async () => {
    const brief = taskBrief("生成百分数PPT结构候选");
    const existingCall = {
      callId: "offline-existing-call",
      toolName: "create_requirement_spec",
      arguments: { projectId: brief.projectId, userInstruction: brief.goal },
    };
    const checkpoint: RuntimeAbCheckpoint = createRuntimeAbCheckpoint({
      taskBrief: brief,
      intentGrant: intentGrant(brief),
      planRevision: 4,
      toolDefinitions: projectRuntimeAbToolDefinitions(),
      observations: [{
        observationId: "offline-existing-requirement",
        callId: existingCall.callId,
        toolName: existingCall.toolName,
        ...createRuntimeAbCallBinding(existingCall),
        idempotencyKey: "a".repeat(64),
        status: "succeeded",
        producedOutputs: ["requirement_spec"],
        summary: "Existing caller-owned observation",
      }],
    });

    for (const runtimeKind of ["responses", "agents_sdk"] as const) {
      const experiment = await runOffline(runtimeKind, brief, checkpoint);
      expect(experiment.result.status, `${runtimeKind}: ${JSON.stringify(experiment.result)}`).toBe("completed");
      expect(experiment.fixture.executionRecords.map((record) => record.toolName)).not.toContain("create_requirement_spec");
      expect(experiment.result.checkpoint.observations).toEqual(expect.arrayContaining(checkpoint.observations));
    }
  });

  it("fails closed at the Gateway and does not dispatch when the current plan revision is stale", async () => {
    const brief = taskBrief("生成百分数PPT结构候选");
    const fixture = createOfflineRuntimeAbFixture(brief);
    const execute = vi.fn(fixture.execute);
    const gateway = createEnvelopeBoundRuntimeAbGateway({
      actorUserId: "teacher-a",
      taskBrief: brief,
      intentGrant: intentGrant(brief),
      planRevision: 4,
      getCurrentScope: () => ({
        actorUserId: "teacher-a",
        projectId: brief.projectId,
        taskId: brief.taskId,
        intentEpoch: brief.intentEpoch,
        planRevision: 5,
        intensity: brief.generationIntensity,
        taskBriefDigest: brief.digest,
      }),
      execute,
    });

    const observation = await gateway.execute({
      callId: "stale-call",
      toolName: "create_requirement_spec",
      arguments: { taskBriefDigest: brief.digest },
    });

    expect(observation).toMatchObject({ status: "failed", reasonCode: "execution_plan_revision_mismatch" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("stops on an identical committed call and returns a durable recovery checkpoint", async () => {
    const brief = taskBrief("生成百分数PPT结构候选");
    const fixture = createOfflineRuntimeAbFixture(brief);
    const client = {
      responses: {
        create: vi.fn(async () => ({
          output_text: "",
          output: [{
            type: "function_call" as const,
            call_id: "repeated-call",
            name: "create_requirement_spec" as RuntimeAbToolName,
            arguments: JSON.stringify({ projectId: brief.projectId }),
          }],
        })),
      },
    };
    const store = await createStore();
    const input = runInput(brief, fixture.execute, store);
    const adapter = createResponsesRuntimeAbAdapter({ client });
    const first = await runRuntimeAbEvaluation(adapter, input);
    expect(first).toMatchObject({ status: "paused", reasonCode: "duplicate_tool_call" });
    expect(client.responses.create).toHaveBeenCalledTimes(2);
    expect(fixture.executionRecords).toHaveLength(1);
    expect(first.checkpoint.observations).toHaveLength(1);

    const resumed = await runRuntimeAbEvaluation(adapter, input);
    expect(resumed).toMatchObject({ status: "paused", reasonCode: "duplicate_tool_call" });
    expect(fixture.executionRecords).toHaveLength(1);
  });
});

async function runOffline(
  runtimeKind: "responses" | "agents_sdk",
  brief: ReturnType<typeof taskBrief>,
  checkpoint?: RuntimeAbCheckpoint,
) {
  const fixture = createOfflineRuntimeAbFixture(brief);
  const adapter = runtimeKind === "responses"
    ? createResponsesRuntimeAbAdapter({ client: fixture.responsesClient })
    : createAgentsSdkRuntimeAbAdapter({ model: fixture.agentsModel });
  const store = await createStore();
  if (checkpoint) await store.save(checkpoint);
  const result = await runRuntimeAbEvaluation(adapter, runInput(brief, fixture.execute, store));
  return { fixture, result };
}

function runInput(
  brief: ReturnType<typeof taskBrief>,
  execute: ReturnType<typeof createOfflineRuntimeAbFixture>["execute"],
  checkpointStore: ReturnType<typeof createSqliteRuntimeAbCheckpointStore>,
) {
  return {
    taskBrief: brief,
    intentGrant: intentGrant(brief),
    planRevision: 4,
    gateway: gatewayFor(brief, execute),
    checkpointStore,
  };
}

function gatewayFor(
  brief: ReturnType<typeof taskBrief>,
  execute: ReturnType<typeof createOfflineRuntimeAbFixture>["execute"],
) {
  return createEnvelopeBoundRuntimeAbGateway({
    actorUserId: "teacher-a",
    taskBrief: brief,
    intentGrant: intentGrant(brief),
    planRevision: 4,
    getCurrentScope: () => ({
      actorUserId: "teacher-a",
      projectId: brief.projectId,
      taskId: brief.taskId,
      intentEpoch: brief.intentEpoch,
      planRevision: 4,
      intensity: brief.generationIntensity,
      taskBriefDigest: brief.digest,
    }),
    execute,
  });
}

async function createStore() {
  await mkdir(fixtureRoot, { recursive: true });
  const store = createSqliteRuntimeAbCheckpointStore({
    databasePath: path.join(fixtureRoot, `${randomUUID()}.db`),
  });
  stores.push(store);
  return store;
}

function taskBrief(goal: string) {
  return createTaskBrief({
    taskId: "task-runtime-ab",
    projectId: "project-runtime-ab",
    intentEpoch: 3,
    goal,
    requestedOutputs: ["requirement_spec", "lesson_plan", "ppt_outline"],
    constraints: ["offline fixture only"],
    excludedOutputs: ["pptx", "image", "video", "zip"],
    generationIntensity: "standard",
    sourceMessageId: "message-runtime-ab",
  });
}

function intentGrant(brief: ReturnType<typeof taskBrief>): IntentGrant {
  return {
    schemaVersion: "intent-grant.v1",
    taskId: brief.taskId,
    projectId: brief.projectId,
    intentEpoch: brief.intentEpoch,
    standardWorkAuthorized: true,
    intensity: brief.generationIntensity,
    budgetPolicyVersion: "offline-runtime-ab.v1",
    maxCostCredits: 0,
    maxExternalProviderCalls: 0,
    requiredCheckpoints: [],
    expiresAt: null,
  };
}
