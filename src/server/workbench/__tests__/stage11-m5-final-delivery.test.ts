import { describe, expect, it } from "vitest";
import { POST as postProjectRoute } from "@/app/api/workbench/projects/route";
import { POST as postMessageRoute } from "@/app/api/workbench/projects/[projectId]/messages/route";
import { POST as postApproveArtifact } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/approve/route";
import { GET as getSnapshotRoute } from "@/app/api/workbench/projects/[projectId]/snapshot/route";

describe("Local Real MVP M5 final delivery loop", () => {
  it("generates a final delivery Markdown checklist after approving the intro video plan", async () => {
    const projectResponse = await postProjectRoute(new Request("http://localhost/api/workbench/projects", { method: "POST" }));
    const projectBody = await projectResponse.json();
    const projectId = projectBody.project.id;

    await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          role: "teacher",
          content: "我想要生成一个小学五年级关于百分数这个知识点的公开课完整材料包。",
        }),
      }),
      { params: Promise.resolve({ projectId }) },
    );

    let snapshot = await readSnapshot(projectId);
    await approve(projectId, snapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "requirement_spec").id);
    snapshot = await readSnapshot(projectId);
    await approve(projectId, snapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "textbook_evidence").id);
    snapshot = await readSnapshot(projectId);
    await approve(projectId, snapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "lesson_plan").id);
    snapshot = await readSnapshot(projectId);
    await approve(projectId, snapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "ppt_draft").id);
    snapshot = await readSnapshot(projectId);
    await approve(projectId, snapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "intro_video_plan").id);

    snapshot = await readSnapshot(projectId);
    const finalDelivery = snapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "final_delivery");

    expect(finalDelivery).toMatchObject({
      nodeKey: "final_delivery",
      title: "最终交付清单",
      status: "needs_review",
      version: 1,
    });
    expect(finalDelivery.markdownContent).toContain("需求规格说明书");
    expect(finalDelivery.markdownContent).toContain("公开课教案");
    expect(finalDelivery.markdownContent).toContain("PPT 大纲与逐页脚本");
    expect(finalDelivery.markdownContent).toContain("导入视频方案");
    expect(finalDelivery.markdownContent).toContain("PPT 大纲可下载最小 PPTX 文件");
    expect(finalDelivery.markdownContent).toContain("图片文件、视频成片、动画和视觉精修仍待生成或完善");
    expect(finalDelivery.markdownContent).not.toContain("PPTX 文件已生成");
    expect(finalDelivery.markdownContent).not.toContain("图片文件已生成");
    expect(finalDelivery.markdownContent).not.toContain("视频成片已生成");
  });
});

async function approve(projectId: string, artifactId: string) {
  await postApproveArtifact(new Request("http://localhost", { method: "POST" }), {
    params: Promise.resolve({ projectId, artifactId }),
  });
}

async function readSnapshot(projectId: string) {
  const response = await getSnapshotRoute(new Request("http://localhost"), {
    params: Promise.resolve({ projectId }),
  });
  return response.json();
}
