import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { findUserVisibleEngineeringTerms, getVisiblePageText } from "./support/redline";

const composerPlaceholder = "继续描述备课目标，或引用右侧产物继续生成";
const teacherPrompt = "客户端入口验证：五年级百分数公开课，重点是生活折扣。";

test.describe("E2E Stage 33 client exe readiness", () => {
  test("keeps the MVP usable through a localhost client-like entry", async ({ page, context }) => {
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
    expect(new URL(page.url()).hostname).toBe("localhost");
    await page.getByPlaceholder(composerPlaceholder).waitFor({ state: "visible" });

    await createProjectFromVisibleEntry(page);
    await page.getByPlaceholder(composerPlaceholder).fill(teacherPrompt);
    const messageCreated = page.waitForResponse(
      (response) => response.url().includes("/api/workbench/projects/") && response.url().endsWith("/messages") && response.status() === 201,
    );
    await page.getByRole("button", { name: "发送" }).click();
    await messageCreated;
    await expect(messageBubble(page, teacherPrompt)).toBeVisible();
    await expect(page.getByRole("button", { name: /需求规格说明书，待确认/ })).toBeVisible();

    await page.reload();
    await page.getByPlaceholder(composerPlaceholder).waitFor({ state: "visible" });
    await expect(messageBubble(page, teacherPrompt)).toBeVisible();

    await openArtifactDetail(page, /需求规格说明书，待确认/);
    const markdownDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载 Markdown" }).click();
    const markdown = await markdownDownload;
    expect(markdown.suggestedFilename()).toMatch(/\.md$/);
    const markdownPath = await markdown.path();
    expect(markdownPath).toBeTruthy();
    const markdownContent = await readFile(markdownPath ?? "", "utf8");
    expect(markdownContent).toContain("需求规格说明书");

    const visibleText = await getVisiblePageText(page);
    const matches = findUserVisibleEngineeringTerms(visibleText);
    expect(matches, `Teacher-visible engineering terms: ${matches.join(", ")}`).toEqual([]);
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

  await page.getByRole("button", { name: "产物", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "线性产物" });
  await drawer.getByRole("button", { name }).click();
}

function messageBubble(page: Page, prompt: string) {
  return page.locator("div").filter({ hasText: new RegExp(`^${prompt}$`) });
}
