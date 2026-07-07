import { describe, expect, it } from "vitest";
import { createWorkbenchService } from "../service";

describe("Backend Workflow Lite Stage 4 stale propagation", () => {
  it("marks approved direct downstream nodes stale when an upstream new version is approved", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 4 stale 项目" });
    const requirementV1 = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "需求 v1",
      markdownContent: "# req v1",
    });
    await service.approveArtifact(project.id, requirementV1.id);
    const lesson = await service.saveArtifact(project.id, {
      nodeKey: "lesson_plan",
      kind: "lesson_plan",
      title: "教案",
      status: "needs_review",
      summary: "教案 v1",
      markdownContent: "# lesson v1",
    });
    await service.approveArtifact(project.id, lesson.id);

    const requirementV2 = await service.regenerateArtifact(project.id, requirementV1.id, {
      title: "需求规格重做",
      summary: "需求 v2",
      markdownContent: "# req v2",
    });
    await service.approveArtifact(project.id, requirementV2.id);

    const snapshot = await service.getProjectSnapshot(project.id);
    const requirementNode = snapshot.nodes.find((node) => node.key === "requirement_spec");
    const lessonNode = snapshot.nodes.find((node) => node.key === "lesson_plan");

    expect(requirementNode?.status).toBe("approved");
    expect(lessonNode).toMatchObject({
      status: "stale",
      approvedArtifactId: lesson.id,
    });
    expect(lessonNode?.staleReason).toBe("「需求规格」已更新确认，需要重新检查相关内容。");
  });

  it("does not mark unapproved downstream nodes stale", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 4 未确认下游项目" });
    const requirementV1 = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "需求 v1",
      markdownContent: "# req v1",
    });
    await service.approveArtifact(project.id, requirementV1.id);
    await service.saveArtifact(project.id, {
      nodeKey: "lesson_plan",
      kind: "lesson_plan",
      title: "教案",
      status: "needs_review",
      summary: "未确认教案",
      markdownContent: "# lesson draft",
    });

    const requirementV2 = await service.regenerateArtifact(project.id, requirementV1.id, {
      title: "需求规格重做",
      summary: "需求 v2",
      markdownContent: "# req v2",
    });
    await service.approveArtifact(project.id, requirementV2.id);

    const snapshot = await service.getProjectSnapshot(project.id);
    const lessonNode = snapshot.nodes.find((node) => node.key === "lesson_plan");

    expect(lessonNode?.status).toBe("needs_review");
    expect(lessonNode?.staleReason).toBeNull();
  });

  it("keeps stale downstream artifact content available", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 4 保留内容项目" });
    const requirementV1 = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "需求 v1",
      markdownContent: "# req v1",
    });
    await service.approveArtifact(project.id, requirementV1.id);
    const lesson = await service.saveArtifact(project.id, {
      nodeKey: "lesson_plan",
      kind: "lesson_plan",
      title: "教案",
      status: "needs_review",
      summary: "保留教案",
      markdownContent: "# lesson retained",
    });
    await service.approveArtifact(project.id, lesson.id);

    const requirementV2 = await service.regenerateArtifact(project.id, requirementV1.id, {
      title: "需求规格重做",
      summary: "需求 v2",
      markdownContent: "# req v2",
    });
    await service.approveArtifact(project.id, requirementV2.id);

    const snapshot = await service.getProjectSnapshot(project.id);
    const retained = snapshot.artifacts.find((artifact) => artifact.id === lesson.id);

    expect(retained).toMatchObject({
      markdownContent: "# lesson retained",
      isApproved: true,
    });
  });

  it("marks only direct downstream nodes stale in Stage 4", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 4 直接下游项目" });
    const requirementV1 = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "需求 v1",
      markdownContent: "# req v1",
    });
    await service.approveArtifact(project.id, requirementV1.id);
    const lesson = await service.saveArtifact(project.id, {
      nodeKey: "lesson_plan",
      kind: "lesson_plan",
      title: "教案",
      status: "needs_review",
      summary: "教案 v1",
      markdownContent: "# lesson v1",
    });
    await service.approveArtifact(project.id, lesson.id);
    const ppt = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "PPT 草稿",
      status: "needs_review",
      summary: "PPT v1",
      markdownContent: "# ppt v1",
    });
    await service.approveArtifact(project.id, ppt.id);

    const requirementV2 = await service.regenerateArtifact(project.id, requirementV1.id, {
      title: "需求规格重做",
      summary: "需求 v2",
      markdownContent: "# req v2",
    });
    await service.approveArtifact(project.id, requirementV2.id);

    const snapshot = await service.getProjectSnapshot(project.id);
    const lessonNode = snapshot.nodes.find((node) => node.key === "lesson_plan");
    const pptNode = snapshot.nodes.find((node) => node.key === "ppt_draft");

    expect(lessonNode?.status).toBe("stale");
    expect(pptNode?.status).toBe("approved");
  });

  it("clears stale reason when a stale node is approved again", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 4 复审项目" });
    const requirementV1 = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "需求 v1",
      markdownContent: "# req v1",
    });
    await service.approveArtifact(project.id, requirementV1.id);
    const lesson = await service.saveArtifact(project.id, {
      nodeKey: "lesson_plan",
      kind: "lesson_plan",
      title: "教案",
      status: "needs_review",
      summary: "教案 v1",
      markdownContent: "# lesson v1",
    });
    await service.approveArtifact(project.id, lesson.id);
    const requirementV2 = await service.regenerateArtifact(project.id, requirementV1.id, {
      title: "需求规格重做",
      summary: "需求 v2",
      markdownContent: "# req v2",
    });
    await service.approveArtifact(project.id, requirementV2.id);

    await service.approveArtifact(project.id, lesson.id);

    const snapshot = await service.getProjectSnapshot(project.id);
    const lessonNode = snapshot.nodes.find((node) => node.key === "lesson_plan");

    expect(lessonNode).toMatchObject({
      status: "approved",
      staleReason: null,
    });
  });

  it("does not re-stale downstream nodes when approving the same upstream artifact again", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Stage 4 重复确认项目" });
    const requirement = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "需求",
      markdownContent: "# req",
    });
    await service.approveArtifact(project.id, requirement.id);
    const lesson = await service.saveArtifact(project.id, {
      nodeKey: "lesson_plan",
      kind: "lesson_plan",
      title: "教案",
      status: "needs_review",
      summary: "教案",
      markdownContent: "# lesson",
    });
    await service.approveArtifact(project.id, lesson.id);

    await service.approveArtifact(project.id, requirement.id);

    const snapshot = await service.getProjectSnapshot(project.id);
    const lessonNode = snapshot.nodes.find((node) => node.key === "lesson_plan");

    expect(lessonNode).toMatchObject({
      status: "approved",
      staleReason: null,
    });
  });
});
