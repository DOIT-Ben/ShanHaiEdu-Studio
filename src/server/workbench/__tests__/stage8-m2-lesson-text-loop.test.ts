import { describe, expect, it } from "vitest";
import { POST as postProjectRoute } from "@/app/api/workbench/projects/route";
import { POST as postMessageRoute } from "@/app/api/workbench/projects/[projectId]/messages/route";
import { POST as postApproveArtifact } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/approve/route";
import { GET as getSnapshotRoute } from "@/app/api/workbench/projects/[projectId]/snapshot/route";

describe("Local Real MVP M2 lesson text loop", () => {
  it("generates textbook evidence after approving requirements and lesson plan after approving textbook evidence", async () => {
    const projectResponse = await postProjectRoute(new Request("http://localhost/api/workbench/projects", { method: "POST" }));
    const projectBody = await projectResponse.json();
    const projectId = projectBody.project.id;

    await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          role: "teacher",
          content: "我想要生成一个小学五年级关于百分数这个知识点的公开课 PPT。",
        }),
      }),
      { params: Promise.resolve({ projectId }) },
    );
    await postMessageRoute(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: "确认开始" }),
      }),
      { params: Promise.resolve({ projectId }) },
    );

    const requirementSnapshotResponse = await getSnapshotRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId }),
    });
    const requirementSnapshot = await requirementSnapshotResponse.json();
    const requirement = requirementSnapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "requirement_spec");

    const requirementApproveResponse = await postApproveArtifact(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ projectId, artifactId: requirement.id }),
    });
    const textbookSnapshotResponse = await getSnapshotRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId }),
    });
    const textbookSnapshot = await textbookSnapshotResponse.json();
    const textbook = textbookSnapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "textbook_evidence");

    expect(requirementApproveResponse.status).toBe(200);
    expect(textbook).toMatchObject({
      nodeKey: "textbook_evidence",
      title: "教材证据包",
      status: "needs_review",
      version: 1,
    });

    const textbookApproveResponse = await postApproveArtifact(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ projectId, artifactId: textbook.id }),
    });
    const lessonSnapshotResponse = await getSnapshotRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId }),
    });
    const lessonSnapshot = await lessonSnapshotResponse.json();
    const lesson = lessonSnapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "lesson_plan");

    expect(textbookApproveResponse.status).toBe(200);
    expect(lesson).toMatchObject({
      nodeKey: "lesson_plan",
      title: "公开课教案",
      status: "needs_review",
      version: 1,
    });
    expect(lesson.markdownContent).toContain("## 教学目标");
  });
});
