import { describe, expect, it } from "vitest";
import { POST as postMessageRoute } from "@/app/api/workbench/projects/[projectId]/messages/route";
import { DeterministicRuntime } from "@/server/agent-runtime/deterministic-runtime";
import { createAgentRuntimeFromEnv } from "@/server/agent-runtime/runtime-factory";
import { drainProjectConversationQueue } from "@/server/conversation/conversation-turn-queue";
import { createConversationTurnService } from "@/server/conversation/conversation-turn-service";
import type { MainConversationAgentInput } from "@/server/conversation/main-conversation-agent";
import type { AgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import { createWorkbenchService } from "../service";

describe("Local Real MVP M60 conversation turn queue", () => {
  it("runs a one-sentence PPT task through the production queue without a routine confirmation", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "V1-9R2 queue autonomy", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const teacherMessage = await service.addMessage(project.id, {
      role: "teacher",
      content: "请做五年级数学百分数公开课 PPT，导入用投篮命中率情境，约 10 页。",
    });
    await service.enqueueConversationTurn(project.id, { teacherMessageId: teacherMessage.id });

    const result = await drainProjectConversationQueue(project.id, {
      service,
      runtime: new DeterministicRuntime(),
      enableTaskGrantAutonomy: true,
    });
    const snapshot = await service.getProjectSnapshot(project.id);
    const persistedTeacherMessage = snapshot.messages.find((message) => message.id === teacherMessage.id)!;

    expect(result).toMatchObject({ started: 1, succeeded: 1, failed: 0 });
    expect(snapshot.artifacts).toEqual([expect.objectContaining({ nodeKey: "requirement_spec", kind: "requirement_spec", status: "needs_review" })]);
    expect(persistedTeacherMessage.metadata).toMatchObject({
      taskBrief: { goal: expect.stringContaining("投篮命中率"), intentEpoch: 0 },
      intentGrant: { standardWorkAuthorized: true, taskId: expect.any(String), intensity: "standard" },
    });
    expect(snapshot.messages.filter((message) => message.role === "assistant").at(-1)?.metadata.pendingDeliveryPlan).toBeUndefined();
  });

  it("persists queued conversation turn jobs in the project snapshot", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "M60 对话队列状态" });
    const teacherMessage = await service.addMessage(project.id, {
      role: "teacher",
      content: "生成一套百分数公开课材料。",
    });

    const queued = await service.enqueueConversationTurn(project.id, {
      teacherMessageId: teacherMessage.id,
      idempotencyKey: "m60-queued-1",
    });

    expect(queued).toMatchObject({
      projectId: project.id,
      teacherMessageId: teacherMessage.id,
      assistantMessageId: null,
      status: "queued",
      attempts: 0,
      maxAttempts: 2,
      idempotencyKey: "m60-queued-1",
      errorMessage: null,
    });

    const snapshot = await service.getProjectSnapshot(project.id);
    expect(snapshot.turnJobs).toHaveLength(1);
    expect(snapshot.turnJobs[0]).toMatchObject({
      id: queued.id,
      status: "queued",
      teacherMessageId: teacherMessage.id,
    });
  });

  it("starts only the oldest queued turn job for one project", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "M60 单项目串行" });
    const firstMessage = await service.addMessage(project.id, { role: "teacher", content: "第一条" });
    const secondMessage = await service.addMessage(project.id, { role: "teacher", content: "第二条" });
    const first = await service.enqueueConversationTurn(project.id, { teacherMessageId: firstMessage.id });
    const second = await service.enqueueConversationTurn(project.id, { teacherMessageId: secondMessage.id });

    const running = await service.startNextConversationTurnJob(project.id);
    const blockedByRunning = await service.startNextConversationTurnJob(project.id);
    const snapshot = await service.getProjectSnapshot(project.id);

    expect(running?.id).toBe(first.id);
    expect(running?.status).toBe("running");
    expect(blockedByRunning).toBeNull();
    expect(snapshot.turnJobs.map((job) => ({ id: job.id, status: job.status }))).toEqual([
      { id: first.id, status: "running" },
      { id: second.id, status: "queued" },
    ]);
  });

  it("deduplicates queued turn jobs by idempotency key", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "M60 幂等入队" });
    const teacherMessage = await service.addMessage(project.id, { role: "teacher", content: "重复发送" });

    const first = await service.enqueueConversationTurn(project.id, {
      teacherMessageId: teacherMessage.id,
      idempotencyKey: "same-client-request",
    });
    const duplicated = await service.enqueueConversationTurn(project.id, {
      teacherMessageId: teacherMessage.id,
      idempotencyKey: "same-client-request",
    });
    const snapshot = await service.getProjectSnapshot(project.id);

    expect(duplicated.id).toBe(first.id);
    expect(snapshot.turnJobs).toHaveLength(1);
  });

  it("POST /messages persists a teacher message and returns an accepted turn job", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "M60 API 入队" });

    const response = await postMessageRoute(
      new Request("http://localhost/api/workbench/projects/project/messages", {
        method: "POST",
        body: JSON.stringify({ content: "先帮我整理五年级百分数公开课需求" }),
      }),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.message).toMatchObject({ projectId: project.id, role: "teacher", content: "先帮我整理五年级百分数公开课需求" });
    expect(body.job).toMatchObject({ projectId: project.id, teacherMessageId: body.message.id, status: "queued" });
    expect(body.assistantMessage).toBeUndefined();

    const snapshot = await service.getProjectSnapshot(project.id);
    expect(snapshot.messages.map((message) => message.id)).toContain(body.message.id);
    expect(snapshot.turnJobs.map((job) => job.id)).toContain(body.job.id);
  });

  it("POST /messages persists confirmedActionId metadata and queued execution confirms the pending plan", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "MVP1 API confirmedActionId 入队确认", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const turnService = createConversationTurnService({ service, runtime: new DeterministicRuntime() });
    await turnService.createTurn(project.id, { role: "teacher", content: "帮我做五年级数学百分数 PPT" });
    const actionId = await getLatestPendingActionId(service, project.id);

    const response = await postMessageRoute(
      new Request("http://localhost/api/workbench/projects/project/messages", {
        method: "POST",
        body: JSON.stringify({ content: "确认开始", confirmedActionId: actionId }),
      }),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.message).toMatchObject({ role: "teacher", content: "确认开始", metadata: { confirmedActionId: actionId } });

    const drainResult = await drainProjectConversationQueue(project.id, { service, runtime: new DeterministicRuntime() });
    const snapshot = await service.getProjectSnapshot(project.id);
    const assistantPlanMessage = snapshot.messages.find((message) => pendingDeliveryPlanOf(message).teacherRequest === "帮我做五年级数学百分数 PPT");

    expect(drainResult).toMatchObject({ started: 1, succeeded: 1, failed: 0 });
    expect(snapshot.artifacts).toEqual([expect.objectContaining({ nodeKey: "requirement_spec", status: "needs_review" })]);
    expect(snapshot.turnJobs.find((job) => job.id === body.job.id)).toMatchObject({ status: "succeeded" });
    expect(pendingDeliveryPlanOf(assistantPlanMessage)).toMatchObject({ status: "confirmed", actionId });
  });

  it("queued execution treats edited quick-reply text as a revision and never spends the old action", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "V1-4 queued edited action", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const turnService = createConversationTurnService({ service, runtime: new DeterministicRuntime() });
    await turnService.createTurn(project.id, { role: "teacher", content: "帮我做五年级数学百分数 PPT" });
    const oldActionId = await getLatestPendingActionId(service, project.id);
    const edited = await service.addMessage(project.id, {
      role: "teacher",
      content: "把叙事改成先冲突后揭秘，不要按刚才那版执行",
      metadata: { confirmedActionId: oldActionId },
    });
    await service.enqueueConversationTurn(project.id, { teacherMessageId: edited.id });

    const result = await drainProjectConversationQueue(project.id, { service, runtime: new DeterministicRuntime() });
    const snapshot = await service.getProjectSnapshot(project.id);
    const oldPlan = snapshot.messages.find((message) => pendingDeliveryPlanOf(message).actionId === oldActionId);

    expect(result).toMatchObject({ started: 1, succeeded: 1, failed: 0 });
    expect(snapshot.artifacts).toHaveLength(0);
    expect(snapshot.project.intentEpoch).toBe((project.intentEpoch ?? 0) + 1);
    expect(pendingDeliveryPlanOf(oldPlan)).toMatchObject({ status: "superseded", actionId: oldActionId });
    expect(await getLatestPendingActionId(service, project.id)).not.toBe(oldActionId);
  });

  it("POST /messages accepts actionId as an alias for confirmedActionId before queued execution", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "MVP1 API actionId 入队确认", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const turnService = createConversationTurnService({ service, runtime: new DeterministicRuntime() });
    await turnService.createTurn(project.id, { role: "teacher", content: "帮我做五年级数学百分数 PPT" });
    const actionId = await getLatestPendingActionId(service, project.id);

    const response = await postMessageRoute(
      new Request("http://localhost/api/workbench/projects/project/messages", {
        method: "POST",
        body: JSON.stringify({ content: "确认开始", actionId }),
      }),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.message).toMatchObject({ role: "teacher", content: "确认开始", metadata: { confirmedActionId: actionId } });

    const drainResult = await drainProjectConversationQueue(project.id, { service, runtime: new DeterministicRuntime() });
    const snapshot = await service.getProjectSnapshot(project.id);

    expect(drainResult).toMatchObject({ started: 1, succeeded: 1, failed: 0 });
    expect(snapshot.artifacts).toEqual([expect.objectContaining({ nodeKey: "requirement_spec", status: "needs_review" })]);
    expect(snapshot.turnJobs.find((job) => job.id === body.job.id)).toMatchObject({ status: "succeeded" });
  });

  it("queued execution blocks a pending plan when POST /messages has no valid actionId", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "MVP1 API actionId 阻断", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const turnService = createConversationTurnService({ service, runtime: new DeterministicRuntime() });
    await turnService.createTurn(project.id, { role: "teacher", content: "帮我做五年级数学百分数 PPT" });

    const response = await postMessageRoute(
      new Request("http://localhost/api/workbench/projects/project/messages", {
        method: "POST",
        body: JSON.stringify({ content: "确认开始", actionId: "human:wrong:requirement_spec:message" }),
      }),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.message).toMatchObject({ role: "teacher", metadata: { confirmedActionId: "human:wrong:requirement_spec:message" } });

    const drainResult = await drainProjectConversationQueue(project.id, { service, runtime: new DeterministicRuntime() });
    const snapshot = await service.getProjectSnapshot(project.id);
    const assistantMessages = snapshot.messages.filter((message) => message.role === "assistant");

    expect(drainResult).toMatchObject({ started: 1, succeeded: 1, failed: 0 });
    expect(snapshot.artifacts).toHaveLength(0);
    expect(snapshot.turnJobs.find((job) => job.id === body.job.id)).toMatchObject({ status: "succeeded" });
    expect(assistantMessages.at(-1)?.content).toContain("不匹配");
  });

  it("POST /messages deduplicates teacher message and turn job by idempotency key", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "M60 API 幂等入队" });
    const payload = {
      content: "同一个客户端请求只应该保存一次老师消息",
      idempotencyKey: "m60-route-idempotent-message-turn",
    };

    const firstResponse = await postMessageRoute(
      new Request("http://localhost/api/workbench/projects/project/messages", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const secondResponse = await postMessageRoute(
      new Request("http://localhost/api/workbench/projects/project/messages", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const firstBody = await firstResponse.json();
    const secondBody = await secondResponse.json();
    const snapshot = await service.getProjectSnapshot(project.id);

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    expect(secondBody.message.id).toBe(firstBody.message.id);
    expect(secondBody.job.id).toBe(firstBody.job.id);
    expect(snapshot.messages.filter((message) => message.role === "teacher" && message.content === payload.content)).toHaveLength(1);
    expect(snapshot.turnJobs.filter((job) => job.idempotencyKey === payload.idempotencyKey)).toHaveLength(1);
  });

  it("restarts an expired running turn job instead of leaving the queue stuck", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "M60 过期 running 恢复" });
    const teacherMessage = await service.addMessage(project.id, { role: "teacher", content: "这条 running 会过期" });
    const queued = await service.enqueueConversationTurn(project.id, { teacherMessageId: teacherMessage.id });

    const staleRunning = await service.startNextConversationTurnJob(project.id, { lockedBy: "stale-worker", lockMs: -1 });
    const restarted = await service.startNextConversationTurnJob(project.id, { lockedBy: "recovery-worker", lockMs: 60_000 });
    const snapshot = await service.getProjectSnapshot(project.id);

    expect(staleRunning).toMatchObject({ id: queued.id, status: "running", attempts: 1, lockedBy: "stale-worker" });
    expect(restarted).toMatchObject({ id: queued.id, status: "running", attempts: 2, lockedBy: "recovery-worker" });
    expect(snapshot.turnJobs).toHaveLength(1);
    expect(snapshot.turnJobs[0]).toMatchObject({ id: queued.id, status: "running", attempts: 2, lockedBy: "recovery-worker" });
  });

  it("drains queued turn jobs for one project in FIFO order without concurrent running jobs", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "M60 drain 串行" });
    const messages = await Promise.all([
      service.addMessage(project.id, { role: "teacher", content: "第一条" }),
      service.addMessage(project.id, { role: "teacher", content: "第二条" }),
      service.addMessage(project.id, { role: "teacher", content: "第三条" }),
    ]);
    for (const message of messages) {
      await service.enqueueConversationTurn(project.id, { teacherMessageId: message.id });
    }
    const executionOrder: string[] = [];
    let activeExecutors = 0;
    let maxActiveExecutors = 0;

    await Promise.all([
      drainProjectConversationQueue(project.id, {
        service,
        executor: async ({ job }) => {
          activeExecutors += 1;
          maxActiveExecutors = Math.max(maxActiveExecutors, activeExecutors);
          executionOrder.push(job.teacherMessageId);
          const assistantMessage = await service.addMessage(project.id, { role: "assistant", content: `已处理 ${job.teacherMessageId}` });
          activeExecutors -= 1;
          return { assistantMessageId: assistantMessage.id };
        },
      }),
      drainProjectConversationQueue(project.id, {
        service,
        executor: async ({ job }) => {
          throw new Error(`不应并发执行 ${job.id}`);
        },
      }),
    ]);

    const snapshot = await service.getProjectSnapshot(project.id);
    expect(executionOrder).toEqual(messages.map((message) => message.id));
    expect(maxActiveExecutors).toBe(1);
    expect(snapshot.turnJobs.map((job) => job.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(snapshot.turnJobs.every((job) => job.finishedAt)).toBe(true);
  });

  it("marks a failed turn job without deleting later queued work", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "M60 drain 失败保留" });
    const firstMessage = await service.addMessage(project.id, { role: "teacher", content: "第一条会失败" });
    const secondMessage = await service.addMessage(project.id, { role: "teacher", content: "第二条继续" });
    await service.enqueueConversationTurn(project.id, { teacherMessageId: firstMessage.id });
    await service.enqueueConversationTurn(project.id, { teacherMessageId: secondMessage.id });

    await drainProjectConversationQueue(project.id, {
      service,
      executor: async ({ job }) => {
        if (job.teacherMessageId === firstMessage.id) {
          throw new Error("生成失败，请稍后重试。");
        }
        const assistantMessage = await service.addMessage(project.id, { role: "assistant", content: "第二条已处理" });
        return { assistantMessageId: assistantMessage.id };
      },
    });

    const snapshot = await service.getProjectSnapshot(project.id);
    expect(snapshot.turnJobs.map((job) => ({ teacherMessageId: job.teacherMessageId, status: job.status }))).toEqual([
      { teacherMessageId: firstMessage.id, status: "failed" },
      { teacherMessageId: secondMessage.id, status: "succeeded" },
    ]);
    expect(snapshot.turnJobs[0].errorMessage).toBe("生成失败，请稍后重试。");
    expect(snapshot.turnJobs[1].assistantMessageId).toBeTruthy();
  });

  it("skips max-attempt exhausted jobs and continues draining later queued work", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "M60 exhausted job 跳过" });
    const exhaustedMessage = await service.addMessage(project.id, { role: "teacher", content: "这条达到最大次数" });
    const nextMessage = await service.addMessage(project.id, { role: "teacher", content: "下一条继续" });
    await service.enqueueConversationTurn(project.id, { teacherMessageId: exhaustedMessage.id, maxAttempts: 0 });
    await service.enqueueConversationTurn(project.id, { teacherMessageId: nextMessage.id });

    const drainResult = await drainProjectConversationQueue(project.id, {
      service,
      executor: async ({ job }) => {
        expect(job.teacherMessageId).toBe(nextMessage.id);
        const assistantMessage = await service.addMessage(project.id, { role: "assistant", content: "下一条已处理" });
        return { assistantMessageId: assistantMessage.id };
      },
    });

    const snapshot = await service.getProjectSnapshot(project.id);
    expect(drainResult).toMatchObject({ started: 1, succeeded: 1, failed: 1 });
    expect(snapshot.turnJobs.map((job) => ({ teacherMessageId: job.teacherMessageId, status: job.status }))).toEqual([
      { teacherMessageId: exhaustedMessage.id, status: "failed" },
      { teacherMessageId: nextMessage.id, status: "succeeded" },
    ]);
  });

  it("default drain executor runs the existing conversation turn service", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "M60 默认 executor" });
    const teacherMessage = await service.addMessage(project.id, { role: "teacher", content: "你好" });
    await service.enqueueConversationTurn(project.id, { teacherMessageId: teacherMessage.id });

    const drainResult = await drainProjectConversationQueue(project.id, {
      service,
      runtime: createAgentRuntimeFromEnv({ NODE_ENV: "test" }),
    });

    const snapshot = await service.getProjectSnapshot(project.id);
    const assistantMessages = snapshot.messages.filter((message) => message.role === "assistant");
    expect(drainResult).toMatchObject({ started: 1, succeeded: 1, failed: 0 });
    expect(snapshot.turnJobs[0]).toMatchObject({ status: "succeeded", assistantMessageId: assistantMessages[0].id });
    expect(assistantMessages[0].content).toContain("小酷");
  });

  it("passes queued identity, fence and frozen generation intensity into the Main Agent Agent Tool loop", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "V1-3 queued Agent Tool identity" });
    const enhancedProject = await service.updateProjectGenerationIntensity(project.id, { intensity: "enhanced", expectedVersion: 0 });
    const teacherMessage = await service.addMessage(project.id, { role: "teacher", content: "请先规划PPT样张" });
    await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft", kind: "ppt_draft", title: "可信 PPT 大纲", status: "needs_review",
      summary: "已通过内部校验，可供 Director 审查。", markdownContent: "# PPT 大纲",
      structuredContent: { artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" } },
    });
    await service.enqueueConversationTurn(project.id, { teacherMessageId: teacherMessage.id });
    await service.updateProjectGenerationIntensity(project.id, { intensity: "deep", expectedVersion: enhancedProject.intensityVersion ?? 1 });
    let invocation: AgentToolInvocationEnvelope | undefined;
    const agentToolExecutor = async (envelope: AgentToolInvocationEnvelope) => {
      invocation = envelope;
      return {
        status: "succeeded" as const,
        toolId: "ppt_director.plan_or_repair" as const,
        invocationId: envelope.invocationId,
        structuredOutput: { decision: "plan", targetLocators: [] },
        assistantSummary: "已完成样张规划。",
        artifactCreated: false as const,
      };
    };
    const agent = {
      async respond(input: MainConversationAgentInput) {
        expect(input.generationIntensity).toBe("enhanced");
        expect(input.agentToolLoop).toBeDefined();
        await input.agentToolLoop!.dispatch({
          callId: "queued-call",
          toolName: "ppt_director_plan_or_repair",
          arguments: { goal: "规划样张", stage: "sample_plan", targetPageIds: [], focus: null },
        });
        return {
          assistantMessage: { body: "我已经核对样张规划，下一步等你确认。" },
          state: "chatting" as const,
          quickReplies: [],
          recommendedOptions: [],
          shouldRunToolNow: false,
          runtimeKind: "openai" as const,
        };
      },
    };

    const result = await drainProjectConversationQueue(project.id, {
      service,
      runtime: new DeterministicRuntime(),
      agent,
      agentToolExecutor,
      workerId: "v1-3-worker",
    });

    expect(result).toMatchObject({ started: 1, succeeded: 1, failed: 0 });
    expect(invocation).toMatchObject({
      projectId: project.id,
      identity: { actorUserId: "local-test-user", actorAuthMode: "local", authSessionId: null },
      sourceMessageId: teacherMessage.id,
      generationIntensity: "enhanced",
    });
    expect(invocation?.intentEpoch).toBe(project.intentEpoch ?? 0);
  });
});

function createQueueTestService() {
  return createWorkbenchService(undefined, undefined, {
    actorUserId: "local-test-user",
    actorAuthMode: "local",
    authSessionId: null,
  });
}

async function getLatestPendingActionId(service: ReturnType<typeof createWorkbenchService>, projectId: string) {
  const messages = await service.getMessages(projectId);
  const pendingMessage = [...messages].reverse().find((message) => pendingDeliveryPlanOf(message).status === "pending");
  return String(pendingDeliveryPlanOf(pendingMessage).actionId ?? "");
}

function pendingDeliveryPlanOf(message?: { metadata: Record<string, unknown> }) {
  return (message?.metadata.pendingDeliveryPlan ?? {}) as { status?: string; actionId?: string; teacherRequest?: string };
}
