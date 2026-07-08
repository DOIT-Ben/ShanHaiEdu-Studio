import { describe, expect, it } from "vitest";
import { normalizeCapabilityRunResult, runCapabilityWithAgentRuntime } from "@/server/capabilities/capability-runner";
import type { AgentRuntime } from "@/server/agent-runtime/types";

describe("M54-B CapabilityRunner contract", () => {
  it("keeps failed tool results failed and user-readable", () => {
    const result = normalizeCapabilityRunResult({
      status: "failed",
      userMessage: "PPT 服务暂时不可用，可以稍后重试。",
      retryable: true,
      errorCategory: "provider",
    });

    expect(result).toMatchObject({
      status: "failed",
      userMessage: "PPT 服务暂时不可用，可以稍后重试。",
      retryable: true,
    });
    expect("artifactDraft" in result).toBe(false);
  });

  it("marks deterministic drafts instead of pretending they are real provider outputs", () => {
    const result = normalizeCapabilityRunResult({
      status: "succeeded",
      artifactDraft: {
        nodeKey: "ppt_draft",
        kind: "ppt_draft",
        title: "PPT 大纲",
        summary: "确定性草稿",
        markdownContent: "# PPT 大纲",
      },
      assistantSummary: "已生成一版可检查的大纲草稿。",
      providerStatus: "deterministic_draft",
    });

    expect(result).toMatchObject({
      status: "succeeded",
      providerStatus: "deterministic_draft",
    });
  });

  it("maps the ppt_outline runtime task into the ppt_draft workflow artifact", async () => {
    const runtime: AgentRuntime = {
      async run(input) {
        return {
          status: "succeeded",
          run: {
            runId: input.runId,
            projectId: input.projectId,
            task: input.task,
            runtimeKind: "deterministic",
            status: "succeeded",
          },
          assistantMessage: {
            title: "PPT 大纲已生成",
            body: "已生成一版 PPT 大纲草稿。",
          },
          artifactDraft: {
            nodeKey: "ppt_outline",
            kind: "ppt_outline",
            title: "PPT 大纲",
            summary: "确定性草稿",
            markdown: "# PPT 大纲",
            contentType: "text/markdown",
            generationMode: "deterministic_draft",
            isReadyForTeacherReview: true,
          },
          nextSuggestedAction: {
            type: "review_artifact",
            label: "查看并确认这份草稿",
          },
        };
      },
    };

    const result = await runCapabilityWithAgentRuntime({
      runtime,
      projectId: "project-a",
      capabilityId: "ppt_outline",
      userMessage: "帮我做五年级数学百分数 PPT",
      projectContext: {
        grade: "五年级",
        subject: "数学",
        topic: "百分数",
        requestedOutputs: ["PPT 大纲"],
      },
    });

    expect(result).toMatchObject({
      status: "succeeded",
      artifactDraft: {
        nodeKey: "ppt_draft",
        kind: "ppt_draft",
        structuredContent: {
          capabilityId: "ppt_outline",
          providerStatus: "deterministic_draft",
        },
      },
    });
  });

  it("returns honest placeholder artifacts for external capabilities before real providers are wired", async () => {
    const runtime: AgentRuntime = {
      async run() {
        throw new Error("external placeholder capabilities should not call the text runtime");
      },
    };

    const baseInput = {
      runtime,
      projectId: "project-a",
      userMessage: "帮我做五年级数学百分数完整材料包",
      projectContext: {
        grade: "五年级",
        subject: "数学",
        topic: "百分数",
        requestedOutputs: ["完整材料包"],
      },
    };

    const cozePpt = await runCapabilityWithAgentRuntime({ ...baseInput, capabilityId: "coze_ppt" });
    const imageAsset = await runCapabilityWithAgentRuntime({ ...baseInput, capabilityId: "image_asset" });
    const introVideo = await runCapabilityWithAgentRuntime({ ...baseInput, capabilityId: "intro_video" });

    expect(cozePpt).toMatchObject({
      status: "succeeded",
      artifactDraft: {
        nodeKey: "ppt_draft",
        kind: "ppt_draft",
        structuredContent: {
          capabilityId: "coze_ppt",
          providerStatus: "deterministic_draft",
          placeholder: true,
        },
      },
      providerStatus: "deterministic_draft",
    });
    expect(imageAsset).toMatchObject({
      status: "succeeded",
      artifactDraft: {
        nodeKey: "image_prompts",
        kind: "image_prompts",
        structuredContent: {
          capabilityId: "image_asset",
          providerStatus: "deterministic_draft",
          placeholder: true,
        },
      },
      providerStatus: "deterministic_draft",
    });
    expect(introVideo).toMatchObject({
      status: "succeeded",
      artifactDraft: {
        nodeKey: "video_storyboard",
        kind: "video_storyboard",
        structuredContent: {
          capabilityId: "intro_video",
          providerStatus: "deterministic_draft",
          placeholder: true,
        },
      },
      providerStatus: "deterministic_draft",
    });

    expect(JSON.stringify([cozePpt, imageAsset, introVideo])).not.toMatch(/真实 PPTX 已生成|真实图片已生成|真实视频已生成/);
  });
});
