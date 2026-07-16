import { describe, expect, it, vi } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { DeterministicRuntime } from "@/server/agent-runtime/deterministic-runtime";
import { createWorkbenchActor } from "@/server/auth/actor";
import { createConversationTurnService } from "@/server/conversation/conversation-turn-service";
import type { MainConversationAgentInput } from "@/server/conversation/main-conversation-agent";
import { readAgentObservationsFromMessages } from "@/server/conversation/react-control";
import { createWorkbenchService } from "@/server/workbench/service";

describe("production single orchestrator", () => {
  it("keeps dormant Skill routers unreachable from non-test production source", async () => {
    const sourceRoot = path.resolve("src");
    const files = await listTypeScriptFiles(sourceRoot);
    const forbiddenImport = /(?:from\s*|import\s*\(|require\s*\()\s*["'][^"']*(?:skill-resolver|skill-invocation-gateway)["']/;
    const offenders: string[] = [];

    for (const filePath of files) {
      const normalized = filePath.replaceAll("\\", "/");
      if (normalized.includes("/__tests__/") || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(normalized)) continue;
      if (forbiddenImport.test(await readFile(filePath, "utf8"))) {
        offenders.push(path.relative(process.cwd(), filePath).replaceAll("\\", "/"));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("never lets an outer toolPlan execute when the native function-call loop owns the turn", async () => {
    const actor = createWorkbenchActor({
      userId: `teacher-${crypto.randomUUID()}`,
      displayName: "Teacher",
      authMode: "local",
    });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({
      title: "单一编排者",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const toolRouter = vi.fn();
    let sawNativeLoop = false;
    const agent = {
      async intakeTask(input: { userMessage: string }) {
        return {
          kind: "task" as const,
          proposal: {
            goal: input.userMessage,
            requestedOutputs: ["requirement_spec"],
            constraints: ["五年级数学百分数"],
            excludedOutputs: [],
          },
        };
      },
      async respond(input: MainConversationAgentInput) {
        sawNativeLoop = Boolean(input.agentToolLoop);
        return {
          assistantMessage: { body: "兼容层不应执行这个计划。" },
          state: "running_tool" as const,
          quickReplies: [],
          recommendedOptions: [],
          shouldRunToolNow: true,
          runtimeKind: "openai" as const,
          toolPlan: {
            planId: "legacy-outer-plan",
            capabilityId: "requirement_spec" as const,
            reasonForUser: "整理需求",
            internalReason: "injected legacy plan",
            inputDraft: {},
            missingInputs: [],
            upstreamPlan: [],
            nextSuggestedCapabilities: [],
            requiresConfirmation: false,
            expectedArtifactKind: "requirement_spec" as const,
          },
        };
      },
    };

    try {
      const turnService = createConversationTurnService({
        service,
        runtime: new DeterministicRuntime(),
        agent,
        toolRouter,
        agentToolExecutor: async () => { throw new Error("read-only Agent Tool must not run"); },
        executionIdentity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        executionFence: fence,
        enableTaskGrantAutonomy: true,
        enableNativeToolControlPlane: true,
      });

      const result = await turnService.createTurn(project.id, {
        role: "teacher",
        content: "请整理五年级数学百分数备课需求。",
      });

      expect(sawNativeLoop).toBe(true);
      expect(toolRouter).not.toHaveBeenCalled();
      expect(result.agentTurn).toMatchObject({ shouldRunToolNow: false, state: "failed_blocked" });
      expect(await service.getArtifacts(project.id)).toEqual([]);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("keeps native ownership when the qualified business Tool set is empty", async () => {
    const actor = createWorkbenchActor({
      userId: `teacher-${crypto.randomUUID()}`,
      displayName: "Teacher",
      authMode: "local",
    });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({
      title: "零 Tool 单一编排者",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const existing = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "已完成需求规格",
      status: "needs_review",
      summary: "当前任务需求已完整保存。",
      markdownContent: "# 已完成需求规格",
      structuredContent: {},
    });
    await service.approveArtifact(project.id, existing.id);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const toolRouter = vi.fn(async () => { throw new Error("outer Tool router must not run"); });
    let sawNativeLoop = false;
    const agent = {
      async intakeTask(input: { userMessage: string }) {
        return {
          kind: "task" as const,
          proposal: {
            goal: input.userMessage,
            requestedOutputs: ["requirement_spec"],
            constraints: ["五年级数学百分数"],
            excludedOutputs: [],
          },
        };
      },
      async respond(input: MainConversationAgentInput) {
        sawNativeLoop = Boolean(input.agentToolLoop);
        expect(input.agentToolLoop?.allowedToolNames).toEqual(["request_teacher_decision"]);
        return legacyOuterRequirementPlan();
      },
    };

    try {
      const turnService = createConversationTurnService({
        service,
        runtime: new DeterministicRuntime(),
        agent,
        toolRouter,
        agentToolExecutor: async () => { throw new Error("read-only Agent Tool must not run"); },
        executionIdentity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        executionFence: fence,
        enableTaskGrantAutonomy: true,
        enableNativeToolControlPlane: true,
      });

      const result = await turnService.createTurn(project.id, {
        role: "teacher",
        content: "继续核对当前需求规格。",
      });

      expect(sawNativeLoop).toBe(true);
      expect(toolRouter).not.toHaveBeenCalled();
      expect(result.agentTurn).toMatchObject({ shouldRunToolNow: false, state: "failed_blocked" });
      expect(await service.getArtifacts(project.id)).toHaveLength(1);
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("fails closed when native mode cannot construct its Tool loop configuration", async () => {
    const actor = createWorkbenchActor({
      userId: `teacher-${crypto.randomUUID()}`,
      displayName: "Teacher",
      authMode: "local",
    });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({
      title: "缺失 native loop 配置",
      grade: "五年级",
      subject: "数学",
      lessonTopic: "百分数",
    });
    const toolRouter = vi.fn(async () => { throw new Error("outer Tool router must not run"); });
    const agentInputs: MainConversationAgentInput[] = [];
    const agent = {
      async intakeTask(input: { userMessage: string }) {
        return {
          kind: "task" as const,
          proposal: {
            goal: input.userMessage,
            requestedOutputs: ["requirement_spec"],
            constraints: ["五年级数学百分数"],
            excludedOutputs: [],
          },
        };
      },
      async respond(input: MainConversationAgentInput) {
        agentInputs.push(input);
        return legacyOuterRequirementPlan();
      },
    };
    const turnService = createConversationTurnService({
      service,
      runtime: new DeterministicRuntime(),
      agent,
      toolRouter,
      enableTaskGrantAutonomy: true,
      enableNativeToolControlPlane: true,
    });

    const result = await turnService.createTurn(project.id, {
      role: "teacher",
      content: "请整理五年级数学百分数备课需求。",
    });
    const observations = readAgentObservationsFromMessages(await service.getMessages(project.id));

    expect(agentInputs).toHaveLength(1);
    expect(agentInputs[0].toolControlPlane).toBe("native");
    expect(agentInputs[0].agentToolLoop).toBeUndefined();
    expect(toolRouter).not.toHaveBeenCalled();
    expect(result.agentTurn).toMatchObject({ shouldRunToolNow: false, state: "failed_blocked" });
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCodes: expect.arrayContaining(["single_orchestrator_violation"]) }),
    ]));
    expect(await service.getArtifacts(project.id)).toEqual([]);
  });
});

function legacyOuterRequirementPlan() {
  return {
    assistantMessage: { body: "兼容层不应执行这个计划。" },
    state: "running_tool" as const,
    quickReplies: [],
    recommendedOptions: [],
    shouldRunToolNow: true,
    runtimeKind: "openai" as const,
    toolPlan: {
      planId: "legacy-outer-plan",
      capabilityId: "requirement_spec" as const,
      reasonForUser: "整理需求",
      internalReason: "injected legacy plan",
      inputDraft: {},
      missingInputs: [],
      upstreamPlan: [],
      nextSuggestedCapabilities: [],
      requiresConfirmation: false,
      expectedArtifactKind: "requirement_spec" as const,
    },
  };
}

async function listTypeScriptFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listTypeScriptFiles(entryPath));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(entryPath);
  }
  return files;
}
