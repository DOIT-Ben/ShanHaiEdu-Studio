import { expect, test } from "@playwright/test";
import { findUserVisibleEngineeringTerms, getVisiblePageText } from "./support/redline";

const teacherPrompt = "我想要生成一个小学五年级关于百分数这个知识点的公开课 PPT。";
const composerPlaceholder = "继续描述备课目标，或引用右侧产物继续生成";
const assistantReply = "需求规格说明书已生成";

test.describe("E2E Stage 2 deterministic user path", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(composerPlaceholder).waitFor({ state: "visible" });
  });

  test("creates a project, generates a requirement artifact, approves it, and restores after refresh", async ({ page }, testInfo) => {
    await page.getByRole("button", { name: "新建项目" }).click();
    await expect(page.getByText("已新建公开课项目，可以开始描述备课目标。")).toBeVisible();

    await page.getByPlaceholder(composerPlaceholder).fill(teacherPrompt);
    const messageCreated = page.waitForResponse(
      (response) => response.url().includes("/api/workbench/projects/") && response.url().endsWith("/messages") && response.status() === 201,
    );
    await page.getByRole("button", { name: "发送" }).click();
    await messageCreated;

    await expect(page.locator("div").filter({ hasText: new RegExp(`^${teacherPrompt}$`) })).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: assistantReply })).toBeVisible();
    await expect(page.getByRole("button", { name: /需求规格说明书，待确认/ })).toBeVisible();

    await page.getByRole("button", { name: /需求规格说明书，待确认/ }).click();
    await expect(page.getByText("产物预览 · 刚刚")).toBeVisible();
    await expect(page.getByText("已整理公开课目标、基础信息、交付范围和后续输入要求。")).toBeVisible();

    await page.getByRole("button", { name: "打开完整详情" }).click();
    await expect(page.getByText("可复用内容")).toBeVisible();
    await expect(page.getByRole("button", { name: "确认使用" })).toBeVisible();
    await page.getByRole("button", { name: "确认使用" }).click();

    await expect(page.getByText("已确认「需求规格说明书」，下一步会使用它继续生成。")).toBeVisible();
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "确认使用" })).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /需求规格说明书，已确认/ })).toBeVisible();

    await page.reload();
    await page.getByPlaceholder(composerPlaceholder).waitFor({ state: "visible" });
    await expect(page.locator("div").filter({ hasText: new RegExp(`^${teacherPrompt}$`) })).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: assistantReply })).toBeVisible();
    await expect(page.getByRole("button", { name: /需求规格说明书，已确认/ })).toBeVisible();

    const visibleText = await getVisiblePageText(page);
    const matches = findUserVisibleEngineeringTerms(visibleText);
    expect(matches, `Teacher-visible engineering terms: ${matches.join(", ")}`).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath("stage2-requirement-approved-restored.png"),
      fullPage: true,
    });
  });
});
