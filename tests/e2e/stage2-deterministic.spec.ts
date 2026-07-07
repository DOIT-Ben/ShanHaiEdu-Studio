import { expect, type Page, test } from "@playwright/test";
import { findUserVisibleEngineeringTerms, getVisiblePageText } from "./support/redline";

const teacherPrompt = "我想要生成一个小学五年级关于百分数这个知识点的公开课 PPT。";
const composerPlaceholder = "继续描述备课目标，或引用右侧产物继续生成";
const assistantReply = "需求规格说明书已生成";

test.describe("E2E Stage 2 deterministic user path", () => {
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

  test("creates a project, generates lesson, media plans, final delivery, and restores after refresh", async ({ page }, testInfo) => {
    await createProjectFromVisibleEntry(page);
    await expect(page.getByText("已新建公开课项目，可以开始描述备课目标。")).toBeVisible();

    await page.getByPlaceholder(composerPlaceholder).fill(teacherPrompt);
    const messageCreated = page.waitForResponse(
      (response) => response.url().includes("/api/workbench/projects/") && response.url().endsWith("/messages") && response.status() === 201,
    );
    await page.getByRole("button", { name: "发送" }).click();
    await messageCreated;

    await expect(page.locator("div").filter({ hasText: new RegExp(`^${teacherPrompt}$`) })).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: assistantReply })).toBeVisible();

    await openArtifactDetail(page, /需求规格说明书，待确认/);
    await expect(page.getByText("已整理公开课目标、基础信息、交付范围和后续输入要求。").first()).toBeVisible();
    await expect(page.getByText("可复用内容")).toBeVisible();
    await expect(page.getByRole("button", { name: "确认使用" })).toBeVisible();
    await page.getByRole("button", { name: "确认使用" }).click();

    await expect(page.getByText("已确认「需求规格说明书」，下一步会使用它继续生成。")).toBeVisible();
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "确认使用" })).toBeHidden();
    await page.keyboard.press("Escape");
    await expectArtifactEntryAvailable(page, /需求规格说明书，已确认/);

    await openArtifactDetail(page, /教材证据包，待确认/);
    await expect(page.getByText("教材证据包").first()).toBeVisible();
    await expect(page.getByText("教材依据").first()).toBeVisible();
    await page.getByRole("button", { name: "确认使用" }).click();
    await expect(page.getByText("已确认「教材证据包」，下一步会使用它继续生成。")).toBeVisible();
    await page.keyboard.press("Escape");
    await expectArtifactEntryAvailable(page, /教材证据包，已确认/);

    await openArtifactDetail(page, /公开课教案，待确认/);
    await expect(page.getByText("公开课教案").first()).toBeVisible();
    await expect(page.getByText("教学目标").first()).toBeVisible();
    await page.getByRole("button", { name: "复制" }).click();
    await expect(page.getByRole("button", { name: "已复制" })).toBeVisible();
    await page.getByRole("button", { name: "确认使用" }).click();
    await expect(page.getByText("已确认「公开课教案」，下一步会使用它继续生成。")).toBeVisible();
    await expect(page.getByRole("button", { name: "确认使用" })).toBeHidden();
    await page.getByRole("button", { name: "调整后重做" }).click();
    await expect(page.getByText("已保留「公开课教案」旧内容，新的版本完成后再由你确认是否采用。")).toBeVisible();
    await page.keyboard.press("Escape");
    await openArtifactDetail(page, /公开课教案，待确认/);
    await page.getByRole("button", { name: "确认使用" }).click();
    await expect(page.getByText("已确认「公开课教案」，下一步会使用它继续生成。")).toBeVisible();
    await page.keyboard.press("Escape");

    await openArtifactDetail(page, /PPT 大纲与逐页脚本，待确认/);
    await expect(page.getByText("PPT 大纲与逐页脚本").first()).toBeVisible();
    await expect(page.getByText("页面结构").first()).toBeVisible();
    await expect(page.getByText("主视觉需求").first()).toBeVisible();
    await expect(page.getByText("PPTX 文件已生成")).toBeHidden();
    const pptxDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 PPTX" }).click();
    const pptx = await pptxDownload;
    expect(pptx.suggestedFilename()).toMatch(/\.pptx$/);
    const pptxPath = await pptx.path();
    expect(pptxPath).toBeTruthy();
    const pptxPrefix = await readBinaryPrefix(pptxPath ?? "", 2);
    expect(pptxPrefix.toString("utf8")).toBe("PK");
    await page.getByRole("button", { name: "复制" }).click();
    await expect(page.getByRole("button", { name: "已复制" })).toBeVisible();
    await page.getByRole("button", { name: "确认使用" }).click();
    await expect(page.getByText("已确认「PPT 大纲与逐页脚本」，下一步会使用它继续生成。")).toBeVisible();
    await page.getByRole("button", { name: "调整后重做" }).click();
    await expect(page.getByText("已保留「PPT 大纲与逐页脚本」旧内容，新的版本完成后再由你确认是否采用。")).toBeVisible();
    await page.keyboard.press("Escape");
    await openArtifactDetail(page, /PPT 大纲与逐页脚本，待确认/);
    await page.getByRole("button", { name: "确认使用" }).click();
    await expect(page.getByText("已确认「PPT 大纲与逐页脚本」，下一步会使用它继续生成。")).toBeVisible();
    await page.keyboard.press("Escape");

    await openArtifactDetail(page, /导入视频方案，待确认/);
    await expect(page.getByText("导入视频方案").first()).toBeVisible();
    await expect(page.getByText("独立主题").first()).toBeVisible();
    await expect(page.getByText("开场钩子与吸睛点").first()).toBeVisible();
    await expect(page.getByText("课程锚点").first()).toBeVisible();
    await expect(page.getByText("课堂落点问题").first()).toBeVisible();
    await expect(page.getByText("视频文件已生成")).toBeHidden();
    await expect(page.getByText("视频成片已生成")).toBeHidden();
    await page.getByRole("button", { name: "复制" }).click();
    await expect(page.getByRole("button", { name: "已复制" })).toBeVisible();
    await page.getByRole("button", { name: "确认使用" }).click();
    await expect(page.getByText("已确认「导入视频方案」，下一步会使用它继续生成。")).toBeVisible();
    await page.getByRole("button", { name: "调整后重做" }).click();
    await expect(page.getByText("已保留「导入视频方案」旧内容，新的版本完成后再由你确认是否采用。")).toBeVisible();
    await page.keyboard.press("Escape");
    await openArtifactDetail(page, /导入视频方案，待确认/);
    await page.getByRole("button", { name: "确认使用" }).click();
    await expect(page.getByText("已确认「导入视频方案」，下一步会使用它继续生成。")).toBeVisible();
    await page.keyboard.press("Escape");

    await openArtifactDetail(page, /最终交付清单，待确认/);
    await expect(page.getByText("最终交付清单").first()).toBeVisible();
    await expect(page.getByText("已形成材料").first()).toBeVisible();
    await expect(page.getByText("待确认事项").first()).toBeVisible();
    await expect(page.getByText("PPT 大纲可下载最小 PPTX 文件").first()).toBeVisible();
    await expect(page.getByText("图片文件、视频成片、动画和视觉精修仍待生成或完善").first()).toBeVisible();
    await expect(page.getByText("PPTX 文件已生成")).toBeHidden();
    await expect(page.getByText("图片文件已生成")).toBeHidden();
    await expect(page.getByText("视频成片已生成")).toBeHidden();
    const markdownDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 Markdown" }).click();
    const download = await markdownDownload;
    expect(download.suggestedFilename()).toMatch(/\.md$/);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const markdownText = await readTextFile(downloadPath ?? "");
    expect(markdownText).toContain("# 最终交付清单");
    expect(markdownText).toContain("已形成材料");
    expect(markdownText).toContain("待确认事项");
    expect(markdownText).toContain("PPT 大纲可下载最小 PPTX 文件");
    expect(markdownText).toContain("图片文件、视频成片、动画和视觉精修仍待生成或完善");
    expect(markdownText).not.toMatch(/PPTX 文件已生成|图片文件已生成|视频成片已生成/);
    await page.getByRole("button", { name: "复制" }).click();
    await expect(page.getByRole("button", { name: "已复制" })).toBeVisible();
    await page.getByRole("button", { name: "确认使用" }).click();
    await expect(page.getByText("已确认「最终交付清单」，下一步会使用它继续生成。")).toBeVisible();
    await page.getByRole("button", { name: "调整后重做" }).click();
    await expect(page.getByText("已保留「最终交付清单」旧内容，新的版本完成后再由你确认是否采用。")).toBeVisible();
    await page.keyboard.press("Escape");
    await expectArtifactEntryAvailable(page, /最终交付清单，待确认/);

    await page.reload();
    await page.getByPlaceholder(composerPlaceholder).waitFor({ state: "visible" });
    await expect(page.locator("div").filter({ hasText: new RegExp(`^${teacherPrompt}$`) })).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: assistantReply })).toBeVisible();
    await expectArtifactEntryAvailable(page, /需求规格说明书，已确认/);
    await expectArtifactEntryAvailable(page, /教材证据包，已确认/);
    await expectArtifactEntryAvailable(page, /公开课教案，已确认/);
    await expectArtifactEntryAvailable(page, /PPT 大纲与逐页脚本，已确认/);
    await expectArtifactEntryAvailable(page, /导入视频方案，已确认/);
    await expectArtifactEntryAvailable(page, /最终交付清单，待确认/);

    const visibleText = await getVisiblePageText(page);
    const matches = findUserVisibleEngineeringTerms(visibleText);
    expect(matches, `Teacher-visible engineering terms: ${matches.join(", ")}`).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath("stage2-requirement-approved-restored.png"),
      fullPage: true,
    });
  });

  test("reuses an artifact from detail as the next teacher input", async ({ page }) => {
    const artifactReference = "需求规格说明书：已整理公开课目标、基础信息、交付范围和后续输入要求。";
    await createProjectFromVisibleEntry(page);

    await page.getByPlaceholder(composerPlaceholder).fill(teacherPrompt);
    const firstMessageCreated = page.waitForResponse(
      (response) => response.url().includes("/api/workbench/projects/") && response.url().endsWith("/messages") && response.status() === 201,
    );
    await page.getByRole("button", { name: "发送" }).click();
    await firstMessageCreated;
    await expect(page.getByRole("article").filter({ hasText: assistantReply })).toBeVisible();

    await openArtifactDetail(page, /需求规格说明书，待确认/);
    await page.getByRole("button", { name: "作为输入" }).click();

    await expect(page.getByRole("button", { name: "确认使用" })).toBeHidden();
    await expect(page.getByPlaceholder(composerPlaceholder)).toBeVisible();
    await expect(page.getByText(artifactReference)).toBeVisible();
    await expect(page.getByPlaceholder(composerPlaceholder)).toHaveValue(/请基于：需求规格说明书｜已整理公开课目标/);

    await page.getByPlaceholder(composerPlaceholder).fill("请继续细化课堂活动。");
    const reusedMessageCreated = page.waitForResponse(
      (response) => response.url().includes("/api/workbench/projects/") && response.url().endsWith("/messages") && response.status() === 201,
    );
    await page.getByRole("button", { name: "发送" }).click();
    const reusedMessageResponse = await reusedMessageCreated;
    const projectId = projectIdFromMessageUrl(reusedMessageResponse.url());
    const messagesResponse = await page.request.get(`/api/workbench/projects/${projectId}/messages`);
    expect(messagesResponse.ok()).toBe(true);
    const messagesPayload = (await messagesResponse.json()) as { messages: Array<{ role: string; content: string; artifactRefs: string[] }> };
    const lastTeacherMessage = messagesPayload.messages.filter((message) => message.role === "teacher").at(-1);
    expect(lastTeacherMessage?.content).toBe("请继续细化课堂活动。");
    expect(lastTeacherMessage?.artifactRefs).toContain(artifactReference);
    await expect(page.getByRole("article").filter({ hasText: "请继续细化课堂活动。" }).filter({ hasText: artifactReference })).toBeVisible();

    await openArtifactDetail(page, /需求规格说明书，待确认/);
    await page.getByRole("button", { name: "作为输入" }).click();
    const insertedValue = await page.getByPlaceholder(composerPlaceholder).inputValue();
    await page.getByPlaceholder(composerPlaceholder).fill(`${insertedValue}\n\n下一步只关注学生活动。`);
    await page.getByRole("button", { name: "移除引用" }).click();
    await expect(page.getByRole("button", { name: "移除引用" })).toBeHidden();
    await expect(page.getByPlaceholder(composerPlaceholder)).toHaveValue(/下一步只关注学生活动。/);
  });
});

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
  const desktopEntry = page.getByRole("button", { name });
  if (await desktopEntry.isVisible()) {
    await desktopEntry.click();
    await expect(page.getByText(/产物预览 · /)).toBeVisible();
    await page.getByRole("button", { name: "打开完整详情" }).click();
    return;
  }

  await page.getByRole("button", { name: "产物" }).click();
  const drawer = page.getByRole("dialog", { name: "线性产物" });
  await drawer.getByRole("button", { name }).click();
}

async function expectArtifactEntryAvailable(page: Page, name: RegExp) {
  const desktopEntry = page.getByRole("button", { name });
  if (await desktopEntry.isVisible()) return;

  await page.getByRole("button", { name: "产物" }).click();
  const drawer = page.getByRole("dialog", { name: "线性产物" });
  await expect(drawer.getByRole("button", { name })).toBeVisible();
  await page.keyboard.press("Escape");
}

async function readTextFile(path: string) {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}

async function readBinaryPrefix(path: string, length: number) {
  const { readFile } = await import("node:fs/promises");
  return (await readFile(path)).subarray(0, length);
}

function projectIdFromMessageUrl(url: string) {
  const match = new URL(url).pathname.match(/\/api\/workbench\/projects\/([^/]+)\/messages$/);
  expect(match?.[1]).toBeTruthy();
  return match?.[1] ?? "";
}
