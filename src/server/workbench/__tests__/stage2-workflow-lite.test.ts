import { describe, expect, it } from "vitest";
import { GET as getApprovedInputs } from "@/app/api/workbench/projects/[projectId]/approved-inputs/route";
import { POST as postApproveArtifact } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/approve/route";
import { createWorkbenchService } from "../service";

describe("Backend Workflow Lite Stage 2 approve flow", () => {
  it("approves an artifact and stores it on the workflow node", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 2 确认项目" });
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "待确认需求规格",
      markdownContent: "# 需求规格",
      structuredContent: { topic: "百分数" },
    });

    const approved = await service.approveArtifact(project.id, artifact.id);
    const snapshot = await service.getProjectSnapshot(project.id);
    const node = snapshot.nodes.find((entry) => entry.key === "requirement_spec");

    expect(approved).toMatchObject({
      id: artifact.id,
      status: "approved",
      isApproved: true,
    });
    expect(node).toMatchObject({
      status: "approved",
      approvedArtifactId: artifact.id,
    });
  });

  it("returns only approved upstream artifacts as downstream inputs", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 2 下游输入项目" });
    const requirement = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "已确认需求",
      markdownContent: "# 已确认需求",
    });
    await service.saveArtifact(project.id, {
      nodeKey: "textbook_evidence",
      kind: "textbook_evidence",
      title: "教材证据",
      status: "needs_review",
      summary: "未确认教材",
      markdownContent: "# 未确认教材",
    });

    await service.approveArtifact(project.id, requirement.id);

    const inputs = await service.getApprovedInputs(project.id, "lesson_plan");

    expect(inputs.map((artifact) => artifact.nodeKey)).toEqual(["requirement_spec"]);
    expect(inputs.map((artifact) => artifact.summary)).toEqual(["已确认需求"]);
  });

  it("includes textbook evidence after it is approved for lesson planning", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 2 双上游项目" });
    const requirement = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "已确认需求",
      markdownContent: "# 已确认需求",
    });
    const textbook = await service.saveArtifact(project.id, {
      nodeKey: "textbook_evidence",
      kind: "textbook_evidence",
      title: "教材证据",
      status: "needs_review",
      summary: "已确认教材",
      markdownContent: "# 已确认教材",
    });

    await service.approveArtifact(project.id, requirement.id);
    await service.approveArtifact(project.id, textbook.id);

    const inputs = await service.getApprovedInputs(project.id, "lesson_plan");

    expect(inputs.map((artifact) => artifact.nodeKey)).toEqual(["requirement_spec", "textbook_evidence"]);
  });

  it("rejects approving an artifact through another project", async () => {
    const service = createWorkbenchService();
    const projectA = await service.createProject({ title: "Stage 2 项目 A" });
    const projectB = await service.createProject({ title: "Stage 2 项目 B" });
    const artifactA = await service.saveArtifact(projectA.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "A 需求规格",
      status: "needs_review",
      summary: "A 专属产物",
      markdownContent: "# A",
    });

    await expect(service.approveArtifact(projectB.id, artifactA.id)).rejects.toThrow("Artifact not found");

    const snapshotB = await service.getProjectSnapshot(projectB.id);
    expect(snapshotB.artifacts).toEqual([]);
  });

  it("returns stable API envelopes for approve and approved inputs", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 2 route 合同项目" });
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "route 已确认上游",
      markdownContent: "# route",
    });

    const approveResponse = await postApproveArtifact(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.id, artifactId: artifact.id }),
    });
    const approveBody = await approveResponse.json();
    const inputsResponse = await getApprovedInputs(
      new Request(`http://localhost/api/workbench/projects/${project.id}/approved-inputs?nodeKey=lesson_plan`),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    const inputsBody = await inputsResponse.json();

    expect(approveResponse.status).toBe(200);
    expect(approveBody.artifact).toMatchObject({ id: artifact.id, status: "approved", isApproved: true });
    expect(inputsResponse.status).toBe(200);
    expect(inputsBody.artifacts.map((entry: { nodeKey: string }) => entry.nodeKey)).toEqual(["requirement_spec"]);
  });

  it("returns route-level errors for invalid node keys and cross-project approve", async () => {
    const service = createWorkbenchService();
    const projectA = await service.createProject({ title: "Stage 2 route 项目 A" });
    const projectB = await service.createProject({ title: "Stage 2 route 项目 B" });
    const artifactA = await service.saveArtifact(projectA.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "A 需求规格",
      status: "needs_review",
      summary: "A route 专属",
      markdownContent: "# A route",
    });

    const crossProjectResponse = await postApproveArtifact(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: projectB.id, artifactId: artifactA.id }),
    });
    const invalidNodeResponse = await getApprovedInputs(
      new Request(`http://localhost/api/workbench/projects/${projectB.id}/approved-inputs?nodeKey=bad_node`),
      { params: Promise.resolve({ projectId: projectB.id }) },
    );

    expect(crossProjectResponse.status).toBe(404);
    await expect(crossProjectResponse.json()).resolves.toMatchObject({ error: expect.stringContaining("Artifact not found") });
    expect(invalidNodeResponse.status).toBe(400);
    await expect(invalidNodeResponse.json()).resolves.toMatchObject({ error: "Invalid nodeKey" });
  });
});
