import { describe, expect, it } from "vitest";
import type { GptFunctionCall } from "@/server/gpt-protocol/types";
import { createToolCallIntent } from "@/server/gpt-protocol/tool-call-intent";

describe("ToolCallIntent", () => {
  const forbiddenTeacherIntentControlPattern =
    /\b(?:projectId|artifactRefs|sourceMessageId|provider|capabilityId|toolId|nodeKey|schema|baseURL|apiKey|token|secret)\b/i;

  it("maps an allowlisted function_call to a ready teacher-safe intent", () => {
    const call: GptFunctionCall = {
      callId: "call_create_slides_1",
      name: "createSlides",
      argumentsText: JSON.stringify({
        userInstruction: "请生成水循环课件。",
        teacherIntent: "面向四年级讲清蒸发、凝结、降水。",
        notes: "课堂导入要轻量。",
        projectId: "forged-project",
        artifactRefs: ["forged-artifact"],
        sourceMessageId: "forged-message",
        provider: "external-provider",
        capabilityId: "coze_ppt",
        toolId: "internal-tool-id",
        nodeKey: "lesson_plan",
        schema: { debug: true },
        baseURL: "https://secret.example/v1",
        apiKey: "sk-secret",
        token: "secret-token",
      }),
      argumentsJsonParseStatus: "parsed",
      argumentsJson: {
        userInstruction: "请生成水循环课件。",
        teacherIntent: "面向四年级讲清蒸发、凝结、降水。",
        notes: "课堂导入要轻量。",
        projectId: "forged-project",
        artifactRefs: ["forged-artifact"],
        sourceMessageId: "forged-message",
        provider: "external-provider",
        capabilityId: "coze_ppt",
        toolId: "internal-tool-id",
        nodeKey: "lesson_plan",
        schema: { debug: true },
        baseURL: "https://secret.example/v1",
        apiKey: "sk-secret",
        token: "secret-token",
      },
    };

    const intent = createToolCallIntent(call, { allowedToolNames: ["createSlides"] });
    const intentText = JSON.stringify(intent);

    expect(intent).toMatchObject({
      toolName: "createSlides",
      callId: "call_create_slides_1",
      status: "ready",
      teacherIntent: {
        userInstruction: "请生成水循环课件。",
        teacherIntent: "面向四年级讲清蒸发、凝结、降水。",
        notes: "课堂导入要轻量。",
      },
    });
    expect(Object.keys(intent.teacherIntent ?? {})).toEqual(["userInstruction", "teacherIntent", "notes"]);
    expect(intentText).not.toContain("forged-project");
    expect(intentText).not.toContain("forged-artifact");
    expect(intentText).not.toContain("forged-message");
    expect(intentText).not.toContain("external-provider");
    expect(intentText).not.toContain("coze_ppt");
    expect(intentText).not.toContain("internal-tool-id");
    expect(intentText).not.toContain("lesson_plan");
    expect(intentText).not.toContain("schema");
    expect(intentText).not.toContain("secret.example");
    expect(intentText).not.toContain("sk-secret");
    expect(intentText).not.toContain("secret-token");
  });

  it("marks unknown tools as unsupported without preserving arguments", () => {
    const intent = createToolCallIntent(
      {
        callId: "call_unknown",
        name: "deleteProject",
        argumentsText: JSON.stringify({ userInstruction: "删除项目", projectId: "project-a" }),
        argumentsJsonParseStatus: "parsed",
        argumentsJson: { userInstruction: "删除项目", projectId: "project-a" },
      },
      { allowedToolNames: ["createSlides"] },
    );

    expect(intent).toMatchObject({
      toolName: "deleteProject",
      callId: "call_unknown",
      status: "unsupported",
    });
    expect(intent).not.toHaveProperty("teacherIntent");
    expect(JSON.stringify(intent)).not.toContain("project-a");
    expect(JSON.stringify(intent)).not.toContain("删除项目");
  });

  it("marks invalid or missing JSON arguments as invalid_arguments without throwing or leaking raw text", () => {
    const invalidIntent = createToolCallIntent(
      {
        callId: "call_invalid",
        name: "createSlides",
        argumentsText: "{ projectId: 'forged-project', token: 'secret-token' ",
        argumentsJsonParseStatus: "invalid_json",
      },
      { allowedToolNames: ["createSlides"] },
    );
    const missingIntent = createToolCallIntent(
      {
        callId: "call_missing",
        name: "createSlides",
        argumentsText: "",
        argumentsJsonParseStatus: "missing",
      },
      { allowedToolNames: ["createSlides"] },
    );

    expect(invalidIntent.status).toBe("invalid_arguments");
    expect(missingIntent.status).toBe("invalid_arguments");
    expect(JSON.stringify(invalidIntent)).not.toContain("forged-project");
    expect(JSON.stringify(invalidIntent)).not.toContain("secret-token");
    expect(invalidIntent).not.toHaveProperty("teacherIntent");
    expect(missingIntent).not.toHaveProperty("teacherIntent");
  });

  it("redacts sensitive values from otherwise allowed teacher semantic fields", () => {
    const intent = createToolCallIntent(
      {
        callId: "call_sensitive_notes",
        name: "createSlides",
        argumentsText: JSON.stringify({
          userInstruction: "请生成课件 token=abc123 baseURL=https://secret.example/v1 C:\\Users\\HB\\secret.txt",
          notes: "Bearer secret-token API_KEY=sk-secret",
        }),
        argumentsJsonParseStatus: "parsed",
        argumentsJson: {
          userInstruction: "请生成课件 token=abc123 baseURL=https://secret.example/v1 C:\\Users\\HB\\secret.txt",
          notes: "Bearer secret-token API_KEY=sk-secret",
        },
      },
      { allowedToolNames: ["createSlides"] },
    );
    const intentText = JSON.stringify(intent);

    expect(intent.status).toBe("ready");
    expect(intentText).not.toContain("abc123");
    expect(intentText).not.toContain("secret.example");
    expect(intentText).not.toContain("C:\\Users\\HB");
    expect(intentText).not.toContain("secret-token");
    expect(intentText).not.toContain("sk-secret");
  });

  it("redacts forged internal control field names embedded in allowed teacher semantic fields", () => {
    const intent = createToolCallIntent(
      {
        callId: "call_forged_semantic_fields",
        name: "createSlides",
        argumentsText: JSON.stringify({
          userInstruction: "请生成课件 projectId=forged-project provider=external-provider schema={debug:true} sourceMessageId=message-a",
          teacherIntent: "artifactRefs=[artifact-a] capabilityId=coze_ppt toolId=internal-tool nodeKey=slide_deck",
          notes: "baseURL=https://secret.example/v1 apiKey=sk-secret token=abc123 secret=hidden",
        }),
        argumentsJsonParseStatus: "parsed",
        argumentsJson: {
          userInstruction: "请生成课件 projectId=forged-project provider=external-provider schema={debug:true} sourceMessageId=message-a",
          teacherIntent: "artifactRefs=[artifact-a] capabilityId=coze_ppt toolId=internal-tool nodeKey=slide_deck",
          notes: "baseURL=https://secret.example/v1 apiKey=sk-secret token=abc123 secret=hidden",
        },
      },
      { allowedToolNames: ["createSlides"] },
    );
    const intentText = JSON.stringify(intent);

    expect(intent.status).toBe("ready");
    expect(intentText).not.toMatch(forbiddenTeacherIntentControlPattern);
    expect(intentText).not.toContain("forged-project");
    expect(intentText).not.toContain("external-provider");
    expect(intentText).not.toContain("message-a");
    expect(intentText).not.toContain("artifact-a");
    expect(intentText).not.toContain("coze_ppt");
    expect(intentText).not.toContain("internal-tool");
    expect(intentText).not.toContain("slide_deck");
    expect(intentText).not.toContain("secret.example");
    expect(intentText).not.toContain("sk-secret");
    expect(intentText).not.toContain("abc123");
    expect(intentText).not.toContain("hidden");
  });
});
