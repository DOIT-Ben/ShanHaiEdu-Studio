import { describe, expect, it } from "vitest";
import { POST as postProjectRoute } from "@/app/api/workbench/projects/route";
import { POST as postMessageRoute } from "@/app/api/workbench/projects/[projectId]/messages/route";
import { POST as postApproveArtifact } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/approve/route";
import { GET as getSnapshotRoute } from "@/app/api/workbench/projects/[projectId]/snapshot/route";

describe("Local Real MVP M4 intro video plan loop", () => {
  it("generates an intro video plan text artifact after approving the PPT outline", async () => {
    const projectResponse = await postProjectRoute(new Request("http://localhost/api/workbench/projects", { method: "POST" }));
    const projectBody = await projectResponse.json();
    const projectId = projectBody.project.id;

    await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          role: "teacher",
          content: "我想要生成一个小学五年级关于百分数这个知识点的公开课 PPT 和导入视频方案。",
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
    const introVideoPlan = snapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "intro_video_plan");

    expect(introVideoPlan).toMatchObject({
      nodeKey: "intro_video_plan",
      title: "导入视频方案",
      status: "needs_review",
      version: 1,
    });
    expect(introVideoPlan.markdownContent).toContain("## 独立主题");
    expect(introVideoPlan.markdownContent).toContain("## 开场钩子与吸睛点");
    expect(introVideoPlan.markdownContent).toContain("吸睛点");
    expect(introVideoPlan.markdownContent).toContain("## 课程锚点");
    expect(introVideoPlan.markdownContent).toContain("课堂落点问题");
    expect(introVideoPlan.markdownContent).not.toContain("视频文件已生成");
    expect(introVideoPlan.markdownContent).not.toContain("视频成片已生成");
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
