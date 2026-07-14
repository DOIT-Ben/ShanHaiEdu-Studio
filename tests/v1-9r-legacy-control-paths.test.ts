import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { POST as approveArtifactRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/approve/route";
import { GET as downloadPackageRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/package/route";
import { createWorkbenchService } from "@/server/workbench/service";

describe("V1-9R4 legacy control paths", () => {
  it("keeps package download as a stored-asset read without latest-artifact assembly", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/package/route.ts"), "utf8");
    expect(source).not.toMatch(/getLatestPptArtifact|getLatestImageDownload|getLatestVideoDownload|buildFinalMaterialPackageDownload/);
  });

  it("approves only the selected artifact without deterministic next-node generation", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "R4 approve boundary" });
    const requirement = await service.saveArtifact(project.id, {
      nodeKey: "requirement_spec", kind: "requirement_spec", title: "需求规格", status: "needs_review",
      summary: "明确任务范围。", markdownContent: "# 需求规格", structuredContent: {},
    });

    const response = await approveArtifactRoute(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ projectId: project.id, artifactId: requirement.id }),
    });

    expect(response.status).toBe(200);
    expect(await service.getArtifact(project.id, requirement.id)).toMatchObject({ status: "approved", isApproved: true });
    expect((await service.getArtifacts(project.id)).map((artifact) => artifact.kind)).toEqual(["requirement_spec"]);
  });

  it("fails closed when final delivery has no persisted package asset even if loose latest files exist", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "R4 package boundary" });
    const finalDelivery = await service.saveArtifact(project.id, {
      nodeKey: "final_delivery", kind: "final_delivery", title: "旧最终清单", status: "needs_review",
      summary: "只有清单，没有正式包文件。", markdownContent: "# 最终清单", structuredContent: {},
    });
    const files = await writeLoosePackageFixtures(project.id);
    await service.saveArtifact(project.id, {
      nodeKey: "pptx_artifact", kind: "pptx_artifact", title: "未绑定 PPTX", status: "needs_review",
      summary: "未绑定到最终包。", markdownContent: "PPTX", structuredContent: { storage: { cozePptx: { localOutput: files.pptx, fileName: "loose.pptx" } } },
    });
    await service.saveArtifact(project.id, {
      nodeKey: "image_prompts", kind: "image_prompts", title: "未绑定图片", status: "needs_review",
      summary: "未绑定到最终包。", markdownContent: "图片", structuredContent: { storage: { imageAsset: { localOutput: files.image, fileName: "loose.png" } } },
    });
    await service.saveArtifact(project.id, {
      nodeKey: "intro_video_plan", kind: "intro_video_plan", title: "未绑定视频", status: "needs_review",
      summary: "未绑定到最终包。", markdownContent: "视频", structuredContent: { storage: { videoAsset: { localOutput: files.video, fileName: "loose.mp4" } } },
    });

    const response = await downloadPackageRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.id, artifactId: finalDelivery.id }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).not.toContain("application/zip");
  });
});

async function writeLoosePackageFixtures(projectId: string) {
  const dir = path.join(process.cwd(), ".tmp", "v1-9r4-package-boundary", projectId);
  mkdirSync(dir, { recursive: true });
  const pptxZip = new JSZip();
  pptxZip.file("[Content_Types].xml", "<Types />");
  pptxZip.file("ppt/presentation.xml", "<presentation />");
  const pptxPath = path.join(dir, "loose.pptx");
  writeFileSync(pptxPath, Buffer.from(await pptxZip.generateAsync({ type: "nodebuffer" })));
  const imagePath = path.join(dir, "loose.png");
  writeFileSync(imagePath, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    Buffer.from("IHDR"),
    Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00]),
    Buffer.alloc(4),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from("IEND"),
    Buffer.alloc(4),
  ]));
  const videoPath = path.join(dir, "loose.mp4");
  writeFileSync(videoPath, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(1024)]));
  const relative = (filePath: string) => path.relative(process.cwd(), filePath).replaceAll("\\", "/");
  return { pptx: relative(pptxPath), image: relative(imagePath), video: relative(videoPath) };
}
