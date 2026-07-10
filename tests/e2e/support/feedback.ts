import { expect, type APIRequestContext, type APIResponse, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import path from "node:path";
import { findUserVisibleEngineeringTerms, getVisiblePageText } from "./redline";

export const feedbackContract = {
  submitPath: process.env.M67_FEEDBACK_SUBMIT_PATH ?? "/api/feedback",
  adminListPath: process.env.M67_FEEDBACK_ADMIN_LIST_PATH ?? "/api/admin/feedback",
  adminExportPath: process.env.M67_FEEDBACK_ADMIN_EXPORT_PATH ?? "/api/admin/feedback/export?format=csv",
} as const;

export const feedbackSelectors = {
  globalTrigger: "[data-feedback-origin='global']",
  profileTrigger: "[data-profile-menu]",
  profileFeedbackItem: "[data-feedback-origin='profile']",
  dialog: "[data-feedback-dialog]",
  description: "[data-feedback-description]",
  fileInput: "input[type='file'][accept='image/png,image/jpeg,image/webp']",
  image: "[data-feedback-image]",
  removeImage: "button[aria-label^='删除图片']",
  submit: "[data-feedback-submit]",
  error: "[role='alert']",
} as const;

export type FeedbackSubmissionResponse = {
  feedbackId: string;
  receiptCode: string;
  status: "submitted";
  reused?: boolean;
};

export type AdminFeedbackItem = {
  id: string;
  receiptCode: string;
  category: string;
  description: string;
  severity: "normal" | "affected" | "blocked" | null;
};

export type AdminFeedbackListResponse = {
  items: AdminFeedbackItem[];
  total: number;
  nextCursor: string | null;
};

export type AdminFeedbackDetailResponse = {
  feedback: AdminFeedbackItem & {
    attachments: Array<{
      id: string;
      downloadUrl: string;
      mimeType: string;
      fileName?: string;
    }>;
  };
};

export type E2ECredentials = {
  email: string;
  password: string;
};

export const teacherCredentials: E2ECredentials = {
  email: process.env.M67_E2E_TEACHER_EMAIL ?? "m67-teacher@example.test",
  password: process.env.M67_E2E_TEACHER_PASSWORD ?? "M67 teacher password 2026!",
};

export const adminCredentials: E2ECredentials = {
  email: process.env.M67_E2E_ADMIN_EMAIL ?? "m67-admin@example.test",
  password: process.env.M67_E2E_ADMIN_PASSWORD ?? "M67 admin password 2026!",
};

const fixturePath = path.resolve(process.cwd(), "tests/fixtures/feedback-e2e/valid-1x1.png.base64");

export const validPng = Buffer.from(readFileSync(fixturePath, "utf8").trim(), "base64");

export async function loginThroughUi(page: Page, credentials: E2ECredentials = teacherCredentials) {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await expect(page.getByRole("heading", { name: "登录 ShanHaiEdu" })).toBeVisible();
  await page.getByLabel("邮箱").fill(credentials.email);
  await page.getByLabel("密码").fill(credentials.password);
  await page.locator("form").getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.locator(feedbackSelectors.globalTrigger)).toBeVisible();
}

export async function loginThroughApi(api: APIRequestContext, credentials: E2ECredentials) {
  const response = await api.post("/api/auth/login", { data: credentials });
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as { csrfToken?: unknown };
  expect(body.csrfToken).toEqual(expect.any(String));
  return body.csrfToken as string;
}

export async function submitFeedbackThroughApi(
  api: APIRequestContext,
  csrfToken: string,
  input: {
    idempotencyKey: string;
    description: string;
    category?: string;
    severity?: "normal" | "affected" | "blocked";
  },
) {
  const response = await api.post(feedbackContract.submitPath, {
    headers: { "x-shanhai-csrf": csrfToken },
    multipart: {
      metadata: JSON.stringify({
        category: input.category ?? "bug",
        description: input.description,
        ...(input.severity ? { severity: input.severity } : {}),
        idempotencyKey: input.idempotencyKey,
        origin: "global",
        pageRoute: "/m67-e2e",
        clientContext: {
          userAgent: "M67 Playwright API",
          viewport: { width: 1440, height: 900 },
        },
      }),
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as FeedbackSubmissionResponse;
  expect(body).toMatchObject({
    feedbackId: expect.any(String),
    receiptCode: expect.stringMatching(/^FB-\d{8}-[A-Z0-9]+$/),
    status: "submitted",
  });
  return body;
}

export async function expectFeedbackError(response: APIResponse, status: number, message: string) {
  expect(response.status(), await response.text()).toBe(status);
  expect(await response.json()).toEqual({ error: expect.any(String), message });
}

export function seedFeedbackRecords(count: number, prefix: string) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.startsWith("file:")) throw new Error("M67 DATABASE_URL must point to SQLite.");
  const db = new Database(databaseUrl.slice("file:".length));
  try {
    const user = db.prepare('SELECT "id" FROM "LocalUser" WHERE "email" = ?').get(teacherCredentials.email) as { id?: string } | undefined;
    if (!user?.id) throw new Error("M67 teacher seed is missing.");
    const insert = db.prepare(`
      INSERT INTO "FeedbackRecord" (
        "id", "receipt", "category", "description", "severity", "status", "idempotencyKey",
        "requestFingerprint", "origin", "pageRoute", "appVersion", "clientContextJson", "stagingKey",
        "createdByUserId", "createdAt", "updatedAt", "submittedAt"
      ) VALUES (?, ?, 'bug', ?, ?, 'submitted', ?, ?, 'global', '/m67-e2e', 'm67-e2e', '{}', ?, ?, ?, ?, ?)
    `);
    const receipts: string[] = [];
    db.transaction(() => {
      for (let index = 0; index < count; index += 1) {
        const suffix = `${prefix}-${index}`.replace(/[^A-Za-z0-9_-]/g, "_");
        const receipt = `FB-20990101-${index.toString(36).toUpperCase().padStart(8, "0")}`;
        const timestamp = new Date(Date.now() - index).toISOString();
        insert.run(
          `feedback-${suffix}`,
          receipt,
          index === 0 ? "+SUM(1,1) pagination formula probe" : `M67 pagination record ${index}`,
          index % 3 === 0 ? "normal" : index % 3 === 1 ? "affected" : "blocked",
          `m67-pagination-${suffix}`,
          `fingerprint-${suffix}`,
          `stage-${suffix}`,
          user.id,
          timestamp,
          timestamp,
          timestamp,
        );
        receipts.push(receipt);
      }
    })();
    return receipts;
  } finally {
    db.close();
  }
}

export async function ensureAssistantMessage(page: Page) {
  const assistantMessage = page.locator("article[data-message-role='assistant']").first();
  if (await assistantMessage.isVisible().catch(() => false)) return assistantMessage;

  const desktopCreate = page.getByRole("button", { name: "新建项目" });
  if (await desktopCreate.isVisible().catch(() => false)) {
    await desktopCreate.click();
  } else {
    await page.getByRole("button", { name: "项目", exact: true }).click();
    await page.getByRole("dialog", { name: "项目列表" }).getByRole("button", { name: "新建项目" }).click();
  }
  const composer = page.locator('textarea[name="lesson-workbench-prompt"]');
  await expect(composer).toBeVisible();
  await composer.fill("请简短确认已经收到这条 M67 反馈入口验收消息。");
  const accepted = page.waitForResponse(
    (response) => response.url().includes("/api/workbench/projects/") && response.url().endsWith("/messages") && response.status() === 202,
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await accepted;
  await expect(assistantMessage).toBeVisible({ timeout: 30_000 });
  return assistantMessage;
}

export function feedbackDialog(page: Page) {
  return page.locator(feedbackSelectors.dialog);
}

export async function openGlobalFeedback(page: Page) {
  await page.locator(`${feedbackSelectors.globalTrigger}:visible`).first().click();
  const dialog = feedbackDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function openProfileFeedback(page: Page) {
  await page.locator(`${feedbackSelectors.profileTrigger}:visible`).first().click();
  await page.locator(`${feedbackSelectors.profileFeedbackItem}:visible`).first().click();
  const dialog = feedbackDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function openMessageFeedback(page: Page, label: "这条有帮助" | "这条没帮上") {
  const message = await ensureAssistantMessage(page);
  await message.hover();
  const origin = label === "这条有帮助" ? "message_helpful" : "message_unhelpful";
  await message.locator(`[data-feedback-origin='${origin}']`).click();
  const dialog = feedbackDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function closeFeedback(dialog: Locator) {
  await dialog.getByRole("button", { name: "关闭反馈" }).click();
  await expect(dialog).toBeHidden();
}

export async function selectCategory(dialog: Locator, category: string) {
  const categoryControl = dialog.locator(`[data-feedback-category='${category}']`);
  await categoryControl.click();
  await expect(categoryControl).toHaveAttribute("aria-pressed", "true");
}

export async function selectSeverity(dialog: Locator, severity: "normal" | "affected" | "blocked") {
  const severityControl = dialog.locator(`[data-feedback-severity='${severity}']`);
  await severityControl.click();
  await expect(severityControl).toHaveAttribute("aria-pressed", "true");
}

export async function selectValidPng(dialog: Locator, name = "selected-screenshot.png") {
  await dialog.locator(feedbackSelectors.fileInput).setInputFiles({
    name,
    mimeType: "image/png",
    buffer: validPng,
  });
}

export async function pastePngFromSystemClipboard(
  page: Page,
  context: BrowserContext,
  dialog: Locator,
) {
  const origin = new URL(page.url()).origin;
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  await page.evaluate(async (bytes) => {
    const blob = new Blob([Uint8Array.from(bytes)], { type: "image/png" });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  }, [...validPng]);
  const before = await dialog.locator(feedbackSelectors.image).count();
  await dialog.locator(feedbackSelectors.description).focus();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
  await expect(dialog.locator(feedbackSelectors.image)).toHaveCount(before + 1);
}

export async function pastePngWithSyntheticClipboardEvent(page: Page, dialog: Locator) {
  const before = await dialog.locator(feedbackSelectors.image).count();
  await dialog.evaluate((node, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(bytes)], "synthetic-paste.png", { type: "image/png" }));
    node.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    }));
  }, [...validPng]);
  await expect(dialog.locator(feedbackSelectors.image)).toHaveCount(before + 1);
}

export async function assertDialogResponsive(page: Page, dialog: Locator) {
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.page, `document horizontal overflow: ${overflow.page}px`).toBeLessThanOrEqual(1);
  expect(overflow.body, `body horizontal overflow: ${overflow.body}px`).toBeLessThanOrEqual(1);

  const dialogOverflow = await dialog.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(dialogOverflow, `feedback dialog horizontal overflow: ${dialogOverflow}px`).toBeLessThanOrEqual(1);
  const submit = dialog.locator(feedbackSelectors.submit);
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeInViewport();
}

export async function assertNoSensitiveDisclosure(page: Page) {
  const visibleText = await getVisiblePageText(page);
  const terms = findUserVisibleEngineeringTerms(visibleText);
  expect(terms, `Teacher-visible engineering terms: ${terms.join(", ")}`).toEqual([]);
  expect(visibleText).not.toMatch(/[A-Za-z]:\\|\/(?:home|opt|private|tmp|Users)\/|\b(?:bearer|token)\b/i);
}

export function adminDetailPath(feedbackId: string) {
  return `${feedbackContract.adminListPath}/${encodeURIComponent(feedbackId)}`;
}

export function adminListPagePath(input: { limit: number; cursor?: string }) {
  const query = new URLSearchParams({ limit: String(input.limit) });
  if (input.cursor) query.set("cursor", input.cursor);
  return `${feedbackContract.adminListPath}?${query}`;
}

export function parseCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function expectCsvFormulaSafe(csv: string) {
  const rows = parseCsv(csv);
  expect(rows.length).toBeGreaterThan(1);
  for (const [rowIndex, row] of rows.entries()) {
    for (const [cellIndex, cell] of row.entries()) {
      expect(
        /^[\t\r=+\-@]/.test(cell),
        `CSV cell ${rowIndex + 1}:${cellIndex + 1} has an executable formula prefix: ${JSON.stringify(cell)}`,
      ).toBe(false);
    }
  }
}
