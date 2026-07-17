import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  Usage,
  getGlobalTraceProvider,
  setTracingDisabled,
  type Model,
  type ModelRequest,
  type ModelResponse,
} from "@openai/agents";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { createAgentsSdkRuntimeAbAdapter } from "@/server/runtime-ab/agents-sdk-adapter";
import { evaluateRuntimeAbRun } from "@/server/runtime-ab/evaluator";
import { createEnvelopeBoundRuntimeAbGateway } from "@/server/runtime-ab/gateway";
import { runRuntimeAbEvaluation } from "@/server/runtime-ab/orchestrator";
import { createResponsesRuntimeAbAdapter } from "@/server/runtime-ab/responses-adapter";
import { createSqliteRuntimeAbCheckpointStore } from "@/server/runtime-ab/sqlite-checkpoint-store";
import type {
  RuntimeAbAdapter,
  RuntimeAbCheckpointStore,
  RuntimeAbResponsesClient,
  RuntimeAbRunInput,
  RuntimeAbToolExecutionOutcome,
} from "@/server/runtime-ab/types";

const fixtureRoot = path.resolve(".tmp", "runtime-ab-a11-a12");
const openStores: Array<{ close(): void }> = [];

afterEach(async () => {
  while (openStores.length) openStores.pop()!.close();
  await rm(fixtureRoot, { recursive: true, force: true });
  setTracingDisabled(false);
});

describe("A11/A12 common Runtime A/B Orchestrator", () => {
  it("AB-01 rejects multiple function calls before either transport can execute a Tool", async () => {
    const brief = taskBrief(["requirement_spec"]);
    const execute = vi.fn(async () => succeeded("requirement_spec"));
    const responses = createResponsesRuntimeAbAdapter({ client: responsesClient([
      toolDecision("call-a", "create_requirement_spec", { revision: "a" }),
      toolDecision("call-b", "create_requirement_spec", { revision: "b" }),
    ]) });
    const agentsSdk = createAgentsSdkRuntimeAbAdapter({ model: agentsModel([
      toolDecision("call-a", "create_requirement_spec", { revision: "a" }),
      toolDecision("call-b", "create_requirement_spec", { revision: "b" }),
    ]) });

    for (const adapter of [responses, agentsSdk]) {
      const store = await sqliteStore();
      const result = await runRuntimeAbEvaluation(adapter, runInput(brief, execute, store));
      expect(result).toMatchObject({ status: "paused", reasonCode: "multiple_tool_calls_blocked", requestCount: 1 });
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("AB-02 persists a failed Observation and lets the common Orchestrator request a repaired decision", async () => {
    const brief = taskBrief(["requirement_spec"]);
    const store = await sqliteStore();
    const client = scriptedResponsesClient([
      [toolDecision("initial", "create_requirement_spec", { revision: "bad" })],
      [toolDecision("repair", "create_requirement_spec", { revision: "fixed" })],
      [],
    ]);
    const execute = vi.fn<() => Promise<RuntimeAbToolExecutionOutcome>>()
      .mockResolvedValueOnce({ status: "failed", reasonCode: "offline_validation_failed", summary: "repair input" })
      .mockResolvedValueOnce(succeeded("requirement_spec"));

    const result = await runRuntimeAbEvaluation(
      createResponsesRuntimeAbAdapter({ client }),
      runInput(brief, execute, store),
    );

    expect(result).toMatchObject({ status: "completed", requestCount: 3 });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(result.checkpoint.observations.map((item) => item.status)).toEqual(["failed", "succeeded"]);
    expect(client.responses.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      observations: [expect.objectContaining({ reasonCode: "offline_validation_failed" })],
    }));
  });

  it("AB-03 binds committed calls and never re-executes an identical call restored from checkpoint", async () => {
    const brief = taskBrief(["requirement_spec"]);
    const store = await sqliteStore();
    const execute = vi.fn(async () => succeeded("requirement_spec"));
    const first = await runRuntimeAbEvaluation(
      createResponsesRuntimeAbAdapter({ client: scriptedResponsesClient([
        [toolDecision("first", "create_requirement_spec", { revision: "same" })],
        [],
      ]) }),
      runInput(brief, execute, store),
    );
    const committed = first.checkpoint.observations[0];

    expect(committed).toMatchObject({
      callId: "first",
      toolName: "create_requirement_spec",
      status: "succeeded",
    });
    expect(committed.callDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(committed.argumentsDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(committed.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);

    const resumed = await runRuntimeAbEvaluation(
      createResponsesRuntimeAbAdapter({ client: responsesClient([
        toolDecision("replayed", "create_requirement_spec", { revision: "same" }),
      ]) }),
      runInput(brief, execute, store),
    );

    expect(resumed).toMatchObject({ status: "paused", reasonCode: "duplicate_tool_call" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("AB-04 rejects a fake persistence callback and reads the real SQLite checkpoint before the next turn", async () => {
    const brief = taskBrief(["requirement_spec"]);
    const client = scriptedResponsesClient([
      [toolDecision("stored", "create_requirement_spec", { revision: "stored" })],
      [],
    ]);
    const adapter = createResponsesRuntimeAbAdapter({ client });
    const execute = vi.fn(async () => succeeded("requirement_spec"));

    await expect(runRuntimeAbEvaluation(adapter, {
      ...runInput(brief, execute, undefined as never),
      checkpointStore: undefined,
      onObservation: async () => undefined,
    } as never)).rejects.toThrow(/durable checkpoint store/i);
    expect(client.responses.create).not.toHaveBeenCalled();

    const store = await sqliteStore();
    const load = vi.spyOn(store, "load");
    await expect(runRuntimeAbEvaluation(adapter, runInput(brief, execute, store))).resolves.toMatchObject({ status: "completed" });
    expect(load.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect((await store.load(scopeFor(brief)))?.observations).toHaveLength(1);

    store.close();
    openStores.splice(openStores.indexOf(store), 1);
    const reopened = createSqliteRuntimeAbCheckpointStore({ databasePath: store.databasePath });
    openStores.push(reopened);
    expect((await reopened.load(scopeFor(brief)))?.observations[0]).toMatchObject({ callId: "stored", status: "succeeded" });
  });

  it("AB-05 accepts only completed output contracts and permits same-Tool repairs with different arguments", async () => {
    const brief = taskBrief(["requirement_spec"]);
    const store = await sqliteStore();
    const result = await runRuntimeAbEvaluation(
      createResponsesRuntimeAbAdapter({ client: scriptedResponsesClient([
        [toolDecision("draft", "create_requirement_spec", { revision: "one" })],
        [toolDecision("repair", "create_requirement_spec", { revision: "two" })],
        [],
      ]) }),
      runInput(brief, async () => succeeded("requirement_spec"), store),
    );

    expect(result.trace.map((entry) => entry.toolName)).toEqual([
      "create_requirement_spec",
      "create_requirement_spec",
    ]);
    expect(evaluateRuntimeAbRun(result, brief)).toMatchObject({ accepted: true, reasonCodes: [] });
    expect(evaluateRuntimeAbRun({ ...result, status: "paused", reasonCode: "manual_pause" }, brief)).toMatchObject({
      accepted: false,
      reasonCodes: expect.arrayContaining(["runtime_not_completed"]),
    });
    expect(evaluateRuntimeAbRun({
      ...result,
      checkpoint: { ...result.checkpoint, observations: [] },
    }, brief)).toMatchObject({
      accepted: false,
      reasonCodes: expect.arrayContaining(["missing_output:requirement_spec"]),
    });
  });

  it("AB-06 leaves global tracing unchanged and hard-rejects a production-eligible A/B profile", async () => {
    setTracingDisabled(false);
    const adapter = createAgentsSdkRuntimeAbAdapter({ model: agentsModel([]) });
    expect(getGlobalTraceProvider().createTrace({ name: "runtime-ab-global-tracing-check" }).toJSON()).not.toBeNull();

    const forged = {
      ...adapter,
      profile: { ...adapter.profile, productionEligible: true },
    } as unknown as RuntimeAbAdapter;
    const brief = taskBrief(["requirement_spec"]);
    const store = await sqliteStore();
    await expect(runRuntimeAbEvaluation(forged, runInput(brief, async () => succeeded("requirement_spec"), store)))
      .rejects.toThrow(/production eligible/i);
  });
});

function taskBrief(requestedOutputs: string[]) {
  return createTaskBrief({
    taskId: "task-runtime-ab-a11-a12",
    projectId: "project-runtime-ab-a11-a12",
    intentEpoch: 2,
    goal: "形成一句话PPT结构候选",
    requestedOutputs,
    constraints: ["offline fixture only"],
    excludedOutputs: ["image", "video", "package"],
    generationIntensity: "standard",
    sourceMessageId: "message-runtime-ab-a11-a12",
  });
}

function grant(brief: ReturnType<typeof taskBrief>): IntentGrant {
  return {
    schemaVersion: "intent-grant.v1",
    taskId: brief.taskId,
    projectId: brief.projectId,
    intentEpoch: brief.intentEpoch,
    standardWorkAuthorized: true,
    intensity: brief.generationIntensity,
    budgetPolicyVersion: "offline-runtime-ab-a11-a12.v1",
    maxCostCredits: 0,
    maxExternalProviderCalls: 0,
    requiredCheckpoints: [],
    expiresAt: null,
  };
}

function runInput(
  brief: ReturnType<typeof taskBrief>,
  execute: (input: unknown) => Promise<RuntimeAbToolExecutionOutcome> | RuntimeAbToolExecutionOutcome,
  checkpointStore: RuntimeAbCheckpointStore,
): RuntimeAbRunInput {
  const intentGrant = grant(brief);
  return {
    taskBrief: brief,
    intentGrant,
    planRevision: 4,
    gateway: createEnvelopeBoundRuntimeAbGateway({
      actorUserId: "teacher-a",
      taskBrief: brief,
      intentGrant,
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
      execute: execute as never,
    }),
    checkpointStore,
  };
}

async function sqliteStore() {
  await mkdir(fixtureRoot, { recursive: true });
  const store = createSqliteRuntimeAbCheckpointStore({
    databasePath: path.join(fixtureRoot, `${randomUUID()}.db`),
  });
  openStores.push(store);
  return store;
}

function scopeFor(brief: ReturnType<typeof taskBrief>) {
  return {
    projectId: brief.projectId,
    taskId: brief.taskId,
    intentEpoch: brief.intentEpoch,
    planRevision: 4,
  };
}

function succeeded(output: string): RuntimeAbToolExecutionOutcome {
  return { status: "succeeded", producedOutputs: [output], summary: `${output} completed` };
}

function toolDecision(callId: string, name: string, argumentsValue: Record<string, unknown>) {
  return { type: "function_call" as const, callId, name, arguments: JSON.stringify(argumentsValue), status: "completed" as const };
}

function responsesClient(calls: ReturnType<typeof toolDecision>[]): RuntimeAbResponsesClient {
  return scriptedResponsesClient([calls]);
}

function scriptedResponsesClient(turns: Array<Array<ReturnType<typeof toolDecision>>>): RuntimeAbResponsesClient & {
  responses: { create: ReturnType<typeof vi.fn> };
} {
  let turn = 0;
  const create = vi.fn(async () => {
    const calls = turns[turn++] ?? [];
    return {
      output_text: calls.length === 0 ? "completed" : "",
      output: calls.map((call) => ({
        type: call.type,
        call_id: call.callId,
        name: call.name,
        arguments: call.arguments,
      })),
    };
  });
  return { responses: { create } };
}

function agentsModel(calls: ReturnType<typeof toolDecision>[]): Model {
  return {
    async getResponse(_request: ModelRequest): Promise<ModelResponse> {
      return {
        usage: new Usage({ requests: 0 }),
        output: calls,
      };
    },
    async *getStreamedResponse() {
      throw new Error("A11/A12 fixture does not stream.");
    },
  };
}
