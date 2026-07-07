import { expect, test } from "@playwright/test";
import { findUserVisibleEngineeringTerms, getVisiblePageText } from "./support/redline";

const password = "M40C browser passphrase 2026!";
const composerPlaceholder = "继续描述备课目标，或引用右侧产物继续生成";

test.describe("E2E Stage 40C password auth UI", () => {
  test("gates the workbench, registers a teacher, restores after refresh, and logs out", async ({ page }, testInfo) => {
    const email = `m40c-${testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}@example.test`;
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: "登录 ShanHaiEdu" })).toBeVisible();
    await expect(page.getByPlaceholder(composerPlaceholder)).toBeHidden();
    await expect(page.getByRole("button", { name: "新建项目" })).toBeHidden();

    await page.getByRole("button", { name: "创建账号" }).click();
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("显示名").fill("百分数公开课教师");
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "创建并进入" }).click();

    await expect(page.getByPlaceholder(composerPlaceholder)).toBeVisible();
    await createProjectFromVisibleEntry(page);
    await expect(page.getByText("已新建公开课项目，可以开始描述备课目标。")).toBeVisible();

    await page.reload();
    await page.getByPlaceholder(composerPlaceholder).waitFor({ state: "visible" });

    await page.getByRole("button", { name: "退出登录" }).click();
    await expect(page.getByRole("heading", { name: "登录 ShanHaiEdu" })).toBeVisible();
    await expect(page.getByPlaceholder(composerPlaceholder)).toBeHidden();

    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(password);
    await page.locator("form").getByRole("button", { name: "登录" }).click();
    await expect(page.getByPlaceholder(composerPlaceholder)).toBeVisible();

    const visibleText = await getVisiblePageText(page);
    const matches = findUserVisibleEngineeringTerms(visibleText);
    expect(matches, `Teacher-visible engineering terms: ${matches.join(", ")}`).toEqual([]);
  });
});

async function createProjectFromVisibleEntry(page: import("@playwright/test").Page) {
  const desktopCreate = page.getByRole("button", { name: "新建项目" });
  if (await desktopCreate.isVisible()) {
    await desktopCreate.click();
    return;
  }

  await page.getByRole("button", { name: "项目" }).click();
  await page.getByRole("dialog", { name: "项目列表" }).getByRole("button", { name: "新建项目" }).click();
}
