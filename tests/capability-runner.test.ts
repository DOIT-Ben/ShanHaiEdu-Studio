import { describe, expect, it } from "vitest";
import { normalizeCapabilityRunResult, runCapabilityWithAgentRuntime } from "@/server/capabilities/capability-runner";
import type { AgentRuntime } from "@/server/agent-runtime/types";
import { validPptDesignPackage } from "./support/ppt-quality-fixture";
import { createStoryboardManifest } from "@/server/video-quality/video-production-contract";
import { createVideoNarrationScript } from "@/server/video-quality/video-narration-contract";

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

  it("preserves the PPT design package while adding runtime metadata", async () => {
    const packageValue = validPptDesignPackage();
    const runtime: AgentRuntime = {
      async run(input) {
        return {
          status: "succeeded",
          run: {
            runId: input.runId,
            projectId: input.projectId,
            task: input.task,
            runtimeKind: "openai",
            status: "succeeded",
          },
          assistantMessage: { title: "PPT 设计包已生成", body: "请检查逐页设计。" },
          artifactDraft: {
            nodeKey: "ppt_design",
            kind: "ppt_design",
            title: "百分数 PPT 设计包",
            summary: "12 页逐页质量设计。",
            markdown: validPptDesignMarkdown(),
            contentType: "text/markdown",
            generationMode: "model_generated",
            isReadyForTeacherReview: true,
            structuredContent: { pptDesignPackage: packageValue },
          },
          nextSuggestedAction: { type: "review_artifact", label: "查看并确认设计包" },
        };
      },
    };

    const result = await runCapabilityWithAgentRuntime({
      runtime,
      projectId: "project-ppt-quality",
      capabilityId: "ppt_design",
      userMessage: "生成 PPT 设计包",
      projectContext: {
        grade: "五年级",
        subject: "数学",
        topic: "百分数",
        requestedOutputs: ["PPT 设计包"],
      },
    });

    expect(result).toMatchObject({
      status: "succeeded",
      artifactDraft: {
        structuredContent: {
          pptDesignPackage: packageValue,
          capabilityId: "ppt_design",
          generationMode: "model_generated",
          providerStatus: "real",
        },
      },
    });
  });

  it("requires and preserves an executable storyboard manifest", async () => {
    const manifest = createStoryboardManifest({
      schemaVersion: "video-storyboard.v1",
      intent: { schemaVersion: "video-intent.v1", productionPath: "video_full_intro", videoMode: "full_intro", courseAnchor: "结尾一次提问", classroomReturnQuestion: "发生了什么？", answerDisclosureBoundary: "不解释答案" },
      shots: [1, 2, 3].map((ordinal) => ({ shotId: `shot_0${ordinal}`, ordinal, durationTargetRange: { minSeconds: 6, maxSeconds: 8 }, sceneFunction: "推进悬念", mainSubject: "机械装置", subjectAction: "改变状态", cameraMotion: "缓慢推进", continuityKeys: ["同一装置"], startFrameIntent: "承接前态", endFrameIntent: "留下疑问", referencePolicy: "none" as const, referenceAssetIds: [], textPolicy: "post_production_only" as const, modelPrompt: `机械镜头 ${ordinal}`, negativePrompt: "不要答案", retakeVariables: ["subjectAction"] })),
      references: [],
    });
    const runtime = storyboardRuntime({ videoStoryboardManifest: manifest });
    const result = await runCapabilityWithAgentRuntime({ runtime, projectId: "project-video", capabilityId: "storyboard_generate", userMessage: "生成分镜", projectContext: { grade: "五年级", subject: "数学", topic: "百分数", requestedOutputs: ["视频"] } });
    expect(result).toMatchObject({ status: "succeeded", artifactDraft: { structuredContent: { videoStoryboardManifest: manifest, capabilityId: "storyboard_generate" } } });
    const invalid = await runCapabilityWithAgentRuntime({ runtime: storyboardRuntime(undefined), projectId: "project-video", capabilityId: "storyboard_generate", userMessage: "生成分镜", projectContext: { grade: "五年级", subject: "数学", topic: "百分数", requestedOutputs: ["视频"] } });
    expect(invalid).toMatchObject({ status: "failed", errorCategory: "validation" });
  });

  it("requires a validated controlled narration script", async () => {
    const script = createVideoNarrationScript({ schemaVersion: "video-narration-script.v1", language: "zh-CN", voiceId: "Chinese (Mandarin)_Gentleman", text: "装置为什么会连续变化？带着这个问题回到课堂。", courseAnchor: "回到课堂问题", answerDisclosureBoundary: "不解释答案" });
    const valid = await runCapabilityWithAgentRuntime({ runtime: videoScriptRuntime({ videoNarrationScript: script }), projectId: "project-video", capabilityId: "video_script_generate", userMessage: "生成脚本", projectContext: { grade: "五年级", subject: "数学", topic: "百分数", requestedOutputs: ["视频"] } });
    expect(valid).toMatchObject({ status: "succeeded", artifactDraft: { structuredContent: { videoNarrationScript: script } } });
    const invalid = await runCapabilityWithAgentRuntime({ runtime: videoScriptRuntime(undefined), projectId: "project-video", capabilityId: "video_script_generate", userMessage: "生成脚本", projectContext: { grade: "五年级", subject: "数学", topic: "百分数", requestedOutputs: ["视频"] } });
    expect(invalid).toMatchObject({ status: "failed", errorCategory: "validation" });
  });

  it("fails external capabilities instead of returning placeholder success from the text runtime", async () => {
    const runtime: AgentRuntime = {
      async run() {
        throw new Error("external capabilities should not call the text runtime");
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

    for (const capabilityId of ["coze_ppt", "image_asset", "intro_video"] as const) {
      const result = await runCapabilityWithAgentRuntime({ ...baseInput, capabilityId });

      expect(result).toMatchObject({
        status: "failed",
        retryable: true,
        errorCategory: "provider",
      });
      expect(JSON.stringify(result)).not.toMatch(/placeholder|deterministic_draft|真实 PPTX 已生成|真实图片已生成|真实视频已生成/);
    }
  });
});

function storyboardRuntime(structuredContent: Record<string, unknown> | undefined): AgentRuntime {
  return {
    async run(input) {
      return {
        status: "succeeded",
        run: { runId: input.runId, projectId: input.projectId, task: input.task, runtimeKind: "openai", status: "succeeded" },
        assistantMessage: { title: "视频分镜已生成", body: "请检查镜头。" },
        artifactDraft: { nodeKey: "storyboard_generate", kind: "storyboard_generate", title: "视频分镜", summary: "三镜头独立创意。", markdown: "# 视频分镜", contentType: "text/markdown", generationMode: "model_generated", isReadyForTeacherReview: true, structuredContent },
        nextSuggestedAction: { type: "review_artifact", label: "查看分镜" },
      };
    },
  };
}

function videoScriptRuntime(structuredContent: Record<string, unknown> | undefined): AgentRuntime {
  return {
    async run(input) {
      return { status: "succeeded", run: { runId: input.runId, projectId: input.projectId, task: input.task, runtimeKind: "openai", status: "succeeded" }, assistantMessage: { title: "视频脚本已生成", body: "请检查。" }, artifactDraft: { nodeKey: "video_script_generate", kind: "video_script_generate", title: "视频脚本", summary: "受控旁白。", markdown: "# 视频脚本", contentType: "text/markdown", generationMode: "model_generated", isReadyForTeacherReview: true, structuredContent }, nextSuggestedAction: { type: "review_artifact", label: "查看脚本" } };
    },
  };
}

function validPptDesignMarkdown(): string {
  return [
    "总页数：12 页",
    ...Array.from({ length: 12 }, (_, index) => [
      `## 第 ${index + 1} 页`,
      "- 底图：无文字课堂场景。",
      "- 元素：透明背景教具。",
      "- 文字：可编辑标题。",
      "- 排版：稳定阅读顺序。",
    ].join("\n")),
  ].join("\n");
}
