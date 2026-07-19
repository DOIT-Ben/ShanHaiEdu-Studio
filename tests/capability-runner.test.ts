import { describe, expect, it } from "vitest";
import { normalizeCapabilityRunResult, runCapabilityWithAgentRuntime } from "@/server/capabilities/capability-runner";
import type { AgentRuntime } from "@/server/agent-runtime/types";
import { createStoryboardManifest } from "@/server/video-quality/video-production-contract";
import { createVideoNarrationScript } from "@/server/video-quality/video-narration-contract";
import { createExecutionEnvelope, createTaskBrief } from "@/server/conversation/task-contract";
import { FixtureAgentRuntime } from "./helpers/fixture-agent-runtime";

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

  it("preserves the runtime run and timeout category for recovery", async () => {
    const runtime: AgentRuntime = {
      async run(input) {
        return {
          status: "failed",
          run: { runId: input.runId, projectId: input.projectId, task: input.task, runtimeKind: "openai", status: "failed" },
          failure: { category: "timeout", retryable: true },
          assistantMessage: { title: "本次生成没有完成", body: "已保留当前输入，可以稍后重试。" },
          nextSuggestedAction: { type: "retry", label: "重试本次生成" },
        };
      },
    };

    const result = await runCapabilityWithAgentRuntime({
      runtime,
      projectId: "project-timeout",
      capabilityId: "requirement_spec",
      userMessage: "请整理五年级数学百分数公开课需求",
      projectContext: { grade: "五年级", subject: "数学", topic: "百分数", requestedOutputs: ["需求规格"] },
    });

    expect(result).toMatchObject({
      status: "failed",
      errorCategory: "timeout",
      retryable: true,
      runtimeRun: { runId: expect.any(String), runtimeKind: "openai", status: "failed" },
    });
  });

  it("preserves current provenance on normalized successful results", () => {
    const result = normalizeCapabilityRunResult({
      status: "succeeded",
      artifactDraft: {
        nodeKey: "ppt_draft",
        kind: "ppt_draft",
        title: "PPT 大纲",
        summary: "模型生成的大纲",
        markdownContent: "# PPT 大纲",
        structuredContent: {
          generationMode: "model_generated",
          providerStatus: "real",
          runtimeKind: "openai",
        },
      },
      assistantSummary: "已生成一版可检查的大纲草稿。",
      providerStatus: "real",
    });

    expect(result).toMatchObject({
      status: "succeeded",
      providerStatus: "real",
      artifactDraft: {
        structuredContent: {
          generationMode: "model_generated",
          providerStatus: "real",
          runtimeKind: "openai",
        },
      },
    });
  });

  it("fails closed when a runtime result lacks current model provenance", async () => {
    const runtime = {
      async run(input: Parameters<AgentRuntime["run"]>[0]) {
        return {
          status: "succeeded",
          run: {
            runId: input.runId,
            projectId: input.projectId,
            task: input.task,
            runtimeKind: "fixture",
            status: "succeeded",
          },
          assistantMessage: { title: "需求规格已生成", body: "未验证来源。" },
          artifactDraft: {
            nodeKey: "requirement_spec",
            kind: "requirement_spec",
            title: "需求规格",
            summary: "未验证来源",
            markdown: "# 需求规格",
            contentType: "text/markdown",
            generationMode: "fixture_generated",
            isReadyForTeacherReview: true,
          },
          nextSuggestedAction: { type: "review_artifact", label: "查看" },
        };
      },
    } as unknown as AgentRuntime;

    const result = await runCapabilityWithAgentRuntime({
      runtime,
      projectId: "project-untrusted",
      capabilityId: "requirement_spec",
      userMessage: "整理需求",
      projectContext: {
        grade: "五年级",
        subject: "数学",
        topic: "百分数",
        requestedOutputs: ["需求规格"],
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      errorCategory: "validation",
    });
    expect("artifactDraft" in result).toBe(false);
  });

  it("maps the ppt_outline runtime task into the current ppt_draft artifact kind", async () => {
    let runtimeInput: Parameters<AgentRuntime["run"]>[0] | undefined;
    const fixtureRuntime = new FixtureAgentRuntime();
    const runtime: AgentRuntime = {
      async run(input) {
        runtimeInput = input;
        return fixtureRuntime.run(input);
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
      taskInput: {
        teacherGoal: "五年级数学百分数公开课，约 10 页",
        targetPageCount: 10,
        taskBrief: {
          goal: "完成公开课材料包",
          generationIntensity: "standard",
        },
      },
    });

    expect(runtimeInput?.taskInput).toEqual({
      teacherGoal: "五年级数学百分数公开课，约 10 页",
      targetPageCount: 10,
      taskBrief: {
        goal: "完成公开课材料包",
        generationIntensity: "standard",
      },
    });

    expect(result).toMatchObject({
      status: "succeeded",
      artifactDraft: {
        nodeKey: "ppt_draft",
        kind: "ppt_draft",
        structuredContent: {
          capabilityId: "ppt_outline",
          generationMode: "model_generated",
          providerStatus: "real",
          runtimeKind: "openai",
        },
      },
      providerStatus: "real",
    });
  });

  it("accepts a real model PPT design candidate without requiring Director first", async () => {
    let runtimeCalls = 0;
    const designCandidate = validPptDesignSemanticCandidate();
    const authority = capabilityAuthority();
    const runtime: AgentRuntime = {
      async run(input) {
        runtimeCalls += 1;
        return {
          status: "succeeded",
          run: { runId: input.runId, projectId: input.projectId, task: input.task, runtimeKind: "openai", status: "succeeded" },
          assistantMessage: { title: "逐页设计已完成", body: "已形成可信结构化设计候选。" },
          artifactDraft: {
            nodeKey: "ppt_design",
            kind: "ppt_design",
            title: "百分数逐页设计",
            summary: "真实模型逐页设计候选",
            markdown: "# 逐页设计",
            contentType: "text/markdown",
            generationMode: "model_generated",
            isReadyForTeacherReview: true,
            structuredContent: { pptDesignCandidate: designCandidate },
          },
          nextSuggestedAction: { type: "review_artifact", label: "检查设计候选" },
        };
      },
    };

    const result = await runCapabilityWithAgentRuntime({
      runtime,
      projectId: authority.taskBrief.projectId,
      capabilityId: "ppt_design",
      userMessage: "生成 PPT 设计候选",
      taskInput: { taskBrief: authority.taskBrief, targetPageCount: 2 },
      projectContext: {
        grade: "五年级",
        subject: "数学",
        topic: "百分数",
        requestedOutputs: ["PPT 设计候选"],
      },
      approvedArtifacts: [authority.pptDraft],
      executionEnvelope: authority.executionEnvelope,
    });

    expect(result).toMatchObject({
      status: "succeeded",
      providerStatus: "real",
      artifactDraft: {
        nodeKey: "ppt_design_draft",
        kind: "ppt_design_draft",
        structuredContent: { generationMode: "model_generated", providerStatus: "real" },
      },
    });
    expect(runtimeCalls).toBe(1);
  });

  it("rejects a PPT design candidate without a trusted current ppt_draft", async () => {
    const designCandidate = validPptDesignSemanticCandidate();
    const authority = capabilityAuthority();
    const runtime: AgentRuntime = {
      async run(input) {
        return {
          status: "succeeded",
          run: { runId: input.runId, projectId: input.projectId, task: input.task, runtimeKind: "openai", status: "succeeded" },
          assistantMessage: { title: "逐页设计已完成", body: "已形成结构化设计候选。" },
          artifactDraft: {
            nodeKey: "ppt_design", kind: "ppt_design", title: "逐页设计", summary: "候选", markdown: "# 逐页设计",
            contentType: "text/markdown", generationMode: "model_generated", isReadyForTeacherReview: true,
            structuredContent: { pptDesignCandidate: designCandidate },
          },
          nextSuggestedAction: { type: "review_artifact", label: "检查设计候选" },
        };
      },
    };
    const result = await runCapabilityWithAgentRuntime({
      runtime, projectId: authority.taskBrief.projectId, capabilityId: "ppt_design", userMessage: "生成PPT设计候选",
      taskInput: { taskBrief: authority.taskBrief, targetPageCount: 2 },
      projectContext: { grade: "五年级", subject: "数学", topic: "百分数", requestedOutputs: ["PPT设计候选"] },
      approvedArtifacts: [{ artifactId: "artifact_textbook_evidence", version: 1, digest: "c".repeat(64), nodeKey: "textbook_evidence", title: "教材证据", summary: "证据", markdown: "# 证据" }],
      executionEnvelope: authority.executionEnvelope,
    });
    expect(result).toMatchObject({
      status: "failed",
      retryable: true,
      errorCategory: "validation",
      reasonCode: "ppt_design_evidence_binding_missing",
    });
  });

  it("requires and preserves an executable storyboard manifest", async () => {
    const manifest = createStoryboardManifest({
      schemaVersion: "video-storyboard.v1",
      intent: { schemaVersion: "video-intent.v1", productionPath: "video_full_intro", videoMode: "full_intro", targetDurationRange: { minSeconds: 30, maxSeconds: 60 }, courseAnchor: "结尾一次提问", classroomReturnQuestion: "发生了什么？", answerDisclosureBoundary: "不解释答案" },
      shots: [1, 2, 3].map((ordinal) => ({ shotId: `shot_0${ordinal}`, ordinal, durationTargetRange: { minSeconds: 10, maxSeconds: 20 }, sceneFunction: "推进悬念", mainSubject: "机械装置", subjectAction: "改变状态", cameraMotion: "缓慢推进", continuityKeys: ["同一装置"], startFrameIntent: "承接前态", endFrameIntent: "留下疑问", referencePolicy: "none" as const, referenceAssetIds: [], textPolicy: "post_production_only" as const, modelPrompt: `机械镜头 ${ordinal}`, negativePrompt: "不要答案", retakeVariables: ["subjectAction"] })),
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

  it("preserves a Runtime domain reasonCode instead of collapsing it to validation", async () => {
    const runtime: AgentRuntime = {
      async run(input) {
        return {
          status: "failed",
          run: { runId: input.runId, projectId: input.projectId, task: input.task, runtimeKind: "openai", status: "failed" },
          failure: {
            category: "validation",
            retryable: true,
            reasonCode: "ppt_design_candidate_semantics_invalid",
            details: ["page_count_mismatch"],
          },
          assistantMessage: { title: "本次生成没有完成", body: "已保留当前输入。" },
          nextSuggestedAction: { type: "retry", label: "重新规划" },
        };
      },
    };

    const result = await runCapabilityWithAgentRuntime({
      runtime,
      projectId: "project-runtime-reason",
      capabilityId: "ppt_design",
      userMessage: "生成PPT设计候选",
      projectContext: { grade: "五年级", subject: "数学", topic: "百分数", requestedOutputs: ["ppt"] },
    });

    expect(result).toMatchObject({
      status: "failed",
      errorCategory: "validation",
      reasonCode: "ppt_design_candidate_semantics_invalid",
      reasonDetails: ["page_count_mismatch"],
    });
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

function validPptDesignSemanticCandidate() {
  return {
    schemaVersion: "ppt-design-semantic-candidate.v1" as const,
    goalSummary: "五年级数学百分数公开课，用投篮命中率建立比较需求。",
    brief: {
      grade: "五年级",
      subject: "数学",
      topic: "百分数",
      audience: "五年级学生",
      useCase: "public_lesson",
      targetSlideCount: 2,
    },
    evidenceBindings: [{
      evidenceId: "evidence-textbook",
      pageRefs: ["教材第84-85页"],
      claims: ["用投篮命中率引出百分数比较"],
    }],
    objectives: [{
      objectiveId: "objective-1",
      statement: "理解百分数用于表示比较关系",
      evidenceRefs: ["evidence-textbook"],
    }],
    narrative: {
      openingTension: "两组命中数不同，不能直接判断谁更准。",
      learningProgression: ["观察数据", "统一比较标准"],
      closingResolution: "用百分数说明命中水平。",
    },
    pagePlans: [
      {
        pageNumber: 1,
        objectiveIds: ["objective-1"],
        narrativeJob: "提出两组投篮数据能否直接比较的矛盾",
        teachingAction: "引导学生说明仅看命中数为什么不公平",
        takeawayTitle: "谁的投篮更准",
        primaryVisualBrief: "两组投篮数据形成可观察的球场记分牌",
      },
      {
        pageNumber: 2,
        objectiveIds: ["objective-1"],
        narrativeJob: "建立统一标准并形成百分数表达",
        teachingAction: "组织学生把命中次数和投篮总数配对比较",
        takeawayTitle: "统一标准才能公平比较",
        primaryVisualBrief: "两块记分牌转化为统一百分比刻度",
      },
    ],
    downstreamUse: "production_design_expansion",
  } as const;
}

function capabilityAuthority() {
  const taskBrief = createTaskBrief({
    taskId: "task-ppt-quality",
    projectId: "project-ppt-quality",
    intentEpoch: 1,
    goal: "五年级数学百分数公开课PPT设计候选",
    requestedOutputs: ["ppt_design"],
    constraints: ["2页候选"],
    excludedOutputs: ["image", "video", "package"],
    generationIntensity: "standard",
    sourceMessageId: "message-ppt-quality",
  });

  const executionEnvelope = createExecutionEnvelope({
    actorUserId: "teacher-ppt-quality",
    taskBrief,
    planRevision: 1,
    intensity: "standard",
    intentGrant: {
      schemaVersion: "intent-grant.v1",
      taskId: taskBrief.taskId,
      projectId: taskBrief.projectId,
      intentEpoch: taskBrief.intentEpoch,
      standardWorkAuthorized: true,
      intensity: "standard",
      budgetPolicyVersion: "r5-text-only.v1",
      maxCostCredits: 10,
      maxExternalProviderCalls: 0,
      requiredCheckpoints: [],
      expiresAt: null,
    },
    action: { toolName: "create_ppt_design_draft", arguments: {} },
  });
  return {
    taskBrief,
    executionEnvelope,
    pptDraft: {
      artifactId: "artifact-ppt-outline",
      kind: "ppt_draft",
      version: 2,
      digest: "a".repeat(64),
      nodeKey: "ppt_draft",
      title: "百分数PPT大纲",
      summary: "两页大纲",
      markdown: "# PPT大纲",
    },
  };
}
