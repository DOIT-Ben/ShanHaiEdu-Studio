import { expect, test } from "@playwright/test";
import { findUserVisibleEngineeringTerms, getVisiblePageText } from "./support/redline";
import { stage1Selectors } from "./support/stage1-fixtures";

test.describe("M55-A delivery plan card", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.getByPlaceholder(stage1Selectors.composerPlaceholder).waitFor({ state: "visible" });
  });

  test("shows a teacher-facing delivery plan before generating the first artifact", async ({ page }) => {
    await page.getByPlaceholder(stage1Selectors.composerPlaceholder).fill("帮我做五年级数学百分数公开课完整材料包，包括教案、PPT、图片和导入视频");
    await page.getByRole("button", { name: "发送" }).click();

    await expect(page.getByText("备课推进计划")).toBeVisible();
    await expect(page.getByText("公开课完整交付计划")).toBeVisible();
    await expect(page.getByText("整理备课需求", { exact: true })).toBeVisible();
    await expect(page.getByText("生成公开课教案", { exact: true })).toBeVisible();
    await expect(page.getByText("生成 PPT 大纲", { exact: true })).toBeVisible();
    await expect(page.getByText("等待确认")).toBeVisible();
    await expect(page.getByRole("button", { name: "确认开始" })).toBeVisible();

    const visibleText = await getVisiblePageText(page);
    expect(findUserVisibleEngineeringTerms(visibleText)).toEqual([]);
  });
});
