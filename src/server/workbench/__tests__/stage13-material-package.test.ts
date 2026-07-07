import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { POST as postProjectRoute } from "@/app/api/workbench/projects/route";
import { POST as postMessageRoute } from "@/app/api/workbench/projects/[projectId]/messages/route";
import { POST as postApproveArtifact } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/approve/route";
import { GET as getPackageRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/package/route";
import { GET as getSnapshotRoute } from "@/app/api/workbench/projects/[projectId]/snapshot/route";
import { createWorkbenchService } from "@/server/workbench/service";

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
    const videoBuffer = buildTinyMp4();
    const videoOutput = writeFixtureVideo(videoBuffer);
    await createWorkbenchService().saveArtifact(projectId, {
      nodeKey: "intro_video_plan",
      kind: "intro_video_plan",
      title: "真实导入视频",
      status: "needs_review",
      summary: "已生成本地 MP4。",
      markdownContent: "视频说明。",
      structuredContent: {
        storage: {
          videoAsset: {
            localOutput: videoOutput,
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
    const imageBuffer = buildTinyPng();
    const imageOutput = writeFixtureImage(imageBuffer);
    await createWorkbenchService().saveArtifact(projectId, {
      nodeKey: "ppt_draft",
      kind: "ppt_draft",
      title: "真实课堂视觉图",
      status: "needs_review",
      summary: "已生成本地课堂视觉图。",
      markdownContent: "图片说明。",
      structuredContent: {
        storage: {
          imageAsset: {
            localOutput: imageOutput,
            fileName: "percentage-classroom-visual.png",
            bytes: imageBuffer.length,
            sha256: "fake-image-sha256",
            mime: "image/png",
            generationMode: "image_generated",
            sourceArtifactId: "source-artifact",
          },
        },
      },
    });

    const packageResponse = await getPackageRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId, artifactId: finalDelivery.id }),
    });
    expect(packageResponse.status).toBe(200);
    expect(packageResponse.headers.get("content-type")).toContain("application/zip");
    expect(packageResponse.headers.get("content-disposition")).toMatch(/\.zip"/);
    const packageBuffer = Buffer.from(await packageResponse.arrayBuffer());
    expect(packageBuffer.subarray(0, 2).toString("utf8")).toBe("PK");
    const zip = await JSZip.loadAsync(packageBuffer);
    const videoEntry = zip.file("intro-video.mp4");
    expect(videoEntry).toBeTruthy();
    const video = Buffer.from(await videoEntry!.async("nodebuffer"));
    expect(video.equals(videoBuffer)).toBe(true);
    expect(video.subarray(4, 8).toString("utf8")).toBe("ftyp");
    const imageEntry = zip.file("classroom-visual.png");
    expect(imageEntry).toBeTruthy();
    const image = Buffer.from(await imageEntry!.async("nodebuffer"));
    expect(image.equals(imageBuffer)).toBe(true);
    expect(image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);

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

function buildTinyMp4() {
  return Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(32)]);
}

function buildTinyPng() {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
}

function writeFixtureVideo(buffer: Buffer) {
  const dir = path.join(process.cwd(), ".tmp", "stage13-video-package-test");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "percentage-intro.mp4");
  writeFileSync(filePath, buffer);
  return path.relative(process.cwd(), filePath).replaceAll("\\", "/");
}

function writeFixtureImage(buffer: Buffer) {
  const dir = path.join(process.cwd(), ".tmp", "stage13-image-package-test");
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "percentage-classroom-visual.png");
  writeFileSync(filePath, buffer);
  return path.relative(process.cwd(), filePath).replaceAll("\\", "/");
}
