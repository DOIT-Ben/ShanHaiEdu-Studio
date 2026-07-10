import { describe, expect, it } from "vitest";
import {
  appendToolObservationMetadata,
  createToolObservation,
  readActiveToolObservationsFromMessages,
  readToolObservationsFromMetadata,
} from "@/server/capabilities/tool-observation";

const forbiddenTeacherText =
  /schema|provider|storage|debug|local path|token|api_key|secret|credential|bearer\s+\S+|[A-Z]:\\|\/Users\/|file:\/\//i;

describe("ToolObservation", () => {
  it("creates a stable observation record with fixed fields and default retry policy", () => {
    const observation = createToolObservation({
      projectId: "project-a",
      turnId: "turn-a",
      jobId: "job-a",
      sourceMessageId: "message-a",
      capabilityId: "coze_ppt",
      expectedArtifactKind: "pptx",
      kind: "provider_unavailable",
      teacherSafeSummary: "PPT 服务暂时不可用，可以稍后重试。",
      internalReasonSanitized: "provider timeout",
    });

    expect(observation).toMatchObject({
      projectId: "project-a",
      turnId: "turn-a",
      jobId: "job-a",
      sourceMessageId: "message-a",
      capabilityId: "coze_ppt",
      expectedArtifactKind: "pptx",
      kind: "provider_unavailable",
      status: "active",
      retryPolicy: {
        retryable: true,
        nextAction: "wait_for_provider",
      },
      artifactCreated: false,
      dedupeKey: "project-a:coze_ppt:provider_unavailable:pptx",
    });
    expect(observation.observationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(Date.parse(observation.createdAt)).not.toBeNaN();
  });

  it("redacts teacher summary and internal reason without leaking engineering words, paths, or secrets", () => {
    const observation = createToolObservation({
      projectId: "project-a",
      capabilityId: "image_asset",
      kind: "tool_failed",
      teacherSafeSummary:
        "provider debug schema storage local path C:\\Users\\TestUser\\secret\\file.png file:///tmp/a.png /Users/test-user/.config/app token=abc API_KEY=sk-secret SECRET=raw credential=pass Bearer abc.def https://example.test/callback?token=abc&api_key=def&secret=ghi",
      internalReasonSanitized:
        "debug provider schema storage local path D:\\work\\data.json file:///var/tmp/x /var/log/app.log token xyz API_KEY abc SECRET def credential ghi Bearer secret-token https://service.test/run?key=value&secret=abc",
    });

    expect(observation.teacherSafeSummary).not.toMatch(forbiddenTeacherText);
    expect(observation.internalReasonSanitized).not.toMatch(forbiddenTeacherText);
  });

  it("redacts standalone API wording from teacher-visible observation text", () => {
    const observation = createToolObservation({
      projectId: "project-a",
      capabilityId: "coze_ppt",
      kind: "tool_failed",
      teacherSafeSummary: "API 返回错误，真实 PPTX 没有生成成功。",
      internalReasonSanitized: "API call failed",
    });

    expect(observation.teacherSafeSummary).not.toMatch(/\bapi\b/i);
    expect(observation.internalReasonSanitized).not.toMatch(/\bapi\b/i);
  });

  it("redacts provider/capability/runtime and common secret variants from model-facing reasons", () => {
    const observation = createToolObservation({
      projectId: "project-a",
      capabilityId: "coze_ppt",
      kind: "provider_unavailable",
      teacherSafeSummary: "这项生成能力暂时不可用。",
      internalReasonSanitized: "status=provider_unavailable; capability=coze_ppt; providerMode=external; runtime_kind=openai; access_token=abc refreshToken=def apiKey=ghi client_secret=jkl path=C:\\Users\\HB\\My Documents\\secret.txt",
    });

    expect(observation.internalReasonSanitized).not.toMatch(/provider|capability|runtime|access_token|refreshToken|apiKey|client_secret|coze_ppt|external|abc|def|ghi|jkl|C:\\|My Documents/i);
  });

  it("appends and reads observations from metadata while preserving unrelated metadata", () => {
    const observation = createToolObservation({
      projectId: "project-a",
      capabilityId: "lesson_plan",
      kind: "quality_gate_failed",
      teacherSafeSummary: "需要先补充教学目标。",
      internalReasonSanitized: "quality gate failed",
    });

    const metadata = appendToolObservationMetadata({ pendingDeliveryPlan: { status: "waiting" } }, observation);

    expect(metadata.pendingDeliveryPlan).toEqual({ status: "waiting" });
    expect(readToolObservationsFromMetadata(metadata)).toEqual([observation]);
    expect(readToolObservationsFromMetadata(undefined)).toEqual([]);
    expect(readToolObservationsFromMetadata(null)).toEqual([]);
    expect(readToolObservationsFromMetadata({ toolObservations: "bad" })).toEqual([]);
  });

  it("reads only active observations from messages and ignores bad metadata", () => {
    const active = createToolObservation({
      projectId: "project-a",
      capabilityId: "coze_ppt",
      kind: "retry_exhausted",
      teacherSafeSummary: "已达到自动重试上限，需要改走人工处理。",
      internalReasonSanitized: "retry exhausted",
    });
    const resolved = { ...active, observationId: "resolved-observation", status: "resolved" as const };
    const superseded = { ...active, observationId: "superseded-observation", status: "superseded" as const };

    const messages = [
      { id: "message-a", metadata: appendToolObservationMetadata(undefined, active) },
      { id: "message-b", metadata: appendToolObservationMetadata(undefined, resolved) },
      { id: "message-c", metadata: appendToolObservationMetadata(undefined, superseded) },
      { id: "message-d", metadata: { toolObservations: [{ status: "active" }] } },
      { id: "message-e", metadata: null },
      { id: "message-f" },
    ];

    expect(readActiveToolObservationsFromMessages(messages)).toEqual([active]);
  });
});
