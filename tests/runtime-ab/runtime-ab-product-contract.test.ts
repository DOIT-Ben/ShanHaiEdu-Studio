import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Usage, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runOrchestratedTurn } from "@/server/conversation/orchestrator-runtime";
import { createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { createAgentsSdkRuntimeAbAdapter } from "@/server/runtime-ab/agents-sdk-adapter";
import { createEnvelopeBoundRuntimeAbGateway } from "@/server/runtime-ab/gateway";
import { runRuntimeAbEvaluation } from "@/server/runtime-ab/orchestrator";
import { createLedgerBoundRuntimeAbAdapter } from "@/server/runtime-ab/provider-factory";
import { createResponsesRuntimeAbAdapter } from "@/server/runtime-ab/responses-adapter";
import { createSqliteRuntimeAbCheckpointStore } from "@/server/runtime-ab/sqlite-checkpoint-store";
import {
  createRuntimeAbCheckpoint,
  restoreRuntimeAbCheckpoint,
  type RuntimeAbObservation,
  type RuntimeAbToolName,
} from "@/server/runtime-ab/types";
import { projectRuntimeAbToolDefinitions } from "@/server/runtime-ab/tool-projection";
import { resolveMainAgentToolDefinition } from "@/server/tools/main-agent-tool-registry";
import { createOfflineRuntimeAbFixture } from "./offline-runtime-ab-fixture";

const fixtureRoot = path.resolve(".tmp", "runtime-ab-product-contract");
const stores: Array<ReturnType<typeof createSqliteRuntimeAbCheckpointStore>> = [];

afterEach(async () => {
  while (stores.length) stores.pop()!.close();
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe("Runtime A/B product contract", () => {
  it("projects the complete three-tool contract from the production MainAgentToolRegistry", () => {
    const projected = projectRuntimeAbToolDefinitions();

    expect(projected.map((tool) => tool.name)).toEqual([
      "create_lesson_plan",
      "create_ppt_outline",
      "create_requirement_spec",
    ]);
    for (const tool of projected) {
      const production = resolveMainAgentToolDefinition(tool.name);
      expect(tool).toEqual({
        type: "function",
        name: production.transportName,
        description: production.description,
        parameters: production.inputSchema,
        strict: true,
      });
    }
  });

  it("runs both single-turn transports under the common runOrchestratedTurn owner", async () => {
    const brief = taskBrief();
    const fixture = createOfflineRuntimeAbFixture(brief);
    const adapters = [
      createResponsesRuntimeAbAdapter({ client: fixture.responsesClient }),
      createAgentsSdkRuntimeAbAdapter({ model: fixture.agentsModel }),
    ];

    for (const adapter of adapters) {
      const runInput = await inputFor(brief, fixture.execute);
      const result = await runOrchestratedTurn({
        selectAndRun: () => runRuntimeAbEvaluation(adapter, runInput),
      });
      expect(result.status).toBe("completed");
    }
  });

  it("binds the checkpoint to task, revision, intensity, grant, tool set and its own digest", () => {
    const brief = taskBrief();
    const intentGrant = grant(brief);
    const tools = projectRuntimeAbToolDefinitions();
    const checkpoint = createRuntimeAbCheckpoint({
      taskBrief: brief,
      intentGrant,
      planRevision: 4,
      toolDefinitions: tools,
      observations: [],
    });

    expect(checkpoint).toMatchObject({
      schemaVersion: "runtime-ab-checkpoint.v3",
      projectId: brief.projectId,
      taskId: brief.taskId,
      intentEpoch: brief.intentEpoch,
      planRevision: 4,
      intensity: brief.generationIntensity,
      taskBriefDigest: brief.digest,
      currentToolSet: tools.map((tool) => tool.name),
    });
    expect(checkpoint.intentGrantDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(checkpoint.checkpointDigest).toMatch(/^[a-f0-9]{64}$/);

    expect(() => restoreRuntimeAbCheckpoint({
      checkpoint,
      taskBrief: brief,
      intentGrant,
      planRevision: 5,
      toolDefinitions: tools,
    })).toThrowError(/plan revision/i);
    expect(() => restoreRuntimeAbCheckpoint({
      checkpoint: { ...checkpoint, checkpointDigest: "0".repeat(64) },
      taskBrief: brief,
      intentGrant,
      planRevision: 4,
      toolDefinitions: tools,
    })).toThrowError(/digest/i);
  });

  it("requires a durable Store and confirms Observation persistence before the next model turn", async () => {
    const brief = taskBrief();
    const fixture = createOfflineRuntimeAbFixture(brief);
    const adapter = createResponsesRuntimeAbAdapter({ client: fixture.responsesClient });
    const completeInput = await inputFor(brief, fixture.execute);

    await expect(runRuntimeAbEvaluation(adapter, {
      ...completeInput,
      checkpointStore: undefined,
      onObservation: async () => undefined,
    } as never)).rejects.toThrowError(/durable checkpoint store/i);

    const load = vi.spyOn(completeInput.checkpointStore, "load");
    await expect(runRuntimeAbEvaluation(adapter, completeInput)).resolves.toMatchObject({ status: "completed" });
    expect(load.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("uses caller checkpoint ownership to fuse an identical SDK repeat before a third model request", async () => {
    const brief = taskBrief();
    const fixture = createOfflineRuntimeAbFixture(brief);
    const repeatingModel = repeatedAgentsModel("create_requirement_spec", brief);
    const result = await runRuntimeAbEvaluation(
      createAgentsSdkRuntimeAbAdapter({ model: repeatingModel.model }),
      await inputFor(brief, fixture.execute),
    );

    expect(result).toMatchObject({
      status: "paused",
      reasonCode: "duplicate_tool_call",
      adoptionStatus: "evaluation_only",
      productionEligible: false,
    });
    expect(repeatingModel.requests()).toBe(2);
    expect(fixture.executionRecords).toHaveLength(1);
  });

  it("returns a failed SDK Tool Observation to the common Orchestrator for repaired input", async () => {
    const brief = taskBrief();
    const fixture = createOfflineRuntimeAbFixture(brief, { failFirstTool: "create_requirement_spec" });
    const repairingModel = repairingAgentsModel(brief);
    const result = await runRuntimeAbEvaluation(
      createAgentsSdkRuntimeAbAdapter({ model: repairingModel.model }),
      await inputFor(brief, fixture.execute),
    );

    expect(result).toMatchObject({ status: "completed", adoptionStatus: "evaluation_only" });
    expect(repairingModel.requests()).toBeGreaterThan(1);
    expect(result.checkpoint.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "failed", reasonCode: "offline_tool_failure" }),
      expect.objectContaining({ status: "succeeded", toolName: "create_requirement_spec" }),
    ]));
  });

  it("constructs ledger-bound evaluation adapters without making a Provider request or enabling production", async () => {
    await mkdir(path.join(fixtureRoot, "PRIVATE-LOCAL-SECRETS", "apps-api"), { recursive: true });
    await writeFile(path.join(fixtureRoot, "manifest.json"), JSON.stringify({
      version: 1,
      providers: [{
        id: "agent_brain",
        env_vars: [
          "AGENT_BRAIN_CHANNEL",
          "AGENT_BRAIN_API_KEY",
          "AGENT_BRAIN_BASE_URL",
          "AGENT_BRAIN_MODEL",
          "AGENT_BRAIN_THIRD_API_KEY",
          "AGENT_BRAIN_THIRD_BASE_URL",
          "AGENT_BRAIN_THIRD_MODEL",
          "AGENT_BRAIN_FALLBACK_API_KEY",
          "AGENT_BRAIN_FALLBACK_BASE_URL",
          "AGENT_BRAIN_FALLBACK_MODEL",
          "AGENT_BRAIN_REASONING_EFFORT",
        ],
        runtime_contract: {
          schema_version: "provider-runtime-contract.v1",
          kind: "agent_brain_responses",
          endpoint_category: "openai_compatible_responses",
          selected_channel_env: "AGENT_BRAIN_CHANNEL",
          purpose_channels: {
            main_agent_responses: {
              channel: "primary",
              credential_env: "AGENT_BRAIN_API_KEY",
              base_url_env: "AGENT_BRAIN_BASE_URL",
              model_env: "AGENT_BRAIN_MODEL",
            },
            critic_responses: {
              channel: "third",
              credential_env: "AGENT_BRAIN_THIRD_API_KEY",
              base_url_env: "AGENT_BRAIN_THIRD_BASE_URL",
              model_env: "AGENT_BRAIN_THIRD_MODEL",
            },
            fallback_responses: {
              channel: "fallback",
              credential_env: "AGENT_BRAIN_FALLBACK_API_KEY",
              base_url_env: "AGENT_BRAIN_FALLBACK_BASE_URL",
              model_env: "AGENT_BRAIN_FALLBACK_MODEL",
            },
          },
          reasoning: {
            env: "AGENT_BRAIN_REASONING_EFFORT",
            default: "high",
            allowed: ["low", "medium", "high", "xhigh"],
          },
        },
      }],
    }), "utf8");
    await writeFile(
      path.join(fixtureRoot, "PRIVATE-LOCAL-SECRETS", "apps-api", ".env"),
      "AGENT_BRAIN_API_KEY=offline-only\nAGENT_BRAIN_BASE_URL=https://offline.invalid/v1\nAGENT_BRAIN_MODEL=offline-model\n",
      "utf8",
    );
    const brief = taskBrief();
    const fixture = createOfflineRuntimeAbFixture(brief);

    const responses = createLedgerBoundRuntimeAbAdapter({
      runtimeKind: "responses",
      ledgerRoot: fixtureRoot,
      capability: "agent_brain",
      transport: { client: fixture.responsesClient },
    });
    const sdk = createLedgerBoundRuntimeAbAdapter({
      runtimeKind: "agents_sdk",
      ledgerRoot: fixtureRoot,
      capability: "agent_brain",
      transport: { model: fixture.agentsModel },
    });

    expect([responses.contract, sdk.contract]).toEqual([
      expect.objectContaining({ runtimeKind: "responses", model: "offline-model", adoptionStatus: "evaluation_only", productionEligible: false, providerRequests: 0 }),
      expect.objectContaining({ runtimeKind: "agents_sdk", model: "offline-model", adoptionStatus: "evaluation_only", productionEligible: false, providerRequests: 0 }),
    ]);
    expect(fixture.externalProviderCalls).toBe(0);
  });
});

async function inputFor(
  brief: ReturnType<typeof taskBrief>,
  execute: ReturnType<typeof createOfflineRuntimeAbFixture>["execute"],
) {
  const intentGrant = grant(brief);
  const checkpointStore = await createStore();
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
      execute,
    }),
    checkpointStore,
  };
}

async function createStore() {
  await mkdir(fixtureRoot, { recursive: true });
  const store = createSqliteRuntimeAbCheckpointStore({
    databasePath: path.join(fixtureRoot, `${randomUUID()}.db`),
  });
  stores.push(store);
  return store;
}

function taskBrief() {
  return createTaskBrief({
    taskId: "task-runtime-ab-contract",
    projectId: "project-runtime-ab-contract",
    intentEpoch: 3,
    goal: "形成一句话PPT结构候选",
    requestedOutputs: ["requirement_spec", "lesson_plan", "ppt_outline"],
    constraints: ["offline fixture only"],
    excludedOutputs: ["image", "video", "package"],
    generationIntensity: "standard",
    sourceMessageId: "message-runtime-ab-contract",
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
    budgetPolicyVersion: "offline-runtime-ab.v1",
    maxCostCredits: 0,
    maxExternalProviderCalls: 0,
    requiredCheckpoints: [],
    expiresAt: null,
  };
}

function repeatedAgentsModel(toolName: RuntimeAbToolName, brief: ReturnType<typeof taskBrief>) {
  let requests = 0;
  const model: Model = {
    async getResponse(): Promise<ModelResponse> {
      requests += 1;
      return {
        usage: new Usage({ requests: 0 }),
        output: [{
          type: "function_call",
          callId: `repeated-${requests}`,
          name: toolName,
          arguments: JSON.stringify({ projectId: brief.projectId, userInstruction: brief.goal }),
          status: "completed",
        }],
      };
    },
    async *getStreamedResponse() {
      throw new Error("Runtime A/B contract test does not stream.");
    },
  };
  return { model, requests: () => requests };
}

function repairingAgentsModel(brief: ReturnType<typeof taskBrief>) {
  let requests = 0;
  const observations: RuntimeAbObservation[] = [];
  const model: Model = {
    async getResponse(request: ModelRequest): Promise<ModelResponse> {
      requests += 1;
      const parsed = JSON.parse(String(request.input)) as { observations?: RuntimeAbObservation[] };
      observations.splice(0, observations.length, ...(parsed.observations ?? []));
      if (observations.some((observation) => observation.status === "failed")
        && !observations.some((observation) => observation.status === "succeeded")) {
        return responseWithTool("repaired", { projectId: brief.projectId, userInstruction: `${brief.goal} repaired` });
      }
      if (observations.some((observation) => observation.status === "succeeded")) {
        return responseWithMessage("completed after repair");
      }
      return responseWithTool("initial", { projectId: brief.projectId, userInstruction: brief.goal });
    },
    async *getStreamedResponse() {
      throw new Error("Runtime A/B contract test does not stream.");
    },
  };
  return { model, requests: () => requests };
}

function responseWithTool(callId: string, argumentsValue: Record<string, unknown>): ModelResponse {
  return {
    usage: new Usage({ requests: 0 }),
    output: [{
      type: "function_call",
      callId,
      name: "create_requirement_spec",
      arguments: JSON.stringify(argumentsValue),
      status: "completed",
    }],
  };
}

function responseWithMessage(text: string): ModelResponse {
  return {
    usage: new Usage({ requests: 0 }),
    output: [{
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text }],
    }],
  };
}
