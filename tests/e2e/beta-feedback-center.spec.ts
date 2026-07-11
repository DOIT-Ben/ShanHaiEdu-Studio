import { expect, request as playwrightRequest, test } from "@playwright/test";
import {
  type AdminFeedbackDetailResponse,
  type AdminFeedbackListResponse,
  adminCredentials,
  adminDetailPath,
  adminListPagePath,
  assertDialogResponsive,
  assertNoSensitiveDisclosure,
  closeFeedback,
  expectFeedbackError,
  expectCsvFormulaSafe,
  feedbackContract,
  feedbackDialog,
  feedbackSelectors,
  loginThroughApi,
  loginThroughUi,
  openGlobalFeedback,
  openMessageFeedback,
  openProfileFeedback,
  parseCsv,
  pastePngFromSystemClipboard,
  pastePngWithSyntheticClipboardEvent,
  selectCategory,
  selectSeverity,
  selectValidPng,
  seedFeedbackRecords,
  submitFeedbackThroughApi,
  teacherCredentials,
} from "./support/feedback";

test.describe("M67 beta feedback center", () => {
  test.describe.configure({ mode: "serial" });

  let submittedReceipt = "";
  let submittedFeedbackId = "";

  test.beforeEach(async ({ page }) => {
    await loginThroughUi(page);
  });

  test("all entry points reuse one guided dialog with selectable and pasted PNG attachments", async ({ page, context }) => {
    const dialog = await openGlobalFeedback(page);
    await expect(feedbackDialog(page)).toHaveCount(1);
    await assertDialogResponsive(page, dialog);

    const submit = dialog.locator(feedbackSelectors.submit);
    await expect(submit).toHaveCSS("background-color", "rgb(54, 125, 109)");
    await expect(submit).toHaveCSS("color", "rgb(255, 255, 255)");
    await submit.click();
    await expect(dialog.locator(feedbackSelectors.error)).toContainText("选择反馈类型");
    await selectCategory(dialog, "bug");
    const category = dialog.locator("[data-feedback-category='bug']");
    await expect(category).toHaveAttribute("aria-pressed", "true");
    await expect(category).toHaveCSS("border-top-width", "2px");
    await expect(category).toHaveCSS("background-color", "rgb(238, 247, 243)");
    await expect(category.locator("svg")).toHaveCount(1);
    for (const severity of ["normal", "affected", "blocked"] as const) {
      await expect(dialog.locator(`[data-feedback-severity='${severity}']`)).toBeVisible();
    }
    await selectSeverity(dialog, "affected");
    const affectedSeverity = dialog.locator("[data-feedback-severity='affected']");
    await expect(affectedSeverity).toHaveAttribute("aria-pressed", "true");
    await expect(affectedSeverity).toHaveCSS("border-top-width", "2px");
    await expect(affectedSeverity).toHaveCSS("background-color", "rgb(238, 247, 243)");
    await expect(affectedSeverity.locator("svg")).toHaveCount(1);
    const description = dialog.locator(feedbackSelectors.description);
    await expect(description).toHaveAttribute("placeholder", /按钮|步骤|预期/);

    const chip = dialog.locator("[data-feedback-chip]").filter({ hasText: "按钮没有反应" });
    await chip.click();
    await expect(description).toHaveValue(/按钮没有反应/);
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(chip).toHaveCSS("border-top-width", "2px");
    await expect(chip).toHaveCSS("background-color", "rgb(238, 247, 243)");
    await expect(chip.locator("svg")).toHaveCount(1);
    await chip.click();
    expect((await description.inputValue()).match(/按钮没有反应/g)).toHaveLength(1);

    await selectValidPng(dialog);
    await expect(dialog.locator(feedbackSelectors.image)).toHaveCount(1);
    await expect(dialog.getByAltText("selected-screenshot.png")).toBeVisible();
    await expect(dialog.getByText(/\d+(?:\.\d+)?\s*(?:B|KB)/)).toBeVisible();
    await pastePngFromSystemClipboard(page, context, dialog);
    await pastePngWithSyntheticClipboardEvent(page, dialog);
    await expect(dialog.locator(feedbackSelectors.image)).toHaveCount(3);
    await dialog.locator(feedbackSelectors.removeImage).first().click();
    await expect(dialog.locator(feedbackSelectors.image)).toHaveCount(2);
    await closeFeedback(dialog);

    const profileDialog = await openProfileFeedback(page);
    await expect(feedbackDialog(page)).toHaveCount(1);
    await closeFeedback(profileDialog);

    const positiveDialog = await openMessageFeedback(page, "这条有帮助");
    await expect(feedbackDialog(page)).toHaveCount(1);
    await closeFeedback(positiveDialog);

    const negativeDialog = await openMessageFeedback(page, "这条没帮上");
    await expect(feedbackDialog(page)).toHaveCount(1);
    await assertDialogResponsive(page, negativeDialog);
    await assertNoSensitiveDisclosure(page);
  });

  test("failed submission keeps the draft, retry is single-flight, and admin can read it after refresh", async ({ page }) => {
    let submissionAttempts = 0;
    let inFlightRequests = 0;
    await page.route(`**${feedbackContract.submitPath}`, async (route) => {
      submissionAttempts += 1;
      inFlightRequests += 1;
      try {
        if (submissionAttempts === 1) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ message: "暂时没有提交成功，请保留内容后重试。" }),
          });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 350));
        await route.continue();
      } finally {
        inFlightRequests -= 1;
      }
    });

    const dialog = await openGlobalFeedback(page);
    await selectCategory(dialog, "bug");
    const formulaProbe = `=1+1 M67 retry ${test.info().project.name}`;
    await dialog.locator(feedbackSelectors.description).fill(formulaProbe);
    await selectValidPng(dialog, "retry-draft.png");

    const submit = dialog.locator(feedbackSelectors.submit);
    await submit.click();
    await expect(dialog.locator(feedbackSelectors.error)).toContainText("保留");
    await expect(dialog.locator(feedbackSelectors.description)).toHaveValue(formulaProbe);
    await expect(dialog.locator(feedbackSelectors.image)).toHaveCount(1);

    await submit.click();
    await expect(submit).toBeDisabled();
    await submit.dispatchEvent("click");
    expect(inFlightRequests).toBeLessThanOrEqual(1);
    await expect(dialog).toHaveAttribute("data-feedback-status", "submitted");
    await expect(dialog).toContainText(/FB-\d{8}-[A-Z0-9]+/);
    submittedReceipt = (await dialog.innerText()).match(/FB-\d{8}-[A-Z0-9]+/)?.[0] ?? "";
    expect(submittedReceipt).not.toBe("");
    expect(submissionAttempts).toBe(2);

    await page.reload();
    await expect(page.locator(feedbackSelectors.globalTrigger)).toBeVisible();

    const adminApi = await playwrightRequest.newContext({ baseURL: test.info().project.use.baseURL as string });
    try {
      await loginThroughApi(adminApi, adminCredentials);
      const listResponse = await adminApi.get(feedbackContract.adminListPath);
      expect(listResponse.status(), await listResponse.text()).toBe(200);
      const list = (await listResponse.json()) as AdminFeedbackListResponse;
      expect(list).toMatchObject({ items: expect.any(Array), total: expect.any(Number) });
      expect(list.nextCursor === null || typeof list.nextCursor === "string").toBe(true);
      const item = list.items.find((entry) => entry.receiptCode === submittedReceipt);
      expect(item?.id).toEqual(expect.any(String));
      submittedFeedbackId = item?.id ?? "";
    } finally {
      await adminApi.dispose();
    }
    await assertNoSensitiveDisclosure(page);
  });

  test("teacher admin access is forbidden while admin detail, attachment, and formula-safe CSV work", async ({ page }) => {
    expect(submittedFeedbackId).not.toBe("");
    const baseURL = test.info().project.use.baseURL as string;
    const teacherApi = await playwrightRequest.newContext({ baseURL });
    const adminApi = await playwrightRequest.newContext({ baseURL });
    try {
      await loginThroughApi(teacherApi, teacherCredentials);
      await loginThroughApi(adminApi, adminCredentials);

      await expectFeedbackError(
        await teacherApi.get(feedbackContract.adminListPath),
        403,
        "你没有权限查看这些反馈。",
      );
      await expectFeedbackError(
        await teacherApi.get(feedbackContract.adminExportPath),
        403,
        "你没有权限查看这些反馈。",
      );
      const missingCsrf = await teacherApi.post(feedbackContract.submitPath, { data: {} });
      expect(missingCsrf.status(), await missingCsrf.text()).toBe(403);
      expect(await missingCsrf.json()).toEqual({ error: "请求暂时不能处理，请刷新页面后重试。" });
      await expectFeedbackError(
        await adminApi.get(`${feedbackContract.adminListPath}?limit=0`),
        400,
        "反馈内容格式不正确，请检查后重试。",
      );
      await expectFeedbackError(
        await adminApi.get(adminDetailPath("missing-feedback")),
        404,
        "没有找到这条反馈。",
      );

      const detailResponse = await adminApi.get(adminDetailPath(submittedFeedbackId));
      expect(detailResponse.status(), await detailResponse.text()).toBe(200);
      const detail = (await detailResponse.json()) as AdminFeedbackDetailResponse;
      expect(detail.feedback.id).toBe(submittedFeedbackId);
      expect(detail.feedback.receiptCode).toBe(submittedReceipt);
      expect(detail.feedback.attachments.length).toBeGreaterThan(0);
      const attachment = detail.feedback.attachments[0];
      expect(attachment.downloadUrl).toMatch(/^\/api\/admin\/feedback\//);

      await expectFeedbackError(
        await teacherApi.get(attachment.downloadUrl),
        403,
        "你没有权限查看这些反馈。",
      );
      const adminAttachment = await adminApi.get(attachment.downloadUrl);
      expect(adminAttachment.status(), await adminAttachment.text()).toBe(200);
      expect(adminAttachment.headers()["content-type"]).toContain("image/png");
      expect((await adminAttachment.body()).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

      const registration = await teacherApi.post("/api/auth/register", {
        data: {
          email: `not-invited-${test.info().project.name}@example.test`,
          displayName: "未邀请用户",
          password: "M67 uninvited password 2026!",
        },
      });
      expect([403, 404]).toContain(registration.status());
    } finally {
      await teacherApi.dispose();
      await adminApi.dispose();
    }
    await assertNoSensitiveDisclosure(page);
  });

  test("admin pagination and CSV export include more than 200 feedback records without truncation", async ({ page }) => {
    test.skip(test.info().project.name !== "chromium-desktop", "Large pagination coverage runs once against the shared isolated database.");
    const baseURL = test.info().project.use.baseURL as string;
    const teacherApi = await playwrightRequest.newContext({ baseURL });
    const adminApi = await playwrightRequest.newContext({ baseURL });
    try {
      const csrfToken = await loginThroughApi(teacherApi, teacherCredentials);
       const createdReceipts = seedFeedbackRecords(201, test.info().project.name);

      const conflictKey = `m67-conflict-${test.info().project.name}`;
      await submitFeedbackThroughApi(teacherApi, csrfToken, {
        idempotencyKey: conflictKey,
        description: "M67 original idempotent payload",
      });
      const conflictResponse = await teacherApi.post(feedbackContract.submitPath, {
        headers: { "x-shanhai-csrf": csrfToken },
        multipart: {
          metadata: JSON.stringify({
            category: "bug",
            description: "M67 changed idempotent payload",
             idempotencyKey: conflictKey,
             origin: "global",
             pageRoute: "/m67-e2e",
            clientContext: { userAgent: "M67 Playwright API", viewport: { width: 1440, height: 900 } },
          }),
        },
      });
      await expectFeedbackError(
        conflictResponse,
        409,
        "这次反馈与之前使用同一提交标识的内容不同，请刷新后重试。",
      );

      await loginThroughApi(adminApi, adminCredentials);
      const firstResponse = await adminApi.get(adminListPagePath({ limit: 200 }));
      expect(firstResponse.status(), await firstResponse.text()).toBe(200);
      const firstPage = (await firstResponse.json()) as AdminFeedbackListResponse;
      expect(firstPage.items).toHaveLength(200);
      expect(firstPage.total).toBeGreaterThan(200);
      expect(firstPage.nextCursor).toEqual(expect.any(String));

      const secondResponse = await adminApi.get(adminListPagePath({ limit: 200, cursor: firstPage.nextCursor ?? undefined }));
      expect(secondResponse.status(), await secondResponse.text()).toBe(200);
      const secondPage = (await secondResponse.json()) as AdminFeedbackListResponse;
      expect(secondPage.total).toBe(firstPage.total);
      expect(secondPage.items.length).toBe(firstPage.total - firstPage.items.length);
      expect(new Set([...firstPage.items, ...secondPage.items].map((item) => item.id)).size).toBe(firstPage.total);
      expect([...firstPage.items, ...secondPage.items].some((item) => item.receiptCode === createdReceipts[0])).toBe(true);
      expect([...firstPage.items, ...secondPage.items].some((item) => item.receiptCode === createdReceipts.at(-1))).toBe(true);

      const csvResponse = await adminApi.get(feedbackContract.adminExportPath);
      expect(csvResponse.status(), await csvResponse.text()).toBe(200);
      expect(csvResponse.headers()["content-type"]).toContain("text/csv");
      expect(csvResponse.headers()["content-disposition"]).toMatch(/attachment/i);
      const csv = await csvResponse.text();
      expectCsvFormulaSafe(csv);
      expect(parseCsv(csv).length - 1).toBe(firstPage.total);
      expect(csv).toContain(createdReceipts[0]);
      expect(csv).toContain(createdReceipts.at(-1) ?? "missing-receipt");
    } finally {
      await teacherApi.dispose();
      await adminApi.dispose();
    }
    await assertNoSensitiveDisclosure(page);
  });
});
