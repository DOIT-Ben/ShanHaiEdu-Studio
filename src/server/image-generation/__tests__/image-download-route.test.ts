import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET as getImageRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/image/route";
import { createWorkbenchService } from "@/server/workbench/service";

describe("Local Real MVP M24 image download route", () => {
  it("downloads a stored local PNG for an image artifact", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M24 image download" });
    const imageBuffer = buildTinyPng();
    const localOutput = writeFixtureImage(imageBuffer, "percentage-intro.png");
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "真实课堂视觉图",
      status: "needs_review",
      summary: "已生成本地 PNG。",
      markdownContent: "图片说明。",
      structuredContent: {
        storage: {
          imageAsset: {
            localOutput,
            fileName: "percentage-intro.png",
            bytes: imageBuffer.length,
            sha256: "fake-image-sha256",
            mime: "image/png",
            generationMode: "image_generated",
            sourceArtifactId: "source-artifact",
          },
        },
      },
    });

    const response = await getImageRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.id, artifactId: artifact.id }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="percentage-intro\.png"/);
    const downloaded = Buffer.from(await response.arrayBuffer());
    expect(downloaded.equals(imageBuffer)).toBe(true);
  });

  it("refuses artifacts without a stored image asset", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M24 missing image asset" });
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "PPT 大纲与逐页脚本",
      status: "needs_review",
      summary: "还没有本地图片。",
      markdownContent: "PPT 大纲。",
    });

    const response = await getImageRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.id, artifactId: artifact.id }),
    });

    expect(response.status).toBe(400);
  });

  it("refuses stored image paths outside the local tmp directory", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M24 unsafe image path" });
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "真实课堂视觉图",
      status: "needs_review",
      summary: "路径不应被读取。",
      markdownContent: "图片说明。",
      structuredContent: {
        storage: {
          imageAsset: {
            localOutput: "package.json",
            fileName: "unsafe.png",
            bytes: 1,
            sha256: "fake",
            mime: "image/png",
            generationMode: "image_generated",
            sourceArtifactId: "source-artifact",
          },
        },
      },
    });

    const response = await getImageRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.id, artifactId: artifact.id }),
    });

    expect(response.status).toBe(400);
  });
});

function buildTinyPng() {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    Buffer.from("IHDR"),
    Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00]),
    Buffer.alloc(4),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from("IEND"),
    Buffer.alloc(4),
  ]);
}

function writeFixtureImage(buffer: Buffer, fileName: string) {
  const dir = path.join(process.cwd(), ".tmp", "image-download-test");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  writeFileSync(filePath, buffer);
  return path.relative(process.cwd(), filePath).replaceAll("\\", "/");
}
