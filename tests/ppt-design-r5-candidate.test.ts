import { describe, expect, it } from "vitest";
import { omitFixtureFields } from "./support/omit-fixture-fields";
import { OpenAIRuntime, buildOpenAIResponseRequest } from "@/server/agent-runtime/openai-runtime";
import {
  createPptDesignCandidateProjection,
  validatePptDesignCandidate,
  type PptDesignCandidateInput,
} from "@/server/ppt-quality/ppt-design-candidate";
import { runCapabilityWithAgentRuntime } from "@/server/capabilities/capability-runner";
import type { AgentRuntime } from "@/server/agent-runtime/types";
import { createExecutionEnvelope, createTaskBrief } from "@/server/conversation/task-contract";

describe("R5 compact PPT design candidate contract", () => {
  it("projects a model-authored compact candidate into the downstream structural package", () => {
    const projection = createPptDesignCandidateProjection(candidateInput());

    expect(validatePptDesignCandidate(projection.candidate)).toEqual({ valid: true, issues: [] });
    expect(projection.candidate.candidateDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(projection.candidate.pagePlans).toHaveLength(3);
    expect(projection).not.toHaveProperty("designPackage");
    expect(projection.candidate.evidenceBindings[0]).toMatchObject({
      sourceArtifactId: "artifact-outline",
      digest: "a".repeat(64),
    });
  });

  it("rejects a candidate whose page plan is not contiguous and complete", () => {
    const input = candidateInput();
    input.pagePlans[1].pageNumber = 3;

    expect(() => createPptDesignCandidateProjection(input)).toThrow(/ppt_design_candidate_invalid/);
  });

  it("accepts the minimum R5 semantic candidate without production page or sample fields", () => {
    const input = candidateInput() as Record<string, any>;
    delete input.visualSystem;
    delete input.samplePlan;
    delete input.requiredProductionChecks;
    input.pagePlans = input.pagePlans.map((page: Record<string, unknown>) => ({
      pageNumber: page.pageNumber,
      objectiveIds: page.objectiveIds,
      narrativeJob: page.narrativeJob,
      teachingAction: page.teachingAction,
      takeawayTitle: page.takeawayTitle,
      primaryVisualBrief: page.primaryVisualBrief,
    }));

    expect(() => createPptDesignCandidateProjection(input as PptDesignCandidateInput)).not.toThrow();
  });

  it("asks the model for the compact R5 candidate instead of the production package", () => {
    const request = buildOpenAIResponseRequest(runtimeInput(), "medium");
    const serialized = JSON.stringify(request);
    const runtimePayload = JSON.parse(request.input) as Record<string, any>;
    const candidateContract = runtimePayload.structuredContentContract as Record<string, any>;

    expect(serialized).toContain("pptDesignCandidate");
    expect(serialized).toContain("ppt-design-semantic-candidate.v1");
    expect(serialized).not.toContain("pptDesignPackage");
    expect(serialized).not.toContain("productionPath");
    expect(serialized).not.toContain("visualSystem");
    expect(serialized).not.toContain("editableMath");
    expect(serialized).not.toContain("samplePlan");
    expect(serialized).not.toContain("requiredProductionChecks");
    expect(candidateContract.requiredSections).not.toContain("taskBriefDigest");
    expect(candidateContract.compactShapes.evidenceBinding).not.toEqual(expect.arrayContaining([
      "sourceArtifactId",
      "digest",
    ]));
  });

  it("accepts model-authored semantics without asking the model to mint authority fields", async () => {
    const semanticCandidate = modelCandidateInput();
    const client = {
      responses: {
        create: async () => ({
          output_text: JSON.stringify({
            assistantMessage: { title: "逐页设计候选已形成", body: "已绑定当前大纲并形成可继续细化的逐页设计。" },
            artifactDraft: {
              title: "百分数逐页设计候选",
              summary: "3页紧凑设计候选。",
              markdown: [
                "## 任务语义",
                "五年级百分数公开课。",
                "## 证据绑定",
                "绑定当前PPT大纲。",
                "## 视觉方向",
                "清晰课堂演示。",
                "## 逐页结构",
                "三页分别承担情境、比较和归纳。",
                "## 下游准备",
                "可继续展开完整页面结构。",
                "## 自检清单",
                "逐页连续且证据完整。",
              ].join("\n"),
              structuredContentJson: JSON.stringify({ pptDesignCandidate: semanticCandidate }),
            },
            nextSuggestedAction: { label: "继续完善课件" },
          }),
        }),
      },
    };
    const runtime = new OpenAIRuntime({ client, model: "gpt-test", reasoningEffort: "medium" });

    const result = await runtime.run(runtimeInput());

    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.artifactDraft.generationMode).toBe("model_generated");
    expect(result.artifactDraft.structuredContent?.pptDesignCandidate).toMatchObject({
      schemaVersion: "ppt-design-semantic-candidate.v1",
    });
    expect(result.artifactDraft.structuredContent?.pptDesignCandidate).not.toHaveProperty("taskBriefDigest");
    expect(result.artifactDraft.structuredContent?.pptDesignCandidate).not.toHaveProperty("candidateDigest");
    expect((result.artifactDraft.structuredContent?.pptDesignCandidate as Record<string, any>).evidenceBindings[0])
      .not.toHaveProperty("sourceArtifactId");
    expect((result.artifactDraft.structuredContent?.pptDesignCandidate as Record<string, any>).evidenceBindings[0])
      .not.toHaveProperty("digest");
    expect(result.artifactDraft.structuredContent).not.toHaveProperty("pptDesignPackage");
  });

  it("overwrites model-supplied authority fields from the current envelope, TaskBrief, and trusted ppt_draft", async () => {
    const authority = currentAuthority();
    const untrustedCandidate = {
      ...modelCandidateInput(),
      taskBriefDigest: "f".repeat(64),
      candidateDigest: "e".repeat(64),
      evidenceBindings: modelCandidateInput().evidenceBindings.map((binding) => ({
        ...binding,
        sourceArtifactId: "artifact-from-model",
        digest: "d".repeat(64),
      })),
    };
    const input = {
      runtime: pptCandidateRuntime(untrustedCandidate),
      projectId: authority.taskBrief.projectId,
      capabilityId: "ppt_design" as const,
      userMessage: "生成PPT设计候选",
      taskInput: { taskBrief: authority.taskBrief, targetPageCount: 3 },
      projectContext: { grade: "五年级", subject: "数学", topic: "百分数", requestedOutputs: ["ppt"] },
      approvedArtifacts: [authority.pptDraft],
      executionEnvelope: authority.executionEnvelope,
    };

    const result = await runCapabilityWithAgentRuntime(input);

    expect(result).toMatchObject({
      status: "succeeded",
      artifactDraft: {
        structuredContent: {
          pptDesignCandidate: {
            schemaVersion: "ppt-design-candidate.v2",
            taskBriefDigest: authority.taskBrief.digest,
            evidenceBindings: [{
              sourceArtifactId: authority.pptDraft.artifactId,
              sourceArtifactVersion: authority.pptDraft.version,
              digest: authority.pptDraft.digest,
            }],
            candidateDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        },
      },
    });
  });

  it.each([
    ["ppt_design_candidate_missing", undefined, true, true],
    ["ppt_design_candidate_semantics_invalid", { ...modelCandidateInput(), pagePlans: [] }, true, true],
    ["ppt_design_task_binding_missing", modelCandidateInput(), false, true],
    ["ppt_design_evidence_binding_missing", modelCandidateInput(), true, false],
  ] as const)("returns actionable %s instead of a generic validation failure", async (
    reasonCode,
    candidate,
    withEnvelope,
    withEvidence,
  ) => {
    const authority = currentAuthority();
    const input = {
      runtime: pptCandidateRuntime(candidate),
      projectId: authority.taskBrief.projectId,
      capabilityId: "ppt_design" as const,
      userMessage: "生成PPT设计候选",
      taskInput: { taskBrief: authority.taskBrief, targetPageCount: 3 },
      projectContext: { grade: "五年级", subject: "数学", topic: "百分数", requestedOutputs: ["ppt"] },
      approvedArtifacts: withEvidence ? [authority.pptDraft] : [],
      ...(withEnvelope ? { executionEnvelope: authority.executionEnvelope } : {}),
    };

    await expect(runCapabilityWithAgentRuntime(input)).resolves.toMatchObject({
      status: "failed",
      errorCategory: "validation",
      reasonCode,
    });
  });

  it("returns the exact semantic scope mismatch so Main Agent can repair the responsible input", async () => {
    const authority = currentAuthority();
    const result = await runCapabilityWithAgentRuntime({
      runtime: pptCandidateRuntime(modelCandidateInput()),
      projectId: authority.taskBrief.projectId,
      capabilityId: "ppt_design",
      userMessage: "生成PPT设计候选",
      taskInput: { taskBrief: authority.taskBrief, targetPageCount: 3 },
      projectContext: { grade: "五年级", subject: "数学", topic: "未命名公开课项目", requestedOutputs: ["ppt"] },
      approvedArtifacts: [authority.pptDraft],
      executionEnvelope: authority.executionEnvelope,
    });

    expect(result).toMatchObject({
      status: "failed",
      reasonCode: "ppt_design_candidate_semantics_invalid",
      reasonDetails: ["topic_mismatch"],
    });
  });

  it("requires current server task binding instead of trusting a model-supplied TaskBrief digest", async () => {
    const projection = createPptDesignCandidateProjection(candidateInput());
    const runtime: AgentRuntime = {
      async run(input) {
        return {
          status: "succeeded",
          run: { runId: input.runId, projectId: input.projectId, task: input.task, runtimeKind: "openai", status: "succeeded" },
          assistantMessage: { title: "逐页设计候选已形成", body: "已形成可继续细化的候选。" },
          artifactDraft: {
            nodeKey: "ppt_design",
            kind: "ppt_design",
            title: "百分数逐页设计候选",
            summary: "候选结构完整。",
            markdown: "## 任务语义\n百分数公开课\n## 自检清单\n已检查",
            contentType: "text/markdown",
            generationMode: "model_generated",
            isReadyForTeacherReview: true,
            structuredContent: {
              pptDesignCandidate: projection.candidate,
            },
          },
          nextSuggestedAction: { type: "review_artifact", label: "继续完善课件" },
        };
      },
    };

    const result = await runCapabilityWithAgentRuntime({
      runtime,
      projectId: "project-r5-ppt",
      capabilityId: "ppt_design",
      userMessage: "生成PPT设计候选",
      taskInput: { taskBrief: { digest: "c".repeat(64) } },
      projectContext: { grade: "五年级", subject: "数学", topic: "百分数", requestedOutputs: ["ppt"] },
      approvedArtifacts: [{
        artifactId: "artifact-outline",
        kind: "ppt_draft",
        version: 1,
        digest: "a".repeat(64),
        nodeKey: "ppt_draft",
        title: "百分数PPT大纲",
        summary: "三页大纲",
        markdown: "逐页大纲",
      }],
    });

    expect(result).toMatchObject({
      status: "failed",
      errorCategory: "validation",
      reasonCode: "ppt_design_task_binding_missing",
    });
  });

  it("promotes a candidate-only model result without requiring a production PptDesignPackage", async () => {
    const authority = currentAuthority();
    const input = {
      runtime: pptCandidateRuntime(modelCandidateInput()),
      projectId: authority.taskBrief.projectId,
      capabilityId: "ppt_design" as const,
      userMessage: "生成PPT设计候选",
      taskInput: { taskBrief: authority.taskBrief, targetPageCount: 3 },
      projectContext: { grade: "五年级", subject: "数学", topic: "百分数", requestedOutputs: ["ppt"] },
      approvedArtifacts: [authority.pptDraft],
      executionEnvelope: authority.executionEnvelope,
    };

    const result = await runCapabilityWithAgentRuntime(input);

    expect(result).toMatchObject({
      status: "succeeded",
      artifactDraft: { structuredContent: { pptDesignCandidate: {
        schemaVersion: "ppt-design-candidate.v2",
        evidenceBindings: [{ sourceArtifactVersion: authority.pptDraft.version }],
      } } },
    });
    if (result.status === "succeeded") {
      expect(result.artifactDraft.structuredContent).not.toHaveProperty("pptDesignPackage");
    }
  });
});

function runtimeInput() {
  return {
    projectId: "project-r5-ppt",
    runId: "run-r5-ppt",
    sourceMessageId: "message-r5-ppt",
    task: "ppt_design" as const,
    userMessage: "请做五年级数学百分数公开课约3页PPT设计候选。",
    taskInput: {
      taskBrief: {
        schemaVersion: "task-brief.v1",
        digest: "b".repeat(64),
        goal: "五年级数学百分数公开课约3页PPT",
      },
      targetPageCount: 3,
    },
    projectContext: { grade: "五年级", subject: "数学", topic: "百分数", requestedOutputs: ["ppt"] },
    approvedArtifacts: [{
      artifactId: "artifact-outline",
      kind: "ppt_draft",
      version: 1,
      digest: "a".repeat(64),
      nodeKey: "ppt_draft",
      title: "百分数PPT大纲",
      summary: "三页大纲",
      markdown: "逐页大纲",
    }],
  };
}

function candidateInput(): PptDesignCandidateInput {
  return {
    schemaVersion: "ppt-design-candidate.v1",
    taskBriefDigest: "b".repeat(64),
    goalSummary: "五年级数学百分数公开课，用投篮命中率建立比较需求。",
    brief: {
      grade: "五年级",
      subject: "数学",
      topic: "百分数",
      audience: "五年级学生",
      useCase: "public_lesson",
      targetSlideCount: 3,
    },
    evidenceBindings: [{
      evidenceId: "evidence-outline",
      sourceArtifactId: "artifact-outline",
      sourceType: "teacher_material",
      pageRefs: ["大纲第1-3页"],
      claims: ["从投篮命中率比较进入百分数表达"],
      digest: "a".repeat(64),
    }],
    objectives: [{ objectiveId: "objective-1", statement: "理解百分数用于表示比较关系", evidenceRefs: ["evidence-outline"] }],
    narrative: {
      openingTension: "两组投篮命中数不同，谁更准不能只看命中数。",
      learningProgression: ["观察数据", "统一比较标准", "形成百分数表达"],
      closingResolution: "用百分数清楚说明命中水平。",
    },
    pagePlans: [
      pagePlan(1, "谁的投篮更准", "观察两组命中数据并提出比较问题"),
      pagePlan(2, "统一标准才能公平比较", "把命中次数与投篮总数配对比较"),
      pagePlan(3, "百分数让比较一目了然", "用百分数表达并解释比较结果"),
    ],
    downstreamUse: "production_design_expansion",
  };
}

function modelCandidateInput() {
  const input = candidateInput();
  const semantic = omitFixtureFields(input, "taskBriefDigest", "evidenceBindings");
  return {
    ...semantic,
    schemaVersion: "ppt-design-semantic-candidate.v1" as const,
    evidenceBindings: input.evidenceBindings.map((binding) => omitFixtureFields(binding, "sourceArtifactId", "digest")),
  };
}

function pptCandidateRuntime(candidate: unknown): AgentRuntime {
  return {
    async run(input) {
      return {
        status: "succeeded",
        run: { runId: input.runId, projectId: input.projectId, task: input.task, runtimeKind: "openai", status: "succeeded" },
        assistantMessage: { title: "逐页设计候选已形成", body: "已形成可继续细化的候选。" },
        artifactDraft: {
          nodeKey: "ppt_design",
          kind: "ppt_design",
          title: "百分数逐页设计候选",
          summary: "候选结构完整。",
          markdown: "## 任务语义\n百分数公开课\n## 自检清单\n已检查",
          contentType: "text/markdown",
          generationMode: "model_generated",
          isReadyForTeacherReview: true,
          structuredContent: candidate === undefined ? {} : { pptDesignCandidate: candidate },
        },
        nextSuggestedAction: { type: "review_artifact", label: "继续完善课件" },
      };
    },
  };
}

function currentAuthority() {
  const taskBrief = createTaskBrief({
    taskId: "task-r5-ppt",
    projectId: "project-r5-ppt",
    intentEpoch: 3,
    goal: "五年级数学百分数公开课约3页PPT",
    requestedOutputs: ["ppt_design"],
    constraints: ["约3页"],
    excludedOutputs: ["image", "video", "package"],
    generationIntensity: "standard",
    sourceMessageId: "message-r5-ppt",
  });
  const intentGrant = {
    schemaVersion: "intent-grant.v1" as const,
    taskId: taskBrief.taskId,
    projectId: taskBrief.projectId,
    intentEpoch: taskBrief.intentEpoch,
    standardWorkAuthorized: true,
    intensity: "standard" as const,
    budgetPolicyVersion: "r5-text-only.v1",
    maxCostCredits: 10,
    maxExternalProviderCalls: 0,
    requiredCheckpoints: [],
    expiresAt: null,
  };
  const executionEnvelope = createExecutionEnvelope({
    actorUserId: "teacher-r5",
    taskBrief,
    planRevision: 2,
    intensity: "standard",
    intentGrant,
    action: { toolName: "create_ppt_design_draft", arguments: {} },
  });
  const pptDraft = {
    artifactId: "artifact-outline-authoritative",
    kind: "ppt_draft",
    version: 4,
    digest: "a".repeat(64),
    nodeKey: "ppt_draft",
    title: "百分数PPT大纲",
    summary: "三页大纲",
    markdown: "逐页大纲",
  };
  return { taskBrief, executionEnvelope, pptDraft };
}

function pagePlan(
  pageNumber: number,
  takeawayTitle: string,
  learningAction: string,
) {
  return {
    pageNumber,
    objectiveIds: ["objective-1"],
    narrativeJob: learningAction,
    teachingAction: `教师引导：${learningAction}`,
    takeawayTitle,
    primaryVisualBrief: `${takeawayTitle}的球场数据视觉事件。`,
  };
}
