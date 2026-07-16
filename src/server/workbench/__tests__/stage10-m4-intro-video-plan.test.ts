import { describe, expect, it } from "vitest";
import { POST as postApproveArtifact } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/approve/route";
import { createWorkbenchService } from "@/server/workbench/service";

describe("Local Real MVP M4 approval compatibility", () => {
  it("does not generate a video plan from artifact approval", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M4 approval compatibility" });
    const requirement = await seedRequirement(service, project.id);
    await approve(project.id, requirement.id);
    const snapshot = await service.getProjectSnapshot(project.id);
    const introVideoPlan = snapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "intro_video_plan");

    expect(introVideoPlan).toBeUndefined();
    expect(snapshot.artifacts.map((artifact: { nodeKey: string }) => artifact.nodeKey)).toEqual(["requirement_spec"]);
  });
});

async function approve(projectId: string, artifactId: string) {
  await postApproveArtifact(new Request("http://localhost", { method: "POST" }), {
    params: Promise.resolve({ projectId, artifactId }),
  });
}

async function seedRequirement(service: ReturnType<typeof createWorkbenchService>, projectId: string) {
  return service.saveArtifact(projectId, {
    nodeKey: "requirement_spec",
    kind: "requirement_spec",
    title: "离线需求规格",
    status: "needs_review",
    summary: "仅验证批准路由不会自动推进视频。",
    markdownContent: "# 离线需求规格",
  });
}
