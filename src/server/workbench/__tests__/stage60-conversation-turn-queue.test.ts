import { describe, expect, it } from "vitest";
import { POST as postMessageRoute } from "@/app/api/workbench/projects/[projectId]/messages/route";
import { FixtureAgentRuntime } from "../../../../tests/helpers/fixture-agent-runtime";
import { drainProjectConversationQueue } from "@/server/conversation/conversation-turn-queue";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { buildSemanticContextSnapshot } from "@/server/conversation/context-semantic-snapshot";
import type { MainConversationAgent, MainConversationAgentInput } from "@/server/conversation/main-conversation-agent";
import {
  createExecutionEnvelope,
  createTaskBrief,
  type IntentGrant,
  type PendingDecision,
  type TaskRequestedOutput,
} from "@/server/conversation/task-contract";
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
      runtime: new FixtureAgentRuntime(),
      agent: createQueueAgentFixture({
        requestedOutputs: ["ppt"],
        toolCall: { toolName: "create_ppt_outline", arguments: {} },
      }),
    });
    const snapshot = await service.getProjectSnapshot(project.id);
    const persistedTeacherMessage = snapshot.messages.find((message) => message.id === teacherMessage.id)!;

    expect(result).toMatchObject({ started: 1, succeeded: 0, blocked: 1, failed: 0 });
    expect(snapshot.artifacts).toEqual([expect.objectContaining({ nodeKey: "ppt_draft", kind: "ppt_draft", status: "needs_review" })]);
    expect(persistedTeacherMessage.metadata).toMatchObject({
      taskBrief: { goal: expect.stringContaining("投篮命中率"), intentEpoch: 0 },
      intentGrant: { standardWorkAuthorized: true, taskId: expect.any(String), intensity: "standard" },
    });
    expect(snapshot.messages.some((message) => message.metadata.pendingDecision)).toBe(false);
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

  it("POST /messages binds confirmation to the persisted PendingDecision", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "MVP1 API confirmedActionId 入队确认", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const seeded = await seedPendingDecision(service, project.id, "帮我做五年级数学百分数 PPT");
    const actionId = seeded.decision.actionId;

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

    const drainResult = await drainProjectConversationQueue(project.id, {
      service,
      runtime: new FixtureAgentRuntime(),
      agent: createQueueAgentFixture(),
    });
    const snapshot = await service.getProjectSnapshot(project.id);
    const decisionMessage = snapshot.messages.find((message) => pendingDecisionOf(message).decisionId === seeded.decision.decisionId);
    const aggregate = await seeded.store.getTaskAggregate(project.id, seeded.taskBrief.intentEpoch);
    const semanticSnapshot = await seeded.store.getLatestSemanticSnapshot({
      projectId: project.id,
      taskId: seeded.taskBrief.taskId,
      intentEpoch: seeded.taskBrief.intentEpoch,
    });

    expect(drainResult).toMatchObject({ started: 1, succeeded: 0, blocked: 1, failed: 0 });
    expect(snapshot.artifacts).toEqual([]);
    expect(snapshot.project.intentEpoch).toBe(seeded.taskBrief.intentEpoch);
    expect(snapshot.turnJobs.find((job) => job.id === body.job.id)).toMatchObject({ status: "blocked", errorCode: "completion_contract_unsatisfied" });
    expect(pendingDecisionOf(decisionMessage)).toMatchObject({ status: "confirmed", actionId });
    expect(aggregate).toMatchObject({
      taskBrief: { taskId: seeded.taskBrief.taskId, intentEpoch: seeded.taskBrief.intentEpoch },
      status: "paused_recovery",
    });
    expect(semanticSnapshot?.snapshot.pendingDecision).toMatchObject({ status: "confirmed", actionId });
  });

  it("queued execution supersedes the old PendingDecision when its quick reply is edited", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "V1-4 queued edited action", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const seeded = await seedPendingDecision(service, project.id, "帮我做五年级数学百分数 PPT");
    const oldActionId = seeded.decision.actionId;
    const edited = await service.addMessage(project.id, {
      role: "teacher",
      content: "把叙事改成先冲突后揭秘，不要按刚才那版执行",
      metadata: { confirmedActionId: oldActionId },
    });
    await service.enqueueConversationTurn(project.id, { teacherMessageId: edited.id });

    const result = await drainProjectConversationQueue(project.id, {
      service,
      runtime: new FixtureAgentRuntime(),
      agent: createQueueAgentFixture(),
    });
    const snapshot = await service.getProjectSnapshot(project.id);
    const oldDecision = snapshot.messages.find((message) => pendingDecisionOf(message).actionId === oldActionId);

    expect(result).toMatchObject({ started: 1, succeeded: 1, blocked: 0, failed: 0 });
    expect(snapshot.artifacts).toHaveLength(0);
    expect(snapshot.project.intentEpoch).toBe((project.intentEpoch ?? 0) + 1);
    expect(pendingDecisionOf(oldDecision)).toMatchObject({ status: "superseded", actionId: oldActionId });
    expect(await seeded.store.getTaskAggregate(project.id, seeded.taskBrief.intentEpoch)).toMatchObject({ status: "superseded" });
    await expect(seeded.store.getLatestSemanticSnapshot({
      projectId: project.id,
      taskId: seeded.taskBrief.taskId,
      intentEpoch: seeded.taskBrief.intentEpoch,
    })).resolves.toBeNull();
    expect(await getLatestPendingActionId(service, project.id)).not.toBe(oldActionId);
  });

  it("POST /messages accepts actionId as an alias for confirmedActionId before queued execution", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "MVP1 API actionId 入队确认", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const seeded = await seedPendingDecision(service, project.id, "帮我做五年级数学百分数 PPT");
    const actionId = seeded.decision.actionId;

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

    const drainResult = await drainProjectConversationQueue(project.id, {
      service,
      runtime: new FixtureAgentRuntime(),
      agent: createQueueAgentFixture(),
    });
    const snapshot = await service.getProjectSnapshot(project.id);

    expect(drainResult).toMatchObject({ started: 1, succeeded: 0, blocked: 1, failed: 0 });
    expect(snapshot.artifacts).toEqual([]);
    expect(snapshot.messages.some((message) => pendingDecisionOf(message).status === "confirmed" && pendingDecisionOf(message).actionId === actionId)).toBe(true);
    expect(snapshot.turnJobs.find((job) => job.id === body.job.id)).toMatchObject({ status: "blocked", errorCode: "completion_contract_unsatisfied" });
  });

  it("queued execution leaves a PendingDecision unspent when POST /messages has the wrong actionId", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "MVP1 API actionId 阻断", grade: "五年级", subject: "数学", lessonTopic: "百分数" });
    const seeded = await seedPendingDecision(service, project.id, "帮我做五年级数学百分数 PPT");

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

    const drainResult = await drainProjectConversationQueue(project.id, {
      service,
      runtime: new FixtureAgentRuntime(),
      agent: createQueueAgentFixture(),
    });
    const snapshot = await service.getProjectSnapshot(project.id);
    const semanticSnapshot = await seeded.store.getLatestSemanticSnapshot({
      projectId: project.id,
      taskId: seeded.taskBrief.taskId,
      intentEpoch: seeded.taskBrief.intentEpoch,
    });

    expect(drainResult).toMatchObject({ started: 1, succeeded: 1, blocked: 0, failed: 0 });
    expect(snapshot.artifacts).toHaveLength(0);
    expect(snapshot.turnJobs.find((job) => job.id === body.job.id)).toMatchObject({ status: "succeeded" });
    expect(snapshot.messages.some((message) => pendingDecisionOf(message).status === "pending" && pendingDecisionOf(message).actionId === seeded.decision.actionId)).toBe(true);
    expect(semanticSnapshot?.snapshot.pendingDecision).toMatchObject({
      status: "pending",
      actionId: seeded.decision.actionId,
    });
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

  it("does not let generic checkpoint recovery requeue a Provider-health-gated TurnJob", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "V1-9 selected channel recovery" });
    const teacherMessage = await service.addMessage(project.id, { role: "teacher", content: "完成百分数材料包" });
    const queued = await service.enqueueConversationTurn(project.id, {
      teacherMessageId: teacherMessage.id,
      idempotencyKey: "turn:same-task",
      maxAttempts: 2,
    });
    const running = await service.startNextConversationTurnJob(project.id, { lockedBy: "primary-worker" });
    await service.failConversationTurnJob(project.id, running!.id, {
      errorCode: "main_agent_provider_policy_blocked",
      errorMessage: "当前智能服务通道拒绝了这次请求。",
      retryability: "after_provider_health_change",
      failureEvidenceDigest: "a".repeat(64),
    });

    await expect(service.requeueConversationTurnJobForRecovery(project.id, queued.id, {
      recoveryEvidenceDigest: "a".repeat(64),
    })).resolves.toBeNull();
    const recovered = await service.requeueConversationTurnJobForRecovery(project.id, queued.id, {
      recoveryEvidenceDigest: "b".repeat(64),
    });

    expect(recovered).toBeNull();
    expect(await service.startNextConversationTurnJob(project.id, { lockedBy: "fallback-worker" })).toBeNull();
  });

  it("does not let generic checkpoint recovery extend an exhausted Provider-health-gated TurnJob", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "V1-9 exhausted selected channel recovery" });
    const teacherMessage = await service.addMessage(project.id, { role: "teacher", content: "继续同一百分数材料包" });
    const queued = await service.enqueueConversationTurn(project.id, {
      teacherMessageId: teacherMessage.id,
      idempotencyKey: "turn:same-exhausted-task",
      maxAttempts: 1,
    });
    const running = await service.startNextConversationTurnJob(project.id, { lockedBy: "primary-worker" });
    await service.failConversationTurnJob(project.id, running!.id, {
      errorCode: "main_agent_provider_unavailable",
      errorMessage: "当前智能服务通道暂时不可用。",
      retryability: "after_provider_health_change",
      failureEvidenceDigest: "a".repeat(64),
    });

    const recovered = await service.requeueConversationTurnJobForRecovery(project.id, queued.id, {
      recoveryEvidenceDigest: "b".repeat(64),
    });

    expect(recovered).toBeNull();
    expect((await service.getConversationTurnJobs(project.id))[0]).toMatchObject({
      id: queued.id,
      status: "failed",
      attempts: 1,
      maxAttempts: 1,
    });
    await expect(service.requeueConversationTurnJobForRecovery(project.id, queued.id, {
      recoveryEvidenceDigest: "b".repeat(64),
    })).resolves.toBeNull();
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

  it("atomically pauses an in-flight task without changing its IntentEpoch or PendingDecision", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "控制抢先提交" });
    const seeded = await seedPendingDecision(service, project.id, "生成PPT");

    const result = await service.enqueueMessageAndConversationTurn(project.id, {
      role: "teacher",
      content: "暂停",
      metadata: {},
      preemptiveControl: {
        kind: "pause",
        reasonCode: "teacher_requested_pause",
        advanceIntentEpoch: false,
        userMessage: "暂停",
      },
    } as Parameters<typeof service.enqueueMessageAndConversationTurn>[1]);

    expect(result.job).toMatchObject({ status: "succeeded", assistantMessageId: expect.any(String) });
    const snapshot = await service.getProjectSnapshot(project.id);
    const semanticSnapshot = await seeded.store.getLatestSemanticSnapshot({
      projectId: project.id,
      taskId: seeded.taskBrief.taskId,
      intentEpoch: seeded.taskBrief.intentEpoch,
    });
    expect(snapshot.project.intentEpoch).toBe(seeded.taskBrief.intentEpoch);
    expect(snapshot.messages.find((message) => pendingDecisionOf(message).actionId === seeded.decision.actionId))
      .toMatchObject({ metadata: { pendingDecision: { status: "pending", actionId: seeded.decision.actionId } } });
    expect(await seeded.store.getTaskAggregate(project.id, seeded.taskBrief.intentEpoch)).toMatchObject({
      status: "paused_recovery",
      plan: { revision: 0 },
    });
    expect(semanticSnapshot?.snapshot).toMatchObject({
      taskBrief: { taskId: seeded.taskBrief.taskId, intentEpoch: seeded.taskBrief.intentEpoch },
      pendingDecision: { status: "pending", actionId: seeded.decision.actionId },
    });
  });

  it("atomically cancels an in-flight invocation before its result can be promoted", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "取消抢先阻断迟到结果" });
    const seeded = await seedPendingDecision(service, project.id, "生成PPT");
    const { source, taskBrief: brief, intentGrant: grant, store } = seeded;
    const activePlan = { planId: seeded.decision.planId, revision: 0, status: "active" };
    await store.resumeTaskAggregate({ taskBrief: brief, intentGrant: grant, plan: activePlan });
    await store.saveSemanticSnapshot(buildSemanticContextSnapshot({
      taskBrief: brief,
      plan: activePlan,
      pendingDecision: seeded.decision,
      trustedArtifactRefs: [],
      observationRefs: [],
      recentMessages: [{ role: "teacher", content: source.content }],
    }), 0);
    const envelope = createExecutionEnvelope({
      actorUserId: "local-test-user",
      taskBrief: brief,
      planRevision: 0,
      intensity: "standard",
      intentGrant: grant,
      action: { toolName: "create_requirement_spec", arguments: {} },
    });
    const invocationId = `invocation:${source.id}`;
    await service.enqueueConversationTurn(project.id, { teacherMessageId: source.id });
    await service.startNextConversationTurnJob(project.id, { lockedBy: "in-flight-tool-test" });
    await store.startToolInvocation({ invocationId, envelope, toolName: "create_requirement_spec", request: {} });

    const result = await service.enqueueMessageAndConversationTurn(project.id, {
      role: "teacher",
      content: "取消",
      metadata: {},
      preemptiveControl: {
        kind: "cancel",
        reasonCode: "teacher_requested_cancel",
        advanceIntentEpoch: true,
        userMessage: "取消",
      },
    });

    expect(result.job).toMatchObject({ status: "succeeded", assistantMessageId: expect.any(String) });
    const snapshot = await service.getProjectSnapshot(project.id);
    expect(snapshot.project.intentEpoch).toBe(brief.intentEpoch + 1);
    expect(snapshot.messages.find((message) => pendingDecisionOf(message).actionId === seeded.decision.actionId))
      .toMatchObject({ metadata: { pendingDecision: { status: "canceled", actionId: seeded.decision.actionId } } });
    expect(await store.getTaskAggregate(project.id, brief.intentEpoch)).toMatchObject({ status: "canceled", plan: { revision: 1 } });
    await expect(store.getLatestSemanticSnapshot({
      projectId: project.id,
      taskId: brief.taskId,
      intentEpoch: brief.intentEpoch,
    })).resolves.toBeNull();
    await expect(store.commitToolResult({
      invocationId,
      artifact: {
        nodeKey: "requirement_spec",
        kind: "requirement_spec",
        title: "不应提升的迟到结果",
        status: "needs_review",
        summary: "迟到结果",
        markdownContent: "# 迟到结果",
        structuredContent: { goal: brief.goal },
      },
      observation: {
        observationId: `observation:${source.id}`,
        status: "succeeded",
        reasonCodes: ["tool_succeeded"],
        payload: {},
      },
      event: {
        eventId: `event:${source.id}`,
        projectId: project.id,
        taskId: brief.taskId,
        runId: `turn:${source.id}`,
        intentEpoch: 0,
        kind: "artifact_committed",
        visibility: "internal",
        occurredAt: new Date().toISOString(),
        payload: {},
      },
    })).rejects.toThrow("Tool invocation is stale");
    expect((await service.getArtifacts(project.id)).some((artifact) => artifact.title === "不应提升的迟到结果")).toBe(false);
  });

  it("atomically invalidates the old epoch before queuing an explicit redirect", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "改道抢先失效" });
    const source = await service.addMessage(project.id, { role: "teacher", content: "生成PPT" });
    const brief = createTaskBrief({
      taskId: `task:${source.id}`,
      projectId: project.id,
      intentEpoch: 0,
      goal: source.content,
      requestedOutputs: ["ppt"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: source.id,
    });
    const grant: IntentGrant = {
      schemaVersion: "intent-grant.v1",
      taskId: brief.taskId,
      projectId: project.id,
      intentEpoch: 0,
      standardWorkAuthorized: true,
      intensity: "standard",
      budgetPolicyVersion: "v1-standard-task-scope.v1",
      maxCostCredits: null,
      maxExternalProviderCalls: 2,
      requiredCheckpoints: [],
      expiresAt: null,
    };
    const store = createControlPlaneStore();
    await store.upsertTaskAggregate({
      taskBrief: brief,
      intentGrant: grant,
      plan: { planId: `plan:${brief.taskId}`, revision: 0, status: "active" },
      checkpoint: null,
    });

    const result = await service.enqueueMessageAndConversationTurn(project.id, {
      role: "teacher",
      content: "改成只做需求规格",
      metadata: {},
      preemptiveControl: {
        kind: "redirect",
        reasonCode: "teacher_requested_redirect",
        advanceIntentEpoch: true,
        userMessage: "改成只做需求规格",
      },
    });

    expect(result.job).toMatchObject({ status: "queued", assistantMessageId: null });
    expect((await service.getProjectSnapshot(project.id)).project.intentEpoch).toBe(1);
    expect(await store.getTaskAggregate(project.id, 0)).toMatchObject({ status: "superseded", plan: { revision: 1 } });
    await expect(store.getLatestSemanticSnapshot({
      projectId: project.id,
      taskId: brief.taskId,
      intentEpoch: brief.intentEpoch,
    })).resolves.toBeNull();
  });

  it("default drain executor runs the existing conversation turn service", async () => {
    const service = createQueueTestService();
    const project = await service.createProject({ title: "M60 默认 executor" });
    const teacherMessage = await service.addMessage(project.id, { role: "teacher", content: "你好" });
    await service.enqueueConversationTurn(project.id, { teacherMessageId: teacherMessage.id });

    const drainResult = await drainProjectConversationQueue(project.id, {
      service,
      runtime: new FixtureAgentRuntime(),
      agent: createQueueAgentFixture(),
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
    const taskBrief = createTaskBrief({
      taskId: `task:${teacherMessage.id}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: teacherMessage.content,
      requestedOutputs: ["ppt"],
      constraints: ["PPT样张"],
      excludedOutputs: [],
      generationIntensity: "enhanced",
      sourceMessageId: teacherMessage.id,
    });
    const intentGrant: IntentGrant = {
      schemaVersion: "intent-grant.v1",
      taskId: taskBrief.taskId,
      projectId: project.id,
      intentEpoch: taskBrief.intentEpoch,
      standardWorkAuthorized: true,
      intensity: "enhanced",
      budgetPolicyVersion: "v1-standard-task-scope.v1",
      maxCostCredits: null,
      maxExternalProviderCalls: 2,
      requiredCheckpoints: [],
      expiresAt: null,
    };
    await service.updateMessageMetadata(project.id, teacherMessage.id, { taskBrief, intentGrant });
    await createControlPlaneStore().upsertTaskAggregate({
      taskBrief,
      intentGrant,
      plan: { planId: `plan:${taskBrief.taskId}`, revision: 0, status: "active" },
      status: "active",
      checkpoint: null,
    });
    const outline = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft", kind: "ppt_draft", title: "可信 PPT 大纲", status: "needs_review",
      summary: "已通过内部校验，可供 Director 审查。", markdownContent: "# PPT 大纲",
      structuredContent: { artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" } },
    });
    await service.approveArtifact(project.id, outline.id);
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
      async intakeTask(input: { userMessage: string }) {
        return {
          kind: "task" as const,
          proposal: {
            goal: input.userMessage,
            requestedOutputs: ["ppt"],
            constraints: ["PPT样张"],
            excludedOutputs: [],
          },
        };
      },
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
      runtime: new FixtureAgentRuntime(),
      agent,
      agentToolExecutor,
      workerId: "v1-3-worker",
    });

    expect(result).toMatchObject({ started: 1, succeeded: 0, blocked: 1, failed: 0 });
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

function createQueueAgentFixture(options: {
  requestedOutputs?: TaskRequestedOutput[];
  toolCall?: { toolName: string; arguments: Record<string, unknown> };
} = {}): MainConversationAgent {
  return {
    async intakeTask(input) {
      if (!options.requestedOutputs && /^(?:你好|您好)[！!。.]?$/.test(input.userMessage.trim())) {
        return {
          kind: "conversation",
          turn: {
            assistantMessage: { body: "小酷在这里，今天想准备哪节课？" },
            state: "chatting",
            quickReplies: [],
            recommendedOptions: [],
            shouldRunToolNow: false,
            runtimeKind: "openai",
          },
        };
      }
      return {
        kind: "task",
        proposal: {
          goal: input.userMessage,
          requestedOutputs: options.requestedOutputs ?? ["requirement_spec"],
          constraints: [],
          excludedOutputs: [],
        },
      };
    },
    async respond(input) {
      if (options.toolCall) {
        if (!input.agentToolLoop) throw new Error("Queue Agent fixture requires the native Agent Tool loop.");
        const dispatched = await input.agentToolLoop.dispatch({
          callId: `queue-fixture:${crypto.randomUUID()}`,
          ...options.toolCall,
        });
        if (dispatched.status !== "succeeded") {
          throw new Error(`Queue Agent fixture Tool failed: ${dispatched.status}`);
        }
      }
      return {
        assistantMessage: { body: "小酷已读取当前任务状态。" },
        state: "chatting",
        quickReplies: [],
        recommendedOptions: [],
        shouldRunToolNow: false,
        runtimeKind: "openai",
      };
    },
  };
}

async function seedPendingDecision(
  service: ReturnType<typeof createWorkbenchService>,
  projectId: string,
  teacherRequest: string,
) {
  const project = await service.getProject(projectId);
  const source = await service.addMessage(projectId, { role: "teacher", content: teacherRequest });
  const taskBrief = createTaskBrief({
    taskId: `task:${source.id}`,
    projectId,
    intentEpoch: project.intentEpoch ?? 0,
    goal: teacherRequest,
    requestedOutputs: ["ppt_outline"],
    constraints: [],
    excludedOutputs: [],
    generationIntensity: "standard",
    sourceMessageId: source.id,
  });
  const intentGrant: IntentGrant = {
    schemaVersion: "intent-grant.v1",
    taskId: taskBrief.taskId,
    projectId,
    intentEpoch: taskBrief.intentEpoch,
    standardWorkAuthorized: true,
    intensity: "standard",
    budgetPolicyVersion: "v1-standard-task-scope.v1",
    maxCostCredits: null,
    maxExternalProviderCalls: 2,
    requiredCheckpoints: [],
    expiresAt: null,
  };
  const plan = {
    planId: `plan:${taskBrief.taskId}`,
    revision: 0,
    status: "paused_recovery",
  };
  const decision: PendingDecision = {
    schemaVersion: "pending-decision.v1",
    decisionId: `decision:${crypto.randomUUID()}`,
    status: "pending",
    kind: "material_choice",
    reasonCode: "material_choice_required",
    question: "是否按当前范围继续？",
    impactSummary: "确认只恢复当前任务，不授权范围外工作。",
    options: [
      { id: "confirm", label: "确认继续", recommended: true },
      { id: "cancel", label: "暂不继续", recommended: false },
    ],
    actorUserId: "local-test-user",
    projectId,
    taskId: taskBrief.taskId,
    intentEpoch: taskBrief.intentEpoch,
    planId: plan.planId,
    actionId: `action:${crypto.randomUUID()}`,
    budgetPolicyVersion: intentGrant.budgetPolicyVersion,
    maxCostCredits: intentGrant.maxCostCredits,
    maxExternalProviderCalls: intentGrant.maxExternalProviderCalls,
    expiresAt: null,
  };
  await service.updateMessageMetadata(projectId, source.id, { taskBrief, intentGrant });
  const decisionMessage = await service.addMessage(projectId, {
    role: "assistant",
    content: `${decision.question}\n\n${decision.impactSummary}`,
    metadata: { pendingDecision: decision },
  });
  const store = createControlPlaneStore();
  await store.upsertTaskAggregate({
    taskBrief,
    intentGrant,
    plan,
    status: "paused_recovery",
    checkpoint: null,
  });
  await store.saveSemanticSnapshot(buildSemanticContextSnapshot({
    taskBrief,
    plan,
    pendingDecision: decision,
    trustedArtifactRefs: [],
    observationRefs: [],
    recentMessages: [
      { role: "teacher", content: source.content },
      { role: "assistant", content: decisionMessage.content },
    ],
  }), 0);
  return { source, taskBrief, intentGrant, decision, decisionMessage, store };
}

async function getLatestPendingActionId(service: ReturnType<typeof createWorkbenchService>, projectId: string) {
  const messages = await service.getMessages(projectId);
  const pendingMessage = [...messages].reverse().find((message) => pendingDecisionOf(message).status === "pending");
  return String(pendingDecisionOf(pendingMessage).actionId ?? "");
}

function pendingDecisionOf(message?: { metadata: Record<string, unknown> }) {
  return (message?.metadata.pendingDecision ?? {}) as Partial<PendingDecision>;
}
