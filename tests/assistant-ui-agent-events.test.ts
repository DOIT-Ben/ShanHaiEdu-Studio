import { describe, expect, it } from "vitest";

import {
  appendTeacherAgentEvent,
  mergeTeacherAgentEventsIntoMessages,
  parseTeacherAgentEvent,
  projectTeacherAgentEvent,
  teacherAgentEventToActivityPart,
} from "@/lib/teacher-agent-events";
import { normalizeSnapshot } from "@/lib/workbench-mappers";
import { AGENT_EVENT_VERSION, type AgentEventEnvelope } from "@/server/conversation/agent-event-envelope";

describe("assistant-ui teacher event projection", () => {
  it("does not project internal control facts into the teacher event stream", () => {
    const projected = projectTeacherAgentEvent(event({
      kind: "tool_observed",
      visibility: "internal",
      payload: {
        observationId: "observation-1",
        status: "failed",
        toolName: "create_ppt_outline",
        provider: "private-provider",
        apiKey: "secret",
        localPath: "C:\\secret\\result.json",
      },
    }));

    expect(projected).toBeNull();
  });

  it("projects an explicitly teacher-visible Tool step without exposing raw payload", () => {
    const projected = projectTeacherAgentEvent(event({
      kind: "tool_observed",
      visibility: "teacher",
      payload: {
        activityId: "tool-step-1",
        label: "PPT 大纲未完成，已保存失败位置",
        observationId: "observation-1",
        status: "failed",
        reasonCode: "ppt_outline_validation_failed",
        artifactRefs: [{ artifactId: "artifact-outline-1" }],
        provider: "private-provider",
      },
    }));
    expect(projected).toMatchObject({
      projectId: "project-a",
      runId: "turn:message-teacher-1",
      sequence: 1,
      visibility: "teacher",
      payload: {
        activity: {
          activityId: "tool-step-1",
          label: "PPT 大纲未完成，已保存失败位置",
          status: "failed",
          evidenceRefs: ["observation-1"],
          reasonCode: "ppt_outline_validation_failed",
          artifactRefs: ["artifact-outline-1"],
        },
      },
    });
    expect(JSON.stringify(projected)).not.toMatch(/provider|apiKey|localPath|secret/i);
    expect(teacherAgentEventToActivityPart(projected!)).toMatchObject({
      type: "activity",
      activityId: "tool-step-1",
      status: "failed",
      reasonCode: "ppt_outline_validation_failed",
      artifactRefs: ["artifact-outline-1"],
    });
  });

  it("projects real Tool purpose, trusted inputs, expected output and elapsed time without exposing raw arguments", () => {
    const projected = projectTeacherAgentEvent(event({
      kind: "tool_started",
      visibility: "teacher",
      occurredAt: "2026-07-15T00:00:00.000Z",
      payload: {
        activityId: "tool-step-detail",
        label: "正在生成 PPT 大纲",
        status: "running",
        purpose: "形成可供逐页设计继续使用的课堂结构",
        inputSummary: ["任务：认识百分数PPT", "依据：已生成的需求规格说明"],
        expectedOutput: "约12页的逐页PPT大纲",
        startedAt: "2026-07-15T00:00:00.000Z",
        rawArguments: { provider: "private", apiKey: "secret" },
      },
    }));

    expect(teacherAgentEventToActivityPart(projected!)).toMatchObject({
      purpose: "形成可供逐页设计继续使用的课堂结构",
      inputSummary: ["任务：认识百分数PPT", "依据：已生成的需求规格说明"],
      expectedOutput: "约12页的逐页PPT大纲",
      startedAt: "2026-07-15T00:00:00.000Z",
    });
    expect(JSON.stringify(projected)).not.toMatch(/rawArguments|provider|apiKey|secret/i);
  });

  it("keeps internal control vocabulary out of teacher-visible Tool details", () => {
    const projected = projectTeacherAgentEvent(event({
      kind: "tool_started",
      visibility: "teacher",
      payload: {
        activityId: "tool-step-internal-copy",
        label: "正在生成 PPT 设计稿",
        status: "running",
        purpose: "基于当前TaskBrief和Director结果生成候选，失败后读取Observation.reasonCodes。",
        inputSummary: ["ExecutionEnvelope已绑定", "IntentEpoch为当前版本"],
        expectedOutput: "满足schema的下游Artifact",
      },
    }));

    const serialized = JSON.stringify(projected?.payload.activity);
    expect(serialized).not.toMatch(/TaskBrief|ExecutionEnvelope|IntentEpoch|Observation|reasonCodes|Director|schema|Artifact/i);
    expect(projected?.payload.activity).toMatchObject({
      purpose: expect.stringContaining("当前任务说明"),
      inputSummary: expect.arrayContaining([expect.stringContaining("当前执行范围")]),
    });
  });

  it("keeps one concrete failed Tool step instead of adding a generic run failure step", () => {
    const toolFailure = projectTeacherAgentEvent(event({
      eventId: "tool-failure",
      sequence: 1,
      kind: "tool_observed",
      visibility: "teacher",
      payload: { activityId: "tool-1", label: "PPT 大纲未通过结构检查", status: "failed", observationId: "obs-1", reasonCode: "outline_invalid" },
    }))!;
    const runFailure = projectTeacherAgentEvent(event({
      eventId: "run-failure",
      sequence: 2,
      kind: "run_failed",
      visibility: "teacher",
      payload: { label: "智能服务请求未完成", status: "failed", checkpointId: "checkpoint-1", reasonCode: "outline_invalid" },
    }))!;

    const merged = mergeTeacherAgentEventsIntoMessages([
      { id: "message-teacher-1", speaker: "teacher", body: "做PPT" },
    ], [toolFailure, runFailure]);
    const activityParts = merged.at(-1)?.parts?.filter((part) => part.type === "activity") ?? [];

    expect(activityParts).toHaveLength(1);
    expect(activityParts[0]).toMatchObject({ activityId: "tool-1", reasonCode: "outline_invalid" });
  });

  it("keeps completed Tool steps in one ordered progress timeline for the turn", () => {
    const toolStarted = projectTeacherAgentEvent(event({
      eventId: "tool-start",
      sequence: 1,
      kind: "tool_started",
      visibility: "teacher",
      payload: { activityId: "tool-1", label: "正在生成 PPT 大纲", status: "running" },
    }))!;
    const toolObserved = projectTeacherAgentEvent(event({
      eventId: "tool-observed",
      sequence: 2,
      kind: "tool_observed",
      visibility: "teacher",
      payload: { activityId: "tool-1", label: "PPT 大纲已完成，正在判断下一步", status: "succeeded", observationId: "obs-1" },
    }))!;
    const nextTool = projectTeacherAgentEvent(event({
      eventId: "tool-next",
      sequence: 3,
      kind: "tool_started",
      visibility: "teacher",
      payload: { activityId: "tool-2", label: "正在生成 PPT 设计稿", status: "running" },
    }))!;

    const merged = mergeTeacherAgentEventsIntoMessages([
      { id: "message-teacher-1", speaker: "teacher", body: "做一份百分数课件" },
    ], [toolStarted, toolObserved, nextTool]);

    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({
      id: "agent-activity:turn:message-teacher-1",
      projectionKind: "agent-activity",
    });
    expect(merged[1].parts).toEqual([
      expect.objectContaining({ type: "activity", activityId: "tool-1", status: "succeeded" }),
      expect.objectContaining({ type: "activity", activityId: "tool-2", status: "running" }),
    ]);
  });

  it("deduplicates resumed events and rejects cross-project or out-of-order input", () => {
    const first = projectTeacherAgentEvent(event({ eventId: "event-1", sequence: 1 }))!;
    const second = projectTeacherAgentEvent(event({ eventId: "event-2", sequence: 2, kind: "task_updated" }))!;
    const state = appendTeacherAgentEvent(appendTeacherAgentEvent([], first, "project-a"), second, "project-a");

    expect(appendTeacherAgentEvent(state, second, "project-a")).toEqual(state);
    expect(() => appendTeacherAgentEvent(state, { ...second, eventId: "event-3", sequence: 1 }, "project-a")).toThrow(/sequence/i);
    expect(() => appendTeacherAgentEvent(state, { ...second, eventId: "event-4", projectId: "project-b", sequence: 3 }, "project-a")).toThrow(/project/i);
    expect(parseTeacherAgentEvent(JSON.stringify(second), "project-a")).toEqual(second);
  });

  it("keeps completed Tool steps attached to the exact persisted assistant response", () => {
    const running = projectTeacherAgentEvent(event({ kind: "tool_started" }))!;
    const teacherMessage = { id: "message-teacher-1", speaker: "teacher" as const, body: "做一份百分数课件" };
    const withActivity = mergeTeacherAgentEventsIntoMessages([teacherMessage], [running]);

    expect(withActivity).toHaveLength(2);
    expect(withActivity[1]).toMatchObject({
      id: "agent-activity:turn:message-teacher-1",
      speaker: "assistant",
      projectionKind: "agent-activity",
      parts: [expect.objectContaining({ type: "activity", status: "running" })],
    });

    const persisted = {
      id: "message-assistant-1",
      speaker: "assistant" as const,
      body: "已形成课件结构。",
      turnSourceMessageId: teacherMessage.id,
    };
    expect(mergeTeacherAgentEventsIntoMessages([teacherMessage, persisted], [running])).toEqual([
      teacherMessage,
      expect.objectContaining({
        id: persisted.id,
        turnSourceMessageId: teacherMessage.id,
        parts: [
          expect.objectContaining({ type: "activity", status: "running" }),
          expect.objectContaining({ type: "text", text: persisted.body }),
        ],
      }),
    ]);
  });

  it("maps a persisted assistant response to its queue-owned teacher turn", () => {
    const snapshot = normalizeSnapshot({
      project: {
        id: "project-a",
        title: "百分数课件",
        status: "active",
        currentNodeKey: "requirement_spec",
        grade: "五年级",
        subject: "数学",
        textbookVersion: null,
        lessonTopic: "百分数",
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
      },
      messages: [
        {
          id: "message-teacher-1",
          projectId: "project-a",
          role: "teacher",
          content: "做一份百分数课件",
          artifactRefs: [],
          createdAt: "2026-07-16T00:00:00.000Z",
        },
        {
          id: "message-assistant-1",
          projectId: "project-a",
          role: "assistant",
          content: "已形成课件结构。",
          artifactRefs: [],
          createdAt: "2026-07-16T00:01:00.000Z",
        },
      ],
      nodes: [],
      artifacts: [],
      turnJobs: [{
        id: "turn-job-1",
        projectId: "project-a",
        teacherMessageId: "message-teacher-1",
        assistantMessageId: "message-assistant-1",
        status: "succeeded",
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:01:00.000Z",
      }],
    });

    expect(snapshot.messages.find((message) => message.id === "message-assistant-1"))
      .toMatchObject({ turnSourceMessageId: "message-teacher-1" });
  });

  it("merges ordered text events into a plain streaming response instead of a task timeline", () => {
    const events = [
      projectTeacherAgentEvent(event({ eventId: "text-1", sequence: 1, kind: "text_started", visibility: "teacher", payload: { text: "PPT" } }))!,
      projectTeacherAgentEvent(event({ eventId: "text-2", sequence: 2, kind: "text_delta", visibility: "teacher", payload: { text: " outline" } }))!,
      projectTeacherAgentEvent(event({ eventId: "text-3", sequence: 3, kind: "text_completed", visibility: "teacher", payload: {} }))!,
    ];

    const merged = mergeTeacherAgentEventsIntoMessages([
      { id: "message-teacher-1", speaker: "teacher", body: "做一份百分数课件" },
    ], events);

    expect(merged.at(-1)).toMatchObject({
      id: "agent-response:turn:message-teacher-1",
      speaker: "assistant",
      projectionKind: "agent-response",
      body: "PPT outline",
      parts: [
        expect.objectContaining({ type: "text", text: "PPT outline" }),
      ],
    });
  });

  it("does not create a task timeline for response lifecycle events before the first Tool", () => {
    const lifecycle = [
      projectTeacherAgentEvent(event({ eventId: "run-1", sequence: 1, kind: "run_started", visibility: "teacher" }))!,
      projectTeacherAgentEvent(event({ eventId: "text-1", sequence: 2, kind: "text_started", visibility: "teacher", payload: {} }))!,
    ];
    const messages = [{ id: "message-teacher-1", speaker: "teacher" as const, body: "你好" }];

    expect(mergeTeacherAgentEventsIntoMessages(messages, lifecycle)).toEqual(messages);
  });

  it("projects a blocked run terminal as blocked instead of completed", () => {
    const projected = projectTeacherAgentEvent(event({
      kind: "run_failed",
      visibility: "teacher",
      payload: { status: "blocked", checkpointId: "checkpoint-1", label: "PPT 大纲未完成，失败位置已保存" },
    }));

    expect(projected).toMatchObject({
      kind: "run_failed",
      payload: {
        activity: {
          status: "blocked",
          label: "PPT 大纲未完成，失败位置已保存",
          evidenceRefs: ["checkpoint-1"],
        },
      },
    });
  });
});

function event(overrides: Partial<AgentEventEnvelope>): AgentEventEnvelope {
  return {
    schemaVersion: AGENT_EVENT_VERSION,
    eventId: "event-1",
    projectId: "project-a",
    taskId: "task-a",
    runId: "turn:message-teacher-1",
    intentEpoch: 1,
    sequence: 1,
    kind: "tool_observed",
    visibility: "teacher",
    occurredAt: "2026-07-15T00:00:00.000Z",
    payload: { observationId: "observation-1", status: "succeeded" },
    ...overrides,
  };
}
