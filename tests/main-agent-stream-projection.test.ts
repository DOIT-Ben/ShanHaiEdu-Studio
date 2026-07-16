import { describe, expect, it } from "vitest";

import {
  createNaturalLanguageMainAgentStreamProjection,
  createStructuredMainAgentStreamProjection,
} from "@/server/conversation/main-agent-stream-projection";
import type { GptProtocolStreamEvent } from "@/server/gpt-protocol/types";

describe("Main Agent stream projection", () => {
  it("streams ordinary teacher-facing text without waiting for a JSON field", async () => {
    const visible: string[] = [];
    const project = createNaturalLanguageMainAgentStreamProjection((event) => {
      if (event.type === "text_delta") visible.push(event.delta);
    });

    await project({ type: "response_started", responseId: "resp_1" });
    await project({ type: "text_delta", delta: "你好，" });
    await project({ type: "text_delta", delta: "我先了解你要准备哪节课。" });

    expect(visible).toEqual(["你好，", "我先了解你要准备哪节课。"]);
    expect(visible.join("")).toBe("你好，我先了解你要准备哪节课。");
  });

  it("emits only the teacher-visible assistant body while structured JSON is still arriving", async () => {
    const visible: string[] = [];
    const project = createStructuredMainAgentStreamProjection((event) => {
      if (event.type === "text_delta") visible.push(event.delta);
    });

    await project({ type: "text_delta", delta: '{"assistantMessage":{"title":null,"bo' });
    await project({ type: "text_delta", delta: 'dy":"你好，' });
    await project({ type: "text_delta", delta: '我可以帮你准备\\n公开课。"},"state":"chatting"}' });

    expect(visible.join("")).toBe("你好，我可以帮你准备\n公开课。");
    expect(visible.join("")).not.toContain("assistantMessage");
    expect(visible.join("")).not.toContain("state");
  });

  it("never projects function-call argument deltas", async () => {
    const projected: string[] = [];
    const project = createNaturalLanguageMainAgentStreamProjection((event) => { projected.push(event.type); });
    await project({
      type: "function_call_arguments_delta",
      itemId: "fc_1",
      delta: '{"teacherGoal":"百分数"}',
    });
    expect(projected).toEqual([]);
  });

  it("forwards cache and latency telemetry only at completion", async () => {
    const projected: unknown[] = [];
    const project = createStructuredMainAgentStreamProjection((event) => { projected.push(event); });
    const completion: GptProtocolStreamEvent = {
      type: "response_completed",
      responseId: "resp_1",
      usage: { inputTokens: 1200, outputTokens: 20, totalTokens: 1220, cachedTokens: 1024, cacheWriteTokens: 128 },
      telemetry: {
        streamed: true,
        startedAt: "2026-07-16T00:00:00.000Z",
        firstEventAt: "2026-07-16T00:00:00.100Z",
        completedAt: "2026-07-16T00:00:01.000Z",
        timeToFirstEventMs: 100,
        durationMs: 1000,
        chunkCount: 4,
        textBytes: 80,
      },
    };
    await project(completion);
    expect(projected).toEqual([expect.objectContaining({
      type: "response_completed",
      usage: expect.objectContaining({ cachedTokens: 1024 }),
      telemetry: expect.objectContaining({ timeToFirstEventMs: 100, chunkCount: 4 }),
    })]);
  });
});
