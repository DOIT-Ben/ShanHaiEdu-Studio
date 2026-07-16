import { describe, expect, it } from "vitest";
import { POST as postStartRun } from "@/app/api/workbench/projects/[projectId]/agent-runs/route";
import { POST as postFinishRun } from "@/app/api/workbench/projects/[projectId]/agent-runs/[runId]/finish/route";
import { GET as getApprovedInputs } from "@/app/api/workbench/projects/[projectId]/approved-inputs/route";
import { POST as postApproveArtifact } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/approve/route";
import { GET as getArtifactRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/route";
import { POST as postRegenerateRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/regenerate/route";
import { POST as postArtifactRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/route";
import { POST as postMessageRoute } from "@/app/api/workbench/projects/[projectId]/messages/route";
import { GET as getSnapshotRoute } from "@/app/api/workbench/projects/[projectId]/snapshot/route";
import { POST as postProjectRoute } from "@/app/api/workbench/projects/route";
import { createWorkbenchService } from "../service";

describe("Backend Workflow Lite Stage 7 mainline contract", () => {
  it("creates a default project when the browser client posts without a body", async () => {
    const projectResponse = await postProjectRoute(
      new Request("http://localhost/api/workbench/projects", {
        method: "POST",
      }),
    );
    const projectBody = await projectResponse.json();

    expect(projectResponse.status).toBe(201);
    expect(projectBody.project.title).toBe("未命名公开课项目");
  });

  it("asks for lesson details instead of generating a requirement artifact for greetings", async () => {
    const projectResponse = await postProjectRoute(
      new Request("http://localhost/api/workbench/projects", {
        method: "POST",
      }),
    );
    const projectBody = await projectResponse.json();
    const projectId = projectBody.project.id;

    const messageResponse = await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "你好" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const messageBody = await messageResponse.json();
    const snapshotResponse = await getSnapshotRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId }),
    });
    const snapshot = await snapshotResponse.json();

    expect(messageResponse.status).toBe(202);
    expect(messageBody).toMatchObject({
      message: { role: "teacher", content: "你好" },
      job: { teacherMessageId: messageBody.message.id },
    });
    expect(messageBody.assistantMessage).toBeUndefined();
    expect(messageBody.agentTurn).toBeUndefined();
    expect(messageBody.artifact).toBeUndefined();
    expect(snapshot.messages.map((message: { content: string }) => message.content).join("\n")).not.toContain("需求规格说明书已生成");
    expect(snapshot.artifacts).toEqual([]);
  });

  it("keeps the route envelopes stable across the backend workflow route sequence", async () => {
    const projectResponse = await postProjectRoute(
      new Request("http://localhost/api/workbench/projects", {
        method: "POST",
        body: JSON.stringify({
          title: "Stage 7 合同项目",
          grade: "五年级",
          subject: "数学",
          lessonTopic: "百分数",
        }),
      }),
    );
    const projectBody = await projectResponse.json();
    const projectId = projectBody.project.id;

    const messageResponse = await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "我要做百分数公开课" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const artifactResponse = await postArtifactRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          nodeKey: "requirement_spec",
          kind: "requirement_spec",
          title: "需求规格",
          status: "needs_review",
          summary: "百分数公开课需求",
          markdownContent: "# 需求规格",
        }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const artifactBody = await artifactResponse.json();
    const artifactId = artifactBody.artifact.id;

    const approveResponse = await postApproveArtifact(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ projectId, artifactId }),
    });
    const approvedInputsResponse = await getApprovedInputs(
      new Request(`http://localhost/api/workbench/projects/${projectId}/approved-inputs?nodeKey=lesson_plan`),
      { params: Promise.resolve({ projectId }) },
    );
    const artifactDetailResponse = await getArtifactRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId, artifactId }),
    });
    const regenerateResponse = await postRegenerateRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          expectedLatestVersion: 1,
          title: "需求规格 v2",
          summary: "百分数公开课需求 v2",
          markdownContent: "# 需求规格 v2",
        }),
      }),
      { params: Promise.resolve({ projectId, artifactId }) },
    );
    const runStartResponse = await postStartRun(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ nodeKey: "lesson_plan", runtime: "deterministic" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const runStartBody = await runStartResponse.json();
    const runFinishResponse = await postFinishRun(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ status: "failed", errorMessage: "测试运行未产出可验收材料" }),
      }),
      { params: Promise.resolve({ projectId, runId: runStartBody.run.id }) },
    );
    const snapshotResponse = await getSnapshotRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId }),
    });
    const snapshot = await snapshotResponse.json();

    expect(projectResponse.status).toBe(201);
    await expect(messageResponse.json()).resolves.toMatchObject({ message: { role: "teacher", content: "我要做百分数公开课" }, job: { status: "queued" } });
    expect(artifactResponse.status).toBe(201);
    expect(approveResponse.status).toBe(200);
    await expect(approvedInputsResponse.json()).resolves.toMatchObject({ artifacts: [{ id: artifactId, isApproved: true }] });
    await expect(artifactDetailResponse.json()).resolves.toMatchObject({ artifact: { id: artifactId, version: 1 } });
    expect(regenerateResponse.status).toBe(201);
    expect(runStartResponse.status).toBe(201);
    expect(runFinishResponse.status).toBe(200);
    expect(snapshot).toMatchObject({
      project: { id: projectId, title: "Stage 7 合同项目" },
      agentRuns: [{ id: runStartBody.run.id, status: "failed" }],
    });
    expect(snapshot.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "teacher", content: "我要做百分数公开课", artifactRefs: [], metadata: {} })]),
    );
    expect(snapshot.nodes.map((node: { key: string }) => node.key)).toEqual([
      "requirement_spec",
      "textbook_evidence",
      "lesson_plan",
      "ppt_draft",
      "ppt_design_draft",
      "pptx_artifact",
      "intro_video_plan",
      "knowledge_anchor_extract",
      "creative_theme_generate",
      "video_script_generate",
      "storyboard_generate",
      "asset_brief_generate",
      "asset_image_generate",
      "video_segment_plan",
      "video_segment_generate",
      "video_narration_generate",
      "concat_only_assemble",
      "image_prompts",
      "video_storyboard",
      "final_delivery",
      "interactive_courseware_spec",
    ]);
    expect(snapshot.artifacts.map((artifact: { nodeKey: string; version: number }) => [artifact.nodeKey, artifact.version])).toEqual([
      ["requirement_spec", 1],
      ["requirement_spec", 2],
    ]);
  });

  it("stores direct Artifact POSTs as reviewable teacher input without accepting forged authority", async () => {
    const projectResponse = await postProjectRoute(new Request("http://localhost/api/workbench/projects", { method: "POST" }));
    const { project } = await projectResponse.json();

    const response = await postArtifactRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          nodeKey: "requirement_spec",
          kind: "requirement_spec",
          title: "教师输入",
          status: "approved",
          summary: "教师提供的需求。",
          markdownContent: "# 教师需求",
          structuredContent: {
            artifactQualityState: {
              validationStatus: "passed",
              reviewStatus: "passed",
              downstreamEligibility: "eligible",
            },
            providerStatus: "real",
          },
        }),
      }),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.artifact).toMatchObject({ status: "needs_review", isApproved: false });
    expect(body.artifact).not.toHaveProperty("origin");
    expect(body.artifact).not.toHaveProperty("taskId");
    expect(body.artifact.structuredContent).not.toHaveProperty("artifactQualityState");
    expect(body.artifact.structuredContent).not.toHaveProperty("providerStatus");
  });

  it("keeps conflict route envelopes stable", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 7 冲突合同项目" });
    const run = await service.startAgentRun(project.id, {
      nodeKey: "lesson_plan",
      runtime: "deterministic",
    });
    await service.finishAgentRun(project.id, run.id, { status: "failed", errorMessage: "第一次失败" });

    const duplicateFinishResponse = await postFinishRun(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ status: "failed", errorMessage: "第二次失败" }),
      }),
      { params: Promise.resolve({ projectId: project.id, runId: run.id }) },
    );
    const v1 = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "v1",
      markdownContent: "# v1",
    });
    await service.regenerateArtifact(project.id, v1.id, {
      expectedLatestVersion: 1,
      title: "需求规格 v2",
      summary: "v2",
      markdownContent: "# v2",
    });
    const staleRegenerateResponse = await postRegenerateRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          expectedLatestVersion: 1,
          title: "过期重做",
          summary: "stale",
          markdownContent: "# stale",
        }),
      }),
      { params: Promise.resolve({ projectId: project.id, artifactId: v1.id }) },
    );

    expect(duplicateFinishResponse.status).toBe(409);
    await expect(duplicateFinishResponse.json()).resolves.toMatchObject({ error: expect.stringContaining("AgentRun already finished") });
    expect(staleRegenerateResponse.status).toBe(409);
    await expect(staleRegenerateResponse.json()).resolves.toMatchObject({ error: expect.stringContaining("Artifact version conflict") });
  });

  it("keeps project snapshots isolated across messages artifacts and runs", async () => {
    const service = createWorkbenchService();
    const projectA = await service.createProject({ title: "Stage 7 隔离 A" });
    const projectB = await service.createProject({ title: "Stage 7 隔离 B" });
    await service.addMessage(projectA.id, { role: "teacher", content: "A 消息" });
    await service.addMessage(projectB.id, { role: "teacher", content: "B 消息" });
    await service.saveArtifact(projectA.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "A 需求规格",
      status: "needs_review",
      summary: "A artifact",
      markdownContent: "# A",
    });
    await service.startAgentRun(projectA.id, {
      nodeKey: "lesson_plan",
      runtime: "deterministic",
    });

    const snapshotA = await service.getProjectSnapshot(projectA.id);
    const snapshotB = await service.getProjectSnapshot(projectB.id);

    expect(snapshotA.messages.map((message) => message.content)).toEqual(["A 消息"]);
    expect(snapshotB.messages.map((message) => message.content)).toEqual(["B 消息"]);
    expect(snapshotA.artifacts.map((artifact) => artifact.summary)).toEqual(["A artifact"]);
    expect(snapshotB.artifacts).toEqual([]);
    expect(snapshotA.agentRuns).toHaveLength(1);
    expect(snapshotB.agentRuns).toEqual([]);
  });
});
