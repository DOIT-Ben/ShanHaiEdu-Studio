import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET as getVideoRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/video/route";
import { createWorkbenchService } from "@/server/workbench/service";

describe("Local Real MVP M22 video download route", () => {
  it("downloads a stored local MP4 for a video artifact", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M22 video download" });
    const videoBuffer = buildTinyMp4();
    const localOutput = writeFixtureVideo(videoBuffer, "percentage-intro.mp4");
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "intro_video_plan",
      kind: "intro_video_plan",
      title: "真实导入视频",
      status: "needs_review",
      summary: "已生成本地 MP4。",
      markdownContent: "视频说明。",
      structuredContent: {
        storage: {
          videoAsset: {
            localOutput,
            fileName: "percentage-intro.mp4",
            bytes: videoBuffer.length,
            sha256: "fake-video-sha256",
            mime: "video/mp4",
            generationMode: "video_generated",
            sourceArtifactId: "source-artifact",
          },
        },
      },
    });

    const response = await getVideoRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.id, artifactId: artifact.id }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="percentage-intro\.mp4"/);
    const downloaded = Buffer.from(await response.arrayBuffer());
    expect(downloaded.equals(videoBuffer)).toBe(true);
  });

  it("refuses artifacts without a stored video asset", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M22 missing video asset" });
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "intro_video_plan",
      kind: "intro_video_plan",
      title: "导入视频方案",
      status: "needs_review",
      summary: "还没有本地视频。",
      markdownContent: "视频方案。",
    });

    const response = await getVideoRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.id, artifactId: artifact.id }),
    });

    expect(response.status).toBe(400);
  });

  it("refuses stored video paths outside the local tmp directory", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M22 unsafe video path" });
    const artifact = await service.saveArtifact(project.id, {
      nodeKey: "intro_video_plan",
      kind: "intro_video_plan",
      title: "真实导入视频",
      status: "needs_review",
      summary: "路径不应被读取。",
      markdownContent: "视频说明。",
      structuredContent: {
        storage: {
          videoAsset: {
            localOutput: "package.json",
            fileName: "unsafe.mp4",
            bytes: 1,
            sha256: "fake",
            mime: "video/mp4",
            generationMode: "video_generated",
            sourceArtifactId: "source-artifact",
          },
        },
      },
    });

    const response = await getVideoRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.id, artifactId: artifact.id }),
    });

    expect(response.status).toBe(400);
  });
});

function buildTinyMp4() {
  return Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(32)]);
}

function writeFixtureVideo(buffer: Buffer, fileName: string) {
  const dir = path.join(process.cwd(), ".tmp", "video-download-test");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  writeFileSync(filePath, buffer);
  return path.relative(process.cwd(), filePath).replaceAll("\\", "/");
}
