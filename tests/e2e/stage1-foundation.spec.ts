import { expect, test } from "@playwright/test";
import { findUserVisibleEngineeringTerms, getVisiblePageText } from "./support/redline";
import { stage1Selectors, stage1TeacherPrompt } from "./support/stage1-fixtures";

test.describe("E2E Stage 1 foundation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(stage1Selectors.composerPlaceholder).waitFor({ state: "visible" });
  });

  test("loads the current workbench shell", async ({ page }) => {
    await expect(page.getByRole("heading", { name: stage1Selectors.appTitle })).toBeVisible();
    await expect(page.getByRole("button", { name: "新建项目" })).toBeVisible();
    await expect(page.getByPlaceholder(stage1Selectors.composerPlaceholder)).toBeVisible();
    await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
    await expect(page.getByRole("button", { name: stage1Selectors.introNodeName })).toBeVisible();
  });

  test("drives the prompt composer without claiming real generation", async ({ page }) => {
    await page.getByPlaceholder(stage1Selectors.composerPlaceholder).fill(stage1TeacherPrompt);
    await page.getByRole("button", { name: "发送" }).click();

    await expect(page.getByText("已发送")).toBeVisible();
    await expect(page.getByPlaceholder(stage1Selectors.composerPlaceholder)).toHaveValue("");
  });

  test("opens node evidence and full detail actions", async ({ page }) => {
    await page.getByRole("button", { name: stage1Selectors.introNodeName }).click();

    await expect(page.getByText("产物预览 · 今天 10:24")).toBeVisible();
    await page.getByRole("button", { name: "打开完整详情" }).click();
    await expect(page.getByRole("button", { name: "确认使用" })).toBeVisible();
    await expect(page.getByRole("button", { name: "作为输入" })).toBeVisible();
  });

  test("keeps teacher-visible UI free of engineering terms", async ({ page }) => {
    const visibleText = await getVisiblePageText(page);
    const matches = findUserVisibleEngineeringTerms(visibleText);

    expect(matches, `Teacher-visible engineering terms: ${matches.join(", ")}`).toEqual([]);
  });

  test("writes a desktop screenshot evidence file", async ({ page }, testInfo) => {
    await page.screenshot({
      path: testInfo.outputPath("stage1-desktop-shell.png"),
      fullPage: true,
    });
  });
});
