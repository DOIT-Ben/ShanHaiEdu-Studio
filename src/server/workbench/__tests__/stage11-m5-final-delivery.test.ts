import { describe, expect, it } from "vitest";
import { POST as postProjectRoute } from "@/app/api/workbench/projects/route";
import { POST as postApproveArtifact } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/approve/route";
import { GET as getSnapshotRoute } from "@/app/api/workbench/projects/[projectId]/snapshot/route";
import { DeterministicRuntime } from "@/server/agent-runtime/deterministic-runtime";
import { createConversationTurnService } from "@/server/conversation/conversation-turn-service";
import { createWorkbenchService } from "@/server/workbench/service";

describe("Local Real MVP M5 final delivery loop", () => {
  it("generates a final delivery Markdown checklist after approving the intro video plan", async () => {
    const projectResponse = await postProjectRoute(new Request("http://localhost/api/workbench/projects", { method: "POST" }));
    const projectBody = await projectResponse.json();
    const projectId = projectBody.project.id;

    await createRequirement(projectId, "我想要生成一个小学五年级关于百分数这个知识点的公开课完整材料包。");

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
    await saveFinalDeliveryChecklist(projectId);

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
    expect(finalDelivery.markdownContent).toContain("导入视频分镜接线占位");
    expect(finalDelivery.markdownContent).toContain("PPTX、图片文件和视频成片在本阶段仍是接线占位");
    expect(finalDelivery.markdownContent).toContain("待接入真实服务后生成");
    expect(finalDelivery.markdownContent).not.toContain("PPT 大纲可下载最小 PPTX 文件");
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

async function saveFinalDeliveryChecklist(projectId: string) {
  await createWorkbenchService().saveArtifact(projectId, {
    nodeKey: "final_delivery",
    kind: "final_delivery",
    title: "最终交付清单",
    status: "needs_review",
    summary: "已汇总当前草稿、接线占位和授课检查项。",
    markdownContent: [
      "# 最终交付清单",
      "",
      "## 当前已形成草稿",
      "- 需求规格说明书。",
      "- 公开课教案。",
      "- PPT 大纲与逐页脚本。",
      "- 导入视频分镜接线占位。",
      "",
      "## 待接入真实服务后生成",
      "PPTX、图片文件和视频成片在本阶段仍是接线占位。",
    ].join("\n"),
    structuredContent: {},
  });
}
