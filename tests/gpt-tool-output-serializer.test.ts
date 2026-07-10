import { describe, expect, it } from "vitest";
import { createToolObservation } from "@/server/capabilities/tool-observation";
import { buildAgentHarnessBudgetEvent } from "@/server/conversation/agent-harness-budget";
import { serializeToolExecutionResultForFunctionCallOutput } from "@/server/gpt-protocol/tool-output-serializer";
import type { ToolExecutionResult } from "@/server/tools/tool-types";

const forbiddenOutputPattern =
  /projectId|sourceMessageId|artifactRefs|runtimeKind|providerStatus|placeholder|function_call|capabilityId|toolId|artifactKind|nodeKey|provider|providerPayload|schema|debug|local path|\bAPI\b|baseURL|token|api[_-]?key|OPENAI_API_KEY|secret|credential|Bearer\s+\S+|localOutput|sha256|https?:\/\/|file:\/\/|[A-Z]:\\|Secret Folder|secret file|\/Users\/|sk-secret|abc123|secret-token|create_lesson_plan|generate_video_segment/i;
const bareUrlPattern = /\burl\b/i;

describe("Tool output serializer", () => {
  it("serializes succeeded results into teacher semantic function_call_output JSON only", () => {
    const result: ToolExecutionResult = {
      status: "succeeded",
      toolId: "tool-create-slides",
      capabilityId: "coze_ppt",
      provider: "external-provider",
      artifactDraft: {
        nodeKey: "slide_deck",
        kind: "pptx",
        title: "水循环课件",
        summary: "provider schema debug local path C:\\Users\\HB\\secret.pptx",
        markdownContent: "# 水循环课件\nprojectId=project-a sourceMessageId=message-a artifactRefs=[] runtimeKind=openai providerStatus=real placeholder=false function_call create_lesson_plan generate_video_segment",
        structuredContent: {
          localOutput: "C:\\Users\\HB\\secret.pptx",
          sha256: "abc123",
        },
      },
      artifactTruth: {
        created: true,
        persisted: true,
        persistenceScope: "provider_local_file",
        providerPersisted: true,
        placeholder: false,
        producedArtifactKind: "pptx",
      },
      providerPayload: {
        baseURL: "https://secret.example/v1",
        token: "secret-token",
        localOutput: "C:\\Users\\HB\\secret.pptx",
        sha256: "abc123",
      },
      assistantSummary: "课件已生成，可供老师检查。provider debug API token=abc123 C:\\Users\\HB\\secret.pptx",
      budgetEvent: buildAgentHarnessBudgetEvent({ capabilityId: "coze_ppt", status: "succeeded", kind: "tool_succeeded" }),
    };

    const output = serializeToolExecutionResultForFunctionCallOutput(result, { artifactTitle: "水循环课件" });
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed).toEqual({
      statusLabel: "succeeded",
      teacherSafeSummary: expect.stringContaining("课件已生成"),
      nextActionLabel: "review_artifact",
      artifactTitle: "水循环课件",
      artifactMarkdown: expect.stringContaining("水循环课件"),
      artifactReadyForReview: true,
    });
    expect(output).not.toMatch(forbiddenOutputPattern);
  });

  it("serializes needs_input results without internal observation details", () => {
    const result: ToolExecutionResult = {
      status: "needs_input",
      toolId: "tool-create-slides",
      capabilityId: "coze_ppt",
      provider: "external-provider",
      missingInputs: ["grade", "topic"],
      assistantPrompt: "还需要年级和主题。provider debug API token=abc123 https://secret.example/v1",
      observation: createToolObservation({
        projectId: "project-a",
        sourceMessageId: "message-a",
        capabilityId: "coze_ppt",
        expectedArtifactKind: "pptx",
        kind: "blocked_by_policy",
        teacherSafeSummary: "需要补充输入 token=abc123 C:\\Users\\HB\\secret.txt",
        internalReasonSanitized: "provider debug baseURL=https://secret.example/v1",
      }),
      artifactCreated: false,
      budgetEvent: buildAgentHarnessBudgetEvent({ capabilityId: "coze_ppt", status: "blocked", kind: "blocked_by_policy" }),
    };

    const output = serializeToolExecutionResultForFunctionCallOutput(result);
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed).toEqual({
      statusLabel: "needs_input",
      teacherSafeSummary: expect.stringContaining("还需要年级和主题"),
      nextActionLabel: "ask_teacher_for_input",
      artifactReadyForReview: false,
    });
    expect(output).not.toMatch(forbiddenOutputPattern);
    expect(output).not.toContain("project-a");
    expect(output).not.toContain("message-a");
    expect(output).not.toContain("grade");
    expect(output).not.toContain("topic");
  });

  it("serializes failed results using only the teacher-safe observation summary", () => {
    const result: ToolExecutionResult = {
      status: "failed",
      toolId: "tool-create-slides",
      capabilityId: "coze_ppt",
      provider: "external-provider",
      observation: createToolObservation({
        projectId: "project-a",
        sourceMessageId: "message-a",
        capabilityId: "coze_ppt",
        expectedArtifactKind: "pptx",
        kind: "tool_failed",
        teacherSafeSummary: "这一步暂时没有完成，可以调整要求后重试。",
        internalReasonSanitized: "providerPayload token=secret-token localOutput=C:\\Users\\HB\\secret.pptx",
      }),
      artifactCreated: false,
      errorCategory: "provider",
      budgetEvent: buildAgentHarnessBudgetEvent({ capabilityId: "coze_ppt", status: "failed", kind: "tool_failed" }),
    };

    const output = serializeToolExecutionResultForFunctionCallOutput(result);
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed).toEqual({
      statusLabel: "failed",
      teacherSafeSummary: "这一步暂时没有完成，可以调整要求后重试。",
      nextActionLabel: "adjust_or_retry",
      artifactReadyForReview: false,
    });
    expect(output).not.toMatch(forbiddenOutputPattern);
    expect(output).not.toContain("project-a");
    expect(output).not.toContain("message-a");
  });

  it("serializes retryable_failed results as safe retry guidance", () => {
    const result: ToolExecutionResult = {
      status: "retryable_failed",
      toolId: "tool-create-slides",
      capabilityId: "coze_ppt",
      provider: "external-provider",
      observation: createToolObservation({
        projectId: "project-a",
        capabilityId: "coze_ppt",
        expectedArtifactKind: "pptx",
        kind: "provider_unavailable",
        teacherSafeSummary: "生成服务暂时繁忙，可以稍后再试。token=abc123 https://secret.example/v1",
        internalReasonSanitized: "Bearer secret-token baseURL=https://secret.example/v1 sha256=abc123",
      }),
      artifactCreated: false,
      errorCategory: "provider",
      budgetEvent: buildAgentHarnessBudgetEvent({ capabilityId: "coze_ppt", status: "retryable_failed", kind: "provider_unavailable" }),
    };

    const output = serializeToolExecutionResultForFunctionCallOutput(result);
    const parsed = JSON.parse(output) as Record<string, unknown>;

    expect(parsed).toEqual({
      statusLabel: "retryable_failed",
      teacherSafeSummary: expect.stringContaining("生成服务暂时繁忙"),
      nextActionLabel: "retry_later",
      artifactReadyForReview: false,
    });
    expect(output).not.toMatch(forbiddenOutputPattern);
  });

  it("redacts bare url labels from assistant summary, artifact title, and observation summaries", () => {
    const succeededResult: ToolExecutionResult = {
      status: "succeeded",
      toolId: "tool-create-slides",
      capabilityId: "coze_ppt",
      provider: "external-provider",
      artifactDraft: {
        nodeKey: "slide_deck",
        kind: "pptx",
        title: "url",
        summary: "done",
        structuredContent: {},
      },
      artifactTruth: {
        created: true,
        persisted: true,
        persistenceScope: "provider_local_file",
        providerPersisted: true,
        placeholder: false,
        producedArtifactKind: "pptx",
      },
      providerPayload: {},
      assistantSummary: "课件已生成 url=https://secret.example/v1 URL: https://secret.example/teacher 还有裸 url 标签。",
      budgetEvent: buildAgentHarnessBudgetEvent({ capabilityId: "coze_ppt", status: "succeeded", kind: "tool_succeeded" }),
    };
    const failedResult: ToolExecutionResult = {
      status: "failed",
      toolId: "tool-create-slides",
      capabilityId: "coze_ppt",
      provider: "external-provider",
      observation: createToolObservation({
        projectId: "project-a",
        capabilityId: "coze_ppt",
        expectedArtifactKind: "pptx",
        kind: "tool_failed",
        teacherSafeSummary: "观察到 URL: https://secret.example/fail 和 url 标签，需要重试。",
        internalReasonSanitized: "hidden",
      }),
      artifactCreated: false,
      errorCategory: "provider",
      budgetEvent: buildAgentHarnessBudgetEvent({ capabilityId: "coze_ppt", status: "failed", kind: "tool_failed" }),
    };

    const succeededOutput = serializeToolExecutionResultForFunctionCallOutput(succeededResult, { artifactTitle: "复习资料 url=https://secret.example/title" });
    const failedOutput = serializeToolExecutionResultForFunctionCallOutput(failedResult);

    expect(succeededOutput).not.toMatch(bareUrlPattern);
    expect(failedOutput).not.toMatch(bareUrlPattern);
    expect(succeededOutput).not.toMatch(/https?:\/\//i);
    expect(failedOutput).not.toMatch(/https?:\/\//i);
  });

  it("redacts spaced API key labels and unquoted local paths with spaces from artifact markdown", () => {
    const result: ToolExecutionResult = {
      status: "succeeded",
      toolId: "tool-create-slides",
      capabilityId: "coze_ppt",
      artifactDraft: {
        nodeKey: "slide_deck",
        kind: "pptx",
        title: "水循环课件",
        summary: "done",
        markdownContent: "API key: sk-secret-value OPENAI_API_KEY=sk-another-secret C:\\Users\\HB\\Secret Folder\\secret file.pdf",
      },
      assistantSummary: "课件已生成。",
      budgetEvent: buildAgentHarnessBudgetEvent({ capabilityId: "coze_ppt", status: "succeeded", kind: "tool_succeeded" }),
    };

    const output = serializeToolExecutionResultForFunctionCallOutput(result);

    expect(output).not.toMatch(forbiddenOutputPattern);
  });
});
