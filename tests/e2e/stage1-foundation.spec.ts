import { expect, test, type Page } from "@playwright/test";
import { findUserVisibleEngineeringTerms, getVisiblePageText } from "./support/redline";
import { stage1Selectors, stage1TeacherPrompt } from "./support/stage1-fixtures";

test.describe("E2E Stage 1 foundation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await composer(page).waitFor({ state: "visible" });
  });

  test("loads the current workbench shell", async ({ page }) => {
    await expect(composer(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
    await expect(page.getByText(stage1Selectors.firstStepName)).toBeVisible();
  });

  test("drives the prompt composer without claiming real generation", async ({ page }) => {
    await composer(page).fill(stage1TeacherPrompt);
    const messageAccepted = page.waitForResponse(
      (response) => response.url().includes("/api/workbench/projects/") && response.url().endsWith("/messages") && response.status() === 202,
    );
    await page.getByRole("button", { name: "发送" }).click();
    await messageAccepted;

    await expect(page.getByText("已发送")).toBeVisible();
    await expect(composer(page)).toHaveValue("");
    await expect(page.locator("div").filter({ hasText: new RegExp(`^${stage1TeacherPrompt}$`) })).toBeVisible();
  });

  test("creates a project and keeps the artifact workspace reachable", async ({ page }) => {
    await composer(page).fill(stage1TeacherPrompt);
    const projectCreated = page.waitForResponse((response) => response.url().endsWith("/api/workbench/projects") && response.status() === 201);
    const messageAccepted = page.waitForResponse(
      (response) => response.url().includes("/api/workbench/projects/") && response.url().endsWith("/messages") && response.status() === 202,
    );
    await page.getByRole("button", { name: "发送" }).click();
    await projectCreated;
    await messageAccepted;

    await expect(page.getByText("未保存")).toBeHidden();
    await expect(page.getByRole("button", { name: "更多产物操作" })).toBeVisible();
    await expect(page.getByText(stage1Selectors.firstStepName)).toBeVisible();
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

function composer(page: Page) {
  return page.locator('textarea[name="lesson-workbench-prompt"]');
}
