import { describe, expect, it } from "vitest";
import { POST as postProjectRoute } from "@/app/api/workbench/projects/route";
import { POST as postApproveArtifact } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/approve/route";
import { GET as getSnapshotRoute } from "@/app/api/workbench/projects/[projectId]/snapshot/route";
import { DeterministicRuntime } from "@/server/agent-runtime/deterministic-runtime";
import { createConversationTurnService } from "@/server/conversation/conversation-turn-service";
import { createWorkbenchService } from "@/server/workbench/service";

describe("Local Real MVP M3 PPT outline loop", () => {
  it("generates a PPT outline text artifact after approving the lesson plan", async () => {
    const projectResponse = await postProjectRoute(new Request("http://localhost/api/workbench/projects", { method: "POST" }));
    const projectBody = await projectResponse.json();
    const projectId = projectBody.project.id;

    await createRequirement(projectId, "我想要生成一个小学五年级关于百分数这个知识点的公开课 PPT。");

    let snapshot = await readSnapshot(projectId);
    await approve(projectId, snapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "requirement_spec").id);
    snapshot = await readSnapshot(projectId);
    await approve(projectId, snapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "textbook_evidence").id);
    snapshot = await readSnapshot(projectId);
    await approve(projectId, snapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "lesson_plan").id);

    snapshot = await readSnapshot(projectId);
    const pptOutline = snapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "ppt_draft");

    expect(pptOutline).toMatchObject({
      nodeKey: "ppt_draft",
      title: "PPT 大纲与逐页脚本",
      status: "needs_review",
      version: 1,
    });
    expect(pptOutline.markdownContent).toContain("## 页面结构");
    expect(pptOutline.markdownContent).toContain("## 逐页脚本原则");
    expect(pptOutline.markdownContent).toContain("## 主视觉需求");
    expect(pptOutline.markdownContent).not.toContain("PPTX 文件已生成");
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

async function createRequirement(projectId: string, content: string) {
  const service = createWorkbenchService();
  const turnService = createConversationTurnService({ service, runtime: new DeterministicRuntime() });
  const planningBody = await turnService.createTurn(projectId, { role: "teacher", content });
  await turnService.createTurn(projectId, {
    role: "teacher",
    content: "确认开始",
    confirmedActionId: `human:${projectId}:requirement_spec:${planningBody.assistantMessage?.id}`,
  });
}
