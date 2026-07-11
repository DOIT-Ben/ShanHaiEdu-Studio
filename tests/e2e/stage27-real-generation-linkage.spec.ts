import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { findUserVisibleEngineeringTerms, getVisiblePageText } from "./support/redline";

const teacherPrompt = "我想要生成一个小学五年级关于百分数这个知识点的公开课 PPT。";
const composerPlaceholder = "继续描述备课目标，或引用右侧产物继续生成";
const fixtureDir = path.join(process.cwd(), ".tmp", "stage27-e2e");
const fixturePaths = {
  pptx: path.join(fixtureDir, "real-pptx.pptx"),
  image: path.join(fixtureDir, "classroom-visual.png"),
  video: path.join(fixtureDir, "intro-video.mp4"),
};

test.describe("E2E Stage 27 real generation browser linkage", () => {
  test.setTimeout(60_000);

  test.beforeAll(async () => {
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(fixturePaths.pptx, Buffer.from("PK\u0003\u0004stage27-pptx"));
    await writeFile(fixturePaths.image, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x73, 0x32, 0x37]));
    await writeFile(fixturePaths.video, Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x73, 0x32, 0x37]));
  });

  test.beforeEach(async ({ page, context }) => {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => undefined,
        },
      });
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(composerPlaceholder).waitFor({ state: "visible" });
  });

  test("links teacher real-generation actions to refreshed artifacts, downloads, and material package", async ({ page }) => {
    const routeHits = await installRealGenerationRouteSubstitutes(page);
    const projectId = await createProjectAndInitialArtifacts(page);

    await openArtifactDetail(page, /PPT 大纲与逐页脚本，已确认/);
    await expect(page.getByRole("button", { name: "生成真实 PPTX" })).toBeVisible();
    await expect(page.getByRole("button", { name: "生成课堂视觉图" })).toBeVisible();
    await page.getByRole("button", { name: "生成真实 PPTX" }).click();
    await expect(page.getByText("真实 PPTX 已生成，请下载后核对页面内容。")).toBeVisible();
    expect(routeHits.pptx).toBe(true);
    await page.keyboard.press("Escape");

    await openArtifactDetail(page, /真实 PPTX 文件，待确认/);
    const pptxDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 PPTX" }).click();
    const pptx = await pptxDownload;
    expect(pptx.suggestedFilename()).toMatch(/\.pptx$/);
    const pptxPath = await pptx.path();
    expect(pptxPath).toBeTruthy();
    expect((await readBinaryPrefix(pptxPath ?? "", 2)).toString("utf8")).toBe("PK");

    await page.getByRole("button", { name: "生成课堂视觉图" }).click();
    await expect(page.getByText("课堂视觉图已生成，请核对画面内容后再用于课件。")).toBeVisible();
    expect(routeHits.image).toBe(true);
    await page.keyboard.press("Escape");

    await openArtifactDetail(page, /真实课堂视觉图，待确认/);
    const imageDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载图片" }).click();
    const image = await imageDownload;
    expect(image.suggestedFilename()).toMatch(/\.png$/);
    const imagePath = await image.path();
    expect(imagePath).toBeTruthy();
    expect(await readBinaryPrefix(imagePath ?? "", 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await page.keyboard.press("Escape");

    await openArtifactDetail(page, /导入视频方案，已确认/);
    await expect(page.getByRole("button", { name: "生成导入视频" })).toBeVisible();
    await page.getByRole("button", { name: "生成导入视频" }).click();
    await expect(page.getByText("导入视频已生成，请核对画面、节奏和课堂锚点。")).toBeVisible();
    expect(routeHits.video).toBe(true);
    await page.keyboard.press("Escape");

    await openArtifactDetail(page, /真实导入视频，待确认/);
    const videoDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载视频" }).click();
    const video = await videoDownload;
    expect(video.suggestedFilename()).toMatch(/\.mp4$/);
    const videoPath = await video.path();
    expect(videoPath).toBeTruthy();
    expect((await readBinaryPrefix(videoPath ?? "", 8)).subarray(4, 8).toString("ascii")).toBe("ftyp");
    await page.keyboard.press("Escape");

    await openArtifactDetail(page, /最终交付清单，待确认/);
    const packageDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载材料包" }).click();
    const materialPackage = await packageDownload;
    expect(materialPackage.suggestedFilename()).toMatch(/\.zip$/);
    const packagePath = await materialPackage.path();
    expect(packagePath).toBeTruthy();
    const packageEntries = await readZipEntries(packagePath ?? "");
    expect(packageEntries.has("classroom-visual.png")).toBe(true);
    expect(packageEntries.has("intro-video.mp4")).toBe(true);
    await page.keyboard.press("Escape");

    const artifactsResponse = await page.request.get(`/api/workbench/projects/${projectId}/artifacts`);
    expect(artifactsResponse.ok()).toBe(true);
    const artifactsPayload = (await artifactsResponse.json()) as { artifacts: Array<{ title: string }> };
    expect(artifactsPayload.artifacts.map((artifact) => artifact.title)).toEqual(
      expect.arrayContaining(["真实 PPTX 文件", "真实课堂视觉图", "真实导入视频"]),
    );

    const visibleText = await getVisiblePageText(page);
    const matches = findUserVisibleEngineeringTerms(visibleText);
    expect(matches, `Teacher-visible engineering terms: ${matches.join(", ")}`).toEqual([]);
  });
});

async function installRealGenerationRouteSubstitutes(page: Page) {
  const routeHits = { pptx: false, image: false, video: false };
  const metadata = {
    pptx: await fileMetadata(fixturePaths.pptx),
    image: await fileMetadata(fixturePaths.image),
    video: await fileMetadata(fixturePaths.video),
  };

  await page.route("**/api/workbench/projects/*/artifacts/*/coze-ppt", async (route) => {
    routeHits.pptx = true;
    const { projectId, artifactId } = parseGenerationUrl(route.request().url(), "coze-ppt");
    const response = await page.request.post(`/api/workbench/projects/${projectId}/artifacts`, {
      data: {
        nodeKey: "ppt_draft",
        kind: "ppt_draft",
        title: "真实 PPTX 文件",
        status: "needs_review",
        summary: "已生成可下载的真实 PPTX 文件，请下载后核对页面内容。",
        markdownContent: "# 真实 PPTX 文件\n\n已基于当前 PPT 大纲生成真实 PPTX 文件。",
        structuredContent: {
          storage: {
            cozePptx: {
              localOutput: ".tmp/stage27-e2e/real-pptx.pptx",
              fileName: "real-pptx.pptx",
              bytes: metadata.pptx.bytes,
              sha256: metadata.pptx.sha256,
              generationMode: "stage27_browser_substitute",
              sourceArtifactId: artifactId,
            },
          },
          文件状态: "真实 PPTX 已生成",
          文件大小: `${metadata.pptx.bytes} bytes`,
        },
      },
    });
    await route.fulfill({ status: response.status(), body: await response.text(), headers: { "content-type": "application/json" } });
  });

  await page.route("**/api/workbench/projects/*/artifacts/*/image", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    routeHits.image = true;
    const { projectId, artifactId } = parseGenerationUrl(route.request().url(), "image");
    const response = await page.request.post(`/api/workbench/projects/${projectId}/artifacts`, {
      data: {
        nodeKey: "ppt_draft",
        kind: "ppt_draft",
        title: "真实课堂视觉图",
        status: "needs_review",
        summary: "已生成一张可用于课件导入页的本地课堂视觉图，请下载或接入前继续核对画面内容。",
        markdownContent: "# 真实课堂视觉图\n\n已基于当前 PPT 大纲生成一张本地课堂视觉图。",
        structuredContent: {
          storage: {
            imageAsset: {
              localOutput: ".tmp/stage27-e2e/classroom-visual.png",
              fileName: "classroom-visual.png",
              bytes: metadata.image.bytes,
              sha256: metadata.image.sha256,
              mime: "image/png",
              generationMode: "stage27_browser_substitute",
              sourceArtifactId: artifactId,
            },
          },
          文件状态: "真实课堂视觉图已生成",
          文件大小: `${metadata.image.bytes} bytes`,
          文件类型: "image/png",
        },
      },
    });
    await route.fulfill({ status: response.status(), body: await response.text(), headers: { "content-type": "application/json" } });
  });

  await page.route("**/api/workbench/projects/*/artifacts/*/video", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    routeHits.video = true;
    const { projectId, artifactId } = parseGenerationUrl(route.request().url(), "video");
    const response = await page.request.post(`/api/workbench/projects/${projectId}/artifacts`, {
      data: {
        nodeKey: "intro_video_plan",
        kind: "intro_video_plan",
        title: "真实导入视频",
        status: "needs_review",
        summary: "已生成一段本地导入视频，请播放后核对画面、节奏和课堂锚点。",
        markdownContent: "# 真实导入视频\n\n已基于当前导入视频方案生成一段本地 MP4。",
        structuredContent: {
          storage: {
            videoAsset: {
              localOutput: ".tmp/stage27-e2e/intro-video.mp4",
              fileName: "intro-video.mp4",
              bytes: metadata.video.bytes,
              sha256: metadata.video.sha256,
              mime: "video/mp4",
              generationMode: "stage27_browser_substitute",
              sourceArtifactId: artifactId,
            },
          },
          文件状态: "真实导入视频已生成",
          文件大小: `${metadata.video.bytes} bytes`,
          文件类型: "video/mp4",
        },
      },
    });
    await route.fulfill({ status: response.status(), body: await response.text(), headers: { "content-type": "application/json" } });
  });

  return routeHits;
}

async function createProjectAndInitialArtifacts(page: Page) {
  await createProjectFromVisibleEntry(page);
  await page.getByPlaceholder(composerPlaceholder).fill(teacherPrompt);
  const messageCreated = page.waitForResponse(
    (response) => response.url().includes("/api/workbench/projects/") && response.url().endsWith("/messages") && response.status() === 201,
  );
  await page.getByRole("button", { name: "发送" }).click();
  const messageResponse = await messageCreated;
  await expect(page.getByRole("article").filter({ hasText: "需求规格说明书已生成" })).toBeVisible();

  await approveArtifact(page, /需求规格说明书，待确认/);
  await approveArtifact(page, /教材证据包，待确认/);
  await approveArtifact(page, /公开课教案，待确认/);
  await approveArtifact(page, /PPT 大纲与逐页脚本，待确认/);
  await approveArtifact(page, /导入视频方案，待确认/);

  await expectArtifactEntryAvailable(page, /PPT 大纲与逐页脚本，已确认/);
  await expectArtifactEntryAvailable(page, /导入视频方案，已确认/);
  await expectArtifactEntryAvailable(page, /最终交付清单，待确认/);
  return projectIdFromMessageUrl(messageResponse.url());
}

async function approveArtifact(page: Page, name: RegExp) {
  await openArtifactDetail(page, name);
  await page.getByRole("button", { name: "确认使用" }).click();
  await expect(page.getByText(/已确认「/)).toBeVisible();
  await page.keyboard.press("Escape");
}

async function createProjectFromVisibleEntry(page: Page) {
  const desktopCreate = page.getByRole("button", { name: "新建项目" });
  if (await desktopCreate.isVisible()) {
    await desktopCreate.click();
  } else {
    await page.getByRole("button", { name: "项目" }).click();
    await page.getByRole("dialog", { name: "项目列表" }).getByRole("button", { name: "新建项目" }).click();
  }

  await expect(page.getByText("已新建公开课项目，可以开始描述备课目标。")).toBeVisible();
  await page.getByPlaceholder(composerPlaceholder).click();
}

async function openArtifactDetail(page: Page, name: RegExp) {
  await closeArtifactPreviewIfOpen(page);
  const desktopEntry = page.getByRole("button", { name });
  if (await desktopEntry.isVisible()) {
    await desktopEntry.click();
    await expect(page.getByText(/产物预览 · /)).toBeVisible();
    await page.getByRole("button", { name: "打开完整详情" }).click();
    return;
  }

  await page.getByRole("button", { name: "产物", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "备课成果" });
  await drawer.getByRole("button", { name }).click();
}

async function expectArtifactEntryAvailable(page: Page, name: RegExp) {
  await closeArtifactPreviewIfOpen(page);
  const desktopEntry = page.getByRole("button", { name });
  if (await desktopEntry.isVisible()) return;

  await page.getByRole("button", { name: "产物", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "备课成果" });
  await expect(drawer.getByRole("button", { name })).toBeVisible();
  await page.keyboard.press("Escape");
}

async function closeArtifactPreviewIfOpen(page: Page) {
  const closePreview = page.getByRole("button", { name: "关闭产物预览" });
  if (await closePreview.isVisible()) {
    await closePreview.click();
  }
}

async function readBinaryPrefix(filePath: string, length: number) {
  return (await readFile(filePath)).subarray(0, length);
}

async function readZipEntries(filePath: string) {
  const { inflateRawSync } = await import("node:zlib");
  const buffer = await readFile(filePath);
  const entries = new Map<string, Buffer>();
  let offset = 0;

  while (offset < buffer.length - 4) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }

    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);
    const fileName = buffer.subarray(offset + 30, offset + 30 + fileNameLength).toString("utf8");
    const dataStart = offset + 30 + fileNameLength + extraFieldLength;
    const dataEnd = dataStart + compressedSize;
    const compressed = buffer.subarray(dataStart, dataEnd);

    if (!fileName.endsWith("/")) {
      let content;
      if (compressionMethod === 0) {
        content = compressed;
      } else if (compressionMethod === 8) {
        content = inflateRawSync(compressed, { finishFlush: 2 });
      } else {
        throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
      }
      expect(content.length).toBe(uncompressedSize);
      entries.set(fileName, content);
    }

    offset = dataEnd;
  }

  return entries;
}

async function fileMetadata(filePath: string) {
  const buffer = await readFile(filePath);
  return {
    bytes: buffer.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

function parseGenerationUrl(url: string, segment: "coze-ppt" | "image" | "video") {
  const match = new URL(url).pathname.match(new RegExp(`/api/workbench/projects/([^/]+)/artifacts/([^/]+)/${segment}$`));
  expect(match?.[1]).toBeTruthy();
  expect(match?.[2]).toBeTruthy();
  return { projectId: match?.[1] ?? "", artifactId: match?.[2] ?? "" };
}

function projectIdFromMessageUrl(url: string) {
  const match = new URL(url).pathname.match(/\/api\/workbench\/projects\/([^/]+)\/messages$/);
  expect(match?.[1]).toBeTruthy();
  return match?.[1] ?? "";
}
