import { describe, expect, it } from "vitest";

import {
  buildMainAgentReActContinuationItems,
  createMainAgentReActCheckpoint,
  MAIN_AGENT_REACT_CHECKPOINT_VERSION,
  type MainAgentReActRoundRecord,
} from "@/server/conversation/main-agent-react-checkpoint";

describe("Main Agent ReAct checkpoint", () => {
  const request = { instructions: "main-agent-rules", input: "compacted context package" };

  it("binds task, intent, plan, authorization, tools and observations to a deterministic digest", () => {
    const records: MainAgentReActRoundRecord[] = [{
      round: 1,
      toolName: "create_requirement_spec",
      callDigest: "call-digest-1",
      observation: {
        observationId: "observation-1",
        status: "failed",
        reasonCodes: ["validation_failed", "requirement_scope_missing"],
        reportRefs: [{ id: "validation-1", kind: "validation", digest: "report-digest" }],
        artifactRefs: [{ artifactId: "artifact-1", kind: "requirement_spec", version: 1, digest: "artifact-digest" }],
        nextAction: "replan",
      },
    }];
    const seed = {
      projectId: "project-1",
      taskId: "task-1",
      taskBriefDigest: "a".repeat(64),
      intentEpoch: 3,
      planRevision: 7,
      generationIntensity: "enhanced" as const,
      authorization: {
        standardWorkAuthorized: true,
        budgetPolicyVersion: "budget-v2",
        maxCostCredits: 30,
        maxExternalProviderCalls: 0,
      },
    };

    const first = createMainAgentReActCheckpoint({
      request,
      seed,
      records,
      currentToolNames: ["create_lesson_plan", "create_requirement_spec"],
    });
    const second = createMainAgentReActCheckpoint({
      request,
      seed,
      records,
      currentToolNames: ["create_requirement_spec", "create_lesson_plan"],
    });

    expect(first.schemaVersion).toBe(MAIN_AGENT_REACT_CHECKPOINT_VERSION);
    expect(first.task).toEqual(seed);
    expect(first.currentToolNames).toEqual(["create_lesson_plan", "create_requirement_spec"]);
    expect(first.completedRounds[0].observation).toMatchObject({
      observationId: "observation-1",
      reasonCodes: ["requirement_scope_missing", "validation_failed"],
      nextAction: "replan",
    });
    expect(first.checkpointDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(second.checkpointDigest).toBe(first.checkpointDigest);
  });

  it("folds oldest rounds under a soft budget while retaining recent failure facts and references", () => {
    const records: MainAgentReActRoundRecord[] = Array.from({ length: 8 }, (_, index) => ({
      round: index + 1,
      toolName: `tool_${index + 1}`,
      callDigest: `digest_${index + 1}`,
      observation: {
        observationId: `observation-${index + 1}`,
        status: index === 7 ? "failed" : "succeeded",
        reasonCodes: index === 7 ? ["timeout", "retry_budget_exhausted"] : ["business_tool_succeeded"],
        summary: `round-${index + 1}-${"detail".repeat(300)}`,
        artifactRefs: [{ artifactId: `artifact-${index + 1}`, kind: "candidate" }],
      },
    }));

    const checkpoint = createMainAgentReActCheckpoint({
      request,
      records,
      currentToolNames: ["repair_candidate", "change_tool"],
      maxEstimatedTokens: 800,
    });

    expect(checkpoint.compactedHistory.omittedRounds).toBeGreaterThan(0);
    expect(checkpoint.compactedHistory.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(checkpoint.completedRounds.at(-1)?.observation).toMatchObject({
      observationId: "observation-8",
      status: "failed",
      reasonCodes: ["retry_budget_exhausted", "timeout"],
    });
    expect(JSON.stringify(checkpoint).length).toBeLessThan(8_000);
  });

  it("transports only the latest protocol pair and a checkpoint reference output", () => {
    const checkpoint = createMainAgentReActCheckpoint({
      request,
      records: [{
        round: 1,
        toolName: "create_requirement_spec",
        callDigest: "digest-1",
        observation: { observationId: "observation-1", status: "succeeded", reasonCodes: ["ok"] },
      }],
      currentToolNames: ["create_lesson_plan"],
    });
    const items = buildMainAgentReActContinuationItems({
      request,
      checkpoint,
      latestCall: {
        id: "function-item-1",
        callId: "call-1",
        name: "create_requirement_spec",
        argumentsText: "{}",
        argumentsJsonParseStatus: "parsed",
        argumentsJson: {},
      },
    }) as Array<Record<string, unknown>>;

    expect(items).toHaveLength(4);
    expect(items[1]).toMatchObject({ role: "user" });
    expect(String(items[1].content)).toContain(MAIN_AGENT_REACT_CHECKPOINT_VERSION);
    expect(items[2]).toMatchObject({ type: "function_call", call_id: "call-1" });
    expect(items[3]).toMatchObject({ type: "function_call_output", call_id: "call-1" });
    expect(String(items[3].output)).toContain(checkpoint.checkpointDigest);
    expect(String(items[3].output)).not.toContain("artifact-draft-content");
  });
});
