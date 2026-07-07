import { describe, expect, it } from "vitest";
import { POST as postProjectRoute } from "@/app/api/workbench/projects/route";
import { POST as postMessageRoute } from "@/app/api/workbench/projects/[projectId]/messages/route";
import { POST as postApproveArtifact } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/approve/route";
import { GET as getPackageRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/package/route";
import { GET as getSnapshotRoute } from "@/app/api/workbench/projects/[projectId]/snapshot/route";

describe("Local Real MVP M13 final material package route", () => {
  it("downloads a ZIP package only for the final delivery artifact", async () => {
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
    const pptOutline = snapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "ppt_draft");
    await approve(projectId, pptOutline.id);
    snapshot = await readSnapshot(projectId);
    await approve(projectId, snapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "intro_video_plan").id);

    snapshot = await readSnapshot(projectId);
    const finalDelivery = snapshot.artifacts.find((artifact: { nodeKey: string }) => artifact.nodeKey === "final_delivery");

    const packageResponse = await getPackageRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId, artifactId: finalDelivery.id }),
    });
    expect(packageResponse.status).toBe(200);
    expect(packageResponse.headers.get("content-type")).toContain("application/zip");
    expect(packageResponse.headers.get("content-disposition")).toMatch(/\.zip"/);
    const packageBuffer = Buffer.from(await packageResponse.arrayBuffer());
    expect(packageBuffer.subarray(0, 2).toString("utf8")).toBe("PK");

    const nonFinalResponse = await getPackageRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId, artifactId: pptOutline.id }),
    });
    expect(nonFinalResponse.status).toBe(400);
    expect(nonFinalResponse.headers.get("content-type")).not.toContain("application/zip");
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
