import { describe, expect, it } from "vitest";
import { POST as postApproveArtifact } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/approve/route";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { createTaskBrief, type IntentGrant, type TaskBrief } from "@/server/conversation/task-contract";
import { createWorkbenchService } from "../service";
import type { ProjectRecord } from "../types";

describe("Workbench Artifact approval and capability inputs", () => {
  it("approves an Artifact without persisting a workflow-node mirror", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Artifact approval" });
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

    expect(approved).toMatchObject({ id: artifact.id, status: "approved", isApproved: true });
    expect(snapshot.artifacts).toEqual([expect.objectContaining({ id: artifact.id, isApproved: true })]);
    expect(snapshot).not.toHaveProperty("nodes");
  });

  it("resolves only current-task trusted inputs declared by the selected capability", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Capability inputs" });
    const taskBrief = await seedTask(project, `task:ppt-design:${project.id}`, ["ppt_design"]);
    const outline = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "PPT 大纲",
      status: "needs_review",
      summary: "当前任务大纲",
      markdownContent: "# PPT 大纲",
    });
    await service.approveArtifact(project.id, outline.id);
    await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "不是 ppt_design 的直接输入",
      markdownContent: "# 需求规格",
    });

    const inputs = await service.getApprovedInputs(project.id, "ppt_design", taskBrief);

    expect(inputs.map((artifact) => artifact.id)).toEqual([outline.id]);
    expect(inputs.every((artifact) => artifact.taskId === taskBrief.taskId)).toBe(true);
  });

  it("rejects input resolution for a capability outside the TaskBrief scope", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Out-of-scope capability" });
    const taskBrief = await seedTask(project, `task:lesson-only:${project.id}`, ["lesson_plan"]);

    await expect(service.getApprovedInputs(project.id, "ppt_design", taskBrief))
      .rejects.toThrow("outside the current task scope");
  });

  it("rejects approving an Artifact through another project", async () => {
    const service = createWorkbenchService();
    const projectA = await service.createProject({ title: "Project A" });
    const projectB = await service.createProject({ title: "Project B" });
    const artifactA = await service.saveArtifact(projectA.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "A 需求规格",
      status: "needs_review",
      summary: "A 专属产物",
      markdownContent: "# A",
    });

    await expect(service.approveArtifact(projectB.id, artifactA.id)).rejects.toThrow("Artifact not found");
  });

  it("keeps the Artifact approval route envelope stable", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "Approval route" });
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "route approval",
      markdownContent: "# route",
    });

    const response = await postApproveArtifact(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.id, artifactId: artifact.id }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      artifact: { id: artifact.id, status: "approved", isApproved: true },
    });
  });
});

async function seedTask(project: ProjectRecord, taskId: string, requestedOutputs: string[]): Promise<TaskBrief> {
  const taskBrief = createTaskBrief({
    taskId,
    projectId: project.id,
    intentEpoch: project.intentEpoch ?? 0,
    goal: "生成当前任务所需的 PPT 设计",
    requestedOutputs,
    constraints: ["offline_contract_test"],
    excludedOutputs: [],
    generationIntensity: project.generationIntensity ?? "standard",
    sourceMessageId: `message:${taskId}`,
  });
  const intentGrant: IntentGrant = {
    schemaVersion: "intent-grant.v1",
    taskId,
    projectId: project.id,
    intentEpoch: taskBrief.intentEpoch,
    standardWorkAuthorized: true,
    intensity: taskBrief.generationIntensity,
    budgetPolicyVersion: "stage-b-workbench.v1",
    maxCostCredits: 0,
    maxExternalProviderCalls: 0,
    requiredCheckpoints: [],
    expiresAt: null,
  };
  await createControlPlaneStore().upsertTaskAggregate({
    taskBrief,
    intentGrant,
    plan: { planId: `plan:${taskId}`, revision: 0, status: "active" },
    checkpoint: null,
  });
  return taskBrief;
}
