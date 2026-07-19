import { describe, expect, it } from "vitest";
import { createWorkbenchService } from "../service";

describe("Workbench persistence contract", () => {
  it("creates a project without exposing legacy orchestration projections", async () => {
    const service = createWorkbenchService();

    const project = await service.createProject({
      title: "五年级《百分数》公开课",
      subject: "数学",
      grade: "五年级",
      lessonTopic: "百分数",
    });

    const snapshot = await service.getProjectSnapshot(project.id);

    expect(snapshot.project.id).toBe(project.id);
    expect(snapshot.project.title).toBe("五年级《百分数》公开课");
    expect(snapshot).not.toHaveProperty("nodes");
    expect(snapshot).not.toHaveProperty("agentRuns");
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.artifacts).toEqual([]);
  });

  it("stores and reads conversation messages by project", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "消息保存项目" });

    await service.addMessage(project.id, {
      role: "teacher",
      content: "我想做一节百分数公开课。",
    });

    const snapshot = await service.getProjectSnapshot(project.id);

    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0]).toMatchObject({
      projectId: project.id,
      role: "teacher",
      content: "我想做一节百分数公开课。",
    });
  });

  it("stores and reads artifacts by project and node", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "产物保存项目" });

    await service.saveArtifact(project.id, {
      nodeKey: "lesson_plan",
      kind: "lesson_plan",
      title: "公开课教案",
      status: "needs_review",
      summary: "围绕百分数意义组织教学流程。",
      markdownContent: "# 公开课教案\n\n## 教学目标\n理解百分数的意义。",
      structuredContent: { goals: ["理解百分数的意义"] },
    });

    const snapshot = await service.getProjectSnapshot(project.id);

    expect(snapshot.artifacts).toHaveLength(1);
    expect(snapshot.artifacts[0]).toMatchObject({
      projectId: project.id,
      nodeKey: "lesson_plan",
      kind: "lesson_plan",
      version: 1,
      isApproved: false,
      markdownContent: "# 公开课教案\n\n## 教学目标\n理解百分数的意义。",
    });
  });

  it("approves the latest artifact without a second node truth", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "确认产物项目" });

    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格说明书",
      status: "needs_review",
      summary: "等待教师确认。",
      markdownContent: "## 需求规格",
      structuredContent: {},
    });

    await service.approveArtifact(project.id, artifact.id);

    const snapshot = await service.getProjectSnapshot(project.id);
    expect(snapshot.artifacts[0]).toMatchObject({
      id: artifact.id,
      status: "approved",
      isApproved: true,
    });
    expect(snapshot).not.toHaveProperty("nodes");
  });

  it("keeps two projects isolated in snapshots", async () => {
    const service = createWorkbenchService();
    const projectA = await service.createProject({ title: "A 项目" });
    const projectB = await service.createProject({ title: "B 项目" });

    await service.addMessage(projectA.id, { role: "teacher", content: "A 的需求" });
    await service.addMessage(projectB.id, { role: "teacher", content: "B 的需求" });
    await service.saveArtifact(projectA.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "A 需求规格",
      status: "needs_review",
      summary: "只属于 A",
      markdownContent: "A markdown",
      structuredContent: { marker: "A" },
    });
    await service.saveArtifact(projectB.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "B 需求规格",
      status: "needs_review",
      summary: "只属于 B",
      markdownContent: "B markdown",
      structuredContent: { marker: "B" },
    });

    const snapshotA = await service.getProjectSnapshot(projectA.id);
    const snapshotB = await service.getProjectSnapshot(projectB.id);

    expect(snapshotA.messages.map((message) => message.content)).toEqual(["A 的需求"]);
    expect(snapshotB.messages.map((message) => message.content)).toEqual(["B 的需求"]);
    expect(snapshotA.artifacts.map((artifact) => artifact.summary)).toEqual(["只属于 A"]);
    expect(snapshotB.artifacts.map((artifact) => artifact.summary)).toEqual(["只属于 B"]);
  });
});
