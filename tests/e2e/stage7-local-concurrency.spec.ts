import { expect, test, type Browser, type Page } from "@playwright/test";

const composerPlaceholder = "继续描述备课目标，或引用右侧产物继续生成";
const promptA = "A老师要做五年级百分数公开课，重点是生活折扣。";
const promptB = "B老师要做四年级平均数公开课，重点是篮球得分。";

test.describe("E2E Stage 7 local concurrency isolation", () => {
  test("keeps two browser contexts on their own project after refresh", async ({ browser }) => {
    const teacherA = await openTeacherContext(browser);
    const teacherB = await openTeacherContext(browser);

    try {
      await createProjectAndSendPrompt(teacherA, promptA);
      await createProjectAndSendPrompt(teacherB, promptB);

      await expect(messageBubble(teacherA, promptA)).toBeVisible();
      await expect(messageBubble(teacherB, promptB)).toBeVisible();
      await expect(messageBubble(teacherA, promptB)).toBeHidden();
      await expect(messageBubble(teacherB, promptA)).toBeHidden();
      await expect(teacherA.getByRole("button", { name: /需求规格说明书，待确认/ })).toBeVisible();
      await expect(teacherB.getByRole("button", { name: /需求规格说明书，待确认/ })).toBeVisible();

      await teacherA.reload();
      await teacherB.reload();
      await teacherA.getByPlaceholder(composerPlaceholder).waitFor({ state: "visible" });
      await teacherB.getByPlaceholder(composerPlaceholder).waitFor({ state: "visible" });

      await expect(messageBubble(teacherA, promptA)).toBeVisible();
      await expect(messageBubble(teacherB, promptB)).toBeVisible();
      await expect(messageBubble(teacherA, promptB)).toBeHidden();
      await expect(messageBubble(teacherB, promptA)).toBeHidden();
      await expect(teacherA.getByRole("button", { name: /需求规格说明书，待确认/ })).toBeVisible();
      await expect(teacherB.getByRole("button", { name: /需求规格说明书，待确认/ })).toBeVisible();
    } finally {
      await teacherA.context().close();
      await teacherB.context().close();
    }
  });
});

async function openTeacherContext(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder(composerPlaceholder).waitFor({ state: "visible" });
  return page;
}

async function createProjectAndSendPrompt(page: Page, prompt: string) {
  await page.getByRole("button", { name: "新建项目" }).click();
  await expect(page.getByText("已新建公开课项目，可以开始描述备课目标。")).toBeVisible();
  await page.getByPlaceholder(composerPlaceholder).fill(prompt);
  const messageCreated = page.waitForResponse(
    (response) => response.url().includes("/api/workbench/projects/") && response.url().endsWith("/messages") && response.status() === 201,
  );
  await page.getByRole("button", { name: "发送" }).click();
  await messageCreated;
  await expect(messageBubble(page, prompt)).toBeVisible();
}

function messageBubble(page: Page, prompt: string) {
  return page.locator("div").filter({ hasText: new RegExp(`^${prompt}$`) });
}
