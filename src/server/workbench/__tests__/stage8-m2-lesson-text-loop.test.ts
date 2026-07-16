import { describe, expect, it } from "vitest";
import { POST as postApproveArtifact } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/approve/route";
import { createWorkbenchService } from "@/server/workbench/service";

describe("Local Real MVP M2 approval compatibility", () => {
  it("does not generate the next node when an artifact is approved", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M2 approval compatibility" });
    const requirement = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "离线需求规格",
      status: "needs_review",
      summary: "仅验证批准路由不会自动生成下一节点。",
      markdownContent: "# 离线需求规格",
    });

    const requirementApproveResponse = await postApproveArtifact(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ projectId: project.id, artifactId: requirement.id }),
    });
    const textbookSnapshot = await service.getProjectSnapshot(project.id);
    const textbook = textbookSnapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "textbook_evidence");

    expect(requirementApproveResponse.status).toBe(200);
    expect(textbook).toBeUndefined();
    expect(textbookSnapshot.artifacts.map((artifact: { nodeKey: string }) => artifact.nodeKey)).toEqual(["requirement_spec"]);
  });
});
