import { describe, expect, it } from "vitest";
import { POST as postApproveArtifact } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/approve/route";
import { GET as getArtifactRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/route";
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
    const artifactDetailResponse = await getArtifactRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId, artifactId }),
    });
    const regenerateResponse = await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          role: "teacher",
          content: "请基于当前任务重新生成「需求规格」，保留旧版本供我对比。",
          artifactRefs: [artifactId],
          idempotencyKey: `regenerate:${projectId}:${artifactId}`,
        }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    const regenerateBody = await regenerateResponse.json();
    const snapshotResponse = await getSnapshotRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId }),
    });
    const snapshot = await snapshotResponse.json();

    expect(projectResponse.status).toBe(201);
    await expect(messageResponse.json()).resolves.toMatchObject({ message: { role: "teacher", content: "我要做百分数公开课" }, job: { status: "queued" } });
    expect(artifactResponse.status).toBe(201);
    expect(approveResponse.status).toBe(200);
    await expect(artifactDetailResponse.json()).resolves.toMatchObject({ artifact: { id: artifactId, version: 1 } });
    expect(regenerateResponse.status).toBe(202);
    expect(regenerateBody).toMatchObject({
      message: {
        role: "teacher",
        content: "请基于当前任务重新生成「需求规格」，保留旧版本供我对比。",
        artifactRefs: [artifactId],
      },
      job: { status: "queued", teacherMessageId: regenerateBody.message.id },
    });
    expect(regenerateBody).not.toHaveProperty("artifact");
    expect(snapshot).toMatchObject({ project: { id: projectId, title: "Stage 7 合同项目", intentEpoch: 0 } });
    expect(snapshot).not.toHaveProperty("nodes");
    expect(snapshot).not.toHaveProperty("agentRuns");
    expect(snapshot.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "teacher", content: "我要做百分数公开课", artifactRefs: [], metadata: {} })]),
    );
    expect(snapshot.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: regenerateBody.message.content, artifactRefs: [artifactId] }),
    ]));
    expect(snapshot.artifacts.map((artifact: { nodeKey: string; version: number }) => [artifact.nodeKey, artifact.version]))
      .toEqual([["requirement_spec", 1]]);
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

  it("keeps Artifact versions project-scoped and switches the single approved pointer", async () => {
    const service = createWorkbenchService();
    const projectA = await service.createProject({ title: "Stage 7 版本 A" });
    const projectB = await service.createProject({ title: "Stage 7 版本 B" });
    const first = await service.saveArtifact(projectA.id, {
      nodeKey: "requirement_spec", kind: "requirement_spec", title: "A v1",
      status: "needs_review", summary: "A v1", markdownContent: "# A v1",
    });
    await service.approveArtifact(projectA.id, first.id);
    const second = await service.saveArtifact(projectA.id, {
      nodeKey: "requirement_spec", kind: "requirement_spec", title: "A v2",
      status: "needs_review", summary: "A v2", markdownContent: "# A v2",
    });
    const projectBFirst = await service.saveArtifact(projectB.id, {
      nodeKey: "requirement_spec", kind: "requirement_spec", title: "B v1",
      status: "needs_review", summary: "B v1", markdownContent: "# B v1",
    });

    expect(second.version).toBe(2);
    expect(projectBFirst.version).toBe(1);
    await service.approveArtifact(projectA.id, second.id);
    const snapshot = await service.getProjectSnapshot(projectA.id);
    expect(snapshot.artifacts.map((artifact) => [artifact.version, artifact.isApproved])).toEqual([[1, false], [2, true]]);
  });

  it("keeps project snapshots isolated across messages and Artifacts", async () => {
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
    const snapshotA = await service.getProjectSnapshot(projectA.id);
    const snapshotB = await service.getProjectSnapshot(projectB.id);

    expect(snapshotA.messages.map((message) => message.content)).toEqual(["A 消息"]);
    expect(snapshotB.messages.map((message) => message.content)).toEqual(["B 消息"]);
    expect(snapshotA.artifacts.map((artifact) => artifact.summary)).toEqual(["A artifact"]);
    expect(snapshotB.artifacts).toEqual([]);
    expect(snapshotA).not.toHaveProperty("agentRuns");
    expect(snapshotB).not.toHaveProperty("agentRuns");
  });
});
