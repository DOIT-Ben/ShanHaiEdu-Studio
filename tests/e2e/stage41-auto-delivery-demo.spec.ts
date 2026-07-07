import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { findUserVisibleEngineeringTerms, getVisiblePageText } from "./support/redline";

const stage = "M41";
const mode = "local-substitute";
const teacherPrompt = "我想要生成一个小学五年级关于百分数这个知识点的公开课 PPT。";
const composerPlaceholder = "继续描述备课目标，或引用右侧产物继续生成";
const fixtureDir = path.join(process.cwd(), ".tmp", "stage41-delivery-demo");
const reportJsonPath = path.join(process.cwd(), "test-results", "stage41-delivery-demo-report.json");
const reportMarkdownPath = path.join(process.cwd(), "test-results", "stage41-delivery-demo-report.md");
const fixturePaths = {
  pptx: path.join(fixtureDir, "real-pptx.pptx"),
  image: path.join(fixtureDir, "classroom-visual.png"),
  video: path.join(fixtureDir, "intro-video.mp4"),
};

type DeliveryReport = {
  ok: boolean;
  stage: string;
  mode: string;
  projectId: string;
  prompt: string;
  artifacts: string[];
  downloads: Array<{ kind: string; filename: string; bytes: number; sha256: string }>;
  packageEntries: string[];
  checks: Array<{ id: string; ok: boolean; detail: string }>;
  generatedAt: string;
};

test.describe("E2E Stage 41 one-command automatic delivery demo", () => {
  test.setTimeout(75_000);

  test.beforeAll(async () => {
    await mkdir(fixtureDir, { recursive: true });
    await mkdir(path.dirname(reportJsonPath), { recursive: true });
    await writeFile(fixturePaths.pptx, Buffer.from("PK\u0003\u0004stage41-pptx"));
    await writeFile(fixturePaths.image, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x73, 0x34, 0x31]));
    await writeFile(fixturePaths.video, Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x73, 0x34, 0x31]));
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

  test("runs the complete local delivery and writes an acceptance report", async ({ page }) => {
    const routeHits = await installRealGenerationRouteSubstitutes(page);
    const projectId = await createProjectAndInitialArtifacts(page);
    const downloads: DeliveryReport["downloads"] = [];

    await openArtifactDetail(page, /PPT 大纲与逐页脚本，已确认/);
    await page.getByRole("button", { name: "生成真实 PPTX" }).click();
    await expect(page.getByText("真实 PPTX 已生成，请下载后核对页面内容。")).toBeVisible();
    await page.keyboard.press("Escape");

    await openArtifactDetail(page, /真实 PPTX 文件，待确认/);
    downloads.push(await downloadAndCheck(page, "pptx", "下载 PPTX", /\.pptx$/, async (buffer) => {
      expect(buffer.subarray(0, 2).toString("utf8")).toBe("PK");
    }));
    await page.keyboard.press("Escape");

    await openArtifactDetail(page, /真实 PPTX 文件，待确认/);
    await page.getByRole("button", { name: "生成课堂视觉图" }).click();
    await expect(page.getByText("课堂视觉图已生成，请核对画面内容后再用于课件。")).toBeVisible();
    await page.keyboard.press("Escape");

    await openArtifactDetail(page, /真实课堂视觉图，待确认/);
    downloads.push(await downloadAndCheck(page, "image", "下载图片", /\.png$/, async (buffer) => {
      expect(buffer.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }));
    await page.keyboard.press("Escape");

    await openArtifactDetail(page, /导入视频方案，已确认/);
    await page.getByRole("button", { name: "生成导入视频" }).click();
    await expect(page.getByText("导入视频已生成，请核对画面、节奏和课堂锚点。")).toBeVisible();
    await page.keyboard.press("Escape");

    await openArtifactDetail(page, /真实导入视频，待确认/);
    downloads.push(await downloadAndCheck(page, "video", "下载视频", /\.mp4$/, async (buffer) => {
      expect(buffer.subarray(4, 8).toString("ascii")).toBe("ftyp");
    }));
    await page.keyboard.press("Escape");

    await openArtifactDetail(page, /最终交付清单，待确认/);
    const packageDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载材料包" }).click();
    const materialPackage = await packageDownload;
    expect(materialPackage.suggestedFilename()).toMatch(/\.zip$/);
    const packagePath = await materialPackage.path();
    expect(packagePath).toBeTruthy();
    const packageBuffer = await readFile(packagePath ?? "");
    const packageEntries = await readZipEntries(packageBuffer);
    downloads.push({
      kind: "package",
      filename: materialPackage.suggestedFilename(),
      bytes: packageBuffer.byteLength,
      sha256: sha256(packageBuffer),
    });

    const artifactsResponse = await page.request.get(`/api/workbench/projects/${projectId}/artifacts`);
    expect(artifactsResponse.ok()).toBe(true);
    const artifactsPayload = (await artifactsResponse.json()) as { artifacts: Array<{ title: string }> };
    const artifactTitles = artifactsPayload.artifacts.map((artifact) => artifact.title);

    const visibleText = await getVisiblePageText(page);
    const engineeringTerms = findUserVisibleEngineeringTerms(visibleText);
    expect(engineeringTerms, `Teacher-visible engineering terms: ${engineeringTerms.join(", ")}`).toEqual([]);

    const checks = [
      check("route-pptx-hit", routeHits.pptx, "PPTX generation route substitute was called."),
      check("route-image-hit", routeHits.image, "Image generation route substitute was called."),
      check("route-video-hit", routeHits.video, "Video generation route substitute was called."),
      check("artifact-pptx-created", artifactTitles.includes("真实 PPTX 文件"), "PPTX artifact exists."),
      check("artifact-image-created", artifactTitles.includes("真实课堂视觉图"), "Image artifact exists."),
      check("artifact-video-created", artifactTitles.includes("真实导入视频"), "Video artifact exists."),
      check("package-readme", packageEntries.includes("README.md"), "Package contains README.md."),
      check("package-final-delivery", packageEntries.includes("final-delivery.md"), "Package contains final-delivery.md."),
      check("package-pptx", packageEntries.includes("ppt-outline.pptx"), "Package contains ppt-outline.pptx."),
      check("package-image", packageEntries.includes("classroom-visual.png"), "Package contains classroom-visual.png."),
      check("package-video", packageEntries.includes("intro-video.mp4"), "Package contains intro-video.mp4."),
      check("teacher-redline", engineeringTerms.length === 0, "Teacher UI has no visible engineering terms."),
    ];

    const report: DeliveryReport = {
      ok: checks.every((item) => item.ok),
      stage,
      mode,
      projectId,
      prompt: teacherPrompt,
      artifacts: artifactTitles,
      downloads,
      packageEntries,
      checks,
      generatedAt: new Date().toISOString(),
    };
    expect(report.ok).toBe(true);
    await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(reportMarkdownPath, renderMarkdownReport(report), "utf8");
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
              localOutput: ".tmp/stage41-delivery-demo/real-pptx.pptx",
              fileName: "real-pptx.pptx",
              bytes: metadata.pptx.bytes,
              sha256: metadata.pptx.sha256,
              generationMode: "stage41_local_substitute",
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
              localOutput: ".tmp/stage41-delivery-demo/classroom-visual.png",
              fileName: "classroom-visual.png",
              bytes: metadata.image.bytes,
              sha256: metadata.image.sha256,
              mime: "image/png",
              generationMode: "stage41_local_substitute",
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
              localOutput: ".tmp/stage41-delivery-demo/intro-video.mp4",
              fileName: "intro-video.mp4",
              bytes: metadata.video.bytes,
              sha256: metadata.video.sha256,
              mime: "video/mp4",
              generationMode: "stage41_local_substitute",
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
  await page.getByRole("button", { name: "新建项目" }).click();
  await expect(page.getByText("已新建公开课项目，可以开始描述备课目标。")).toBeVisible();
  await page.getByPlaceholder(composerPlaceholder).click();
}

async function openArtifactDetail(page: Page, name: RegExp) {
  await closeArtifactPreviewIfOpen(page);
  const entry = page.getByRole("button", { name });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page.getByText(/产物预览 · /)).toBeVisible();
  await page.getByRole("button", { name: "打开完整详情" }).click();
}

async function expectArtifactEntryAvailable(page: Page, name: RegExp) {
  await closeArtifactPreviewIfOpen(page);
  await expect(page.getByRole("button", { name })).toBeVisible();
}

async function closeArtifactPreviewIfOpen(page: Page) {
  const closePreview = page.getByRole("button", { name: "关闭产物预览" });
  if (await closePreview.isVisible()) {
    await closePreview.click();
  }
}

async function downloadAndCheck(
  page: Page,
  kind: string,
  buttonName: string,
  filenamePattern: RegExp,
  checkBuffer: (buffer: Buffer) => Promise<void>,
) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(filenamePattern);
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const buffer = await readFile(filePath ?? "");
  await checkBuffer(buffer);
  return {
    kind,
    filename: download.suggestedFilename(),
    bytes: buffer.byteLength,
    sha256: sha256(buffer),
  };
}

async function readZipEntries(buffer: Buffer) {
  const { inflateRawSync } = await import("node:zlib");
  const entries: string[] = [];
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
      if (compressionMethod === 0) {
        expect(compressed.length).toBe(uncompressedSize);
      } else if (compressionMethod === 8) {
        expect(inflateRawSync(compressed, { finishFlush: 2 }).length).toBe(uncompressedSize);
      } else {
        throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
      }
      entries.push(fileName);
    }

    offset = dataEnd;
  }

  return entries.sort();
}

async function fileMetadata(filePath: string) {
  const buffer = await readFile(filePath);
  return {
    bytes: buffer.byteLength,
    sha256: sha256(buffer),
  };
}

function check(id: string, ok: boolean, detail: string) {
  return { id, ok, detail };
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

function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function renderMarkdownReport(report: DeliveryReport) {
  const checks = report.checks.map((item) => `- ${item.ok ? "PASS" : "FAIL"} ${item.id}: ${item.detail}`).join("\n");
  const downloads = report.downloads.map((item) => `- ${item.kind}: ${item.filename} (${item.bytes} bytes)`).join("\n");
  const entries = report.packageEntries.map((entry) => `- ${entry}`).join("\n");
  return `# M41 一键自动交付演示报告

- 状态：${report.ok ? "通过" : "失败"}
- 模式：${report.mode}
- 项目 ID：${report.projectId}
- 生成时间：${report.generatedAt}

## 下载文件

${downloads}

## 材料包内容

${entries}

## 检查项

${checks}
`;
}
