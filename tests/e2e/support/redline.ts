import type { Page } from "@playwright/test";

export const USER_VISIBLE_ENGINEERING_TERMS = [
  "schema",
  "manifest",
  "provider",
  "node_id",
  "storage",
  "API",
  "debug",
  "local path",
  "mock",
  "placeholder",
  "deterministic",
] as const;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function getVisiblePageText(page: Page) {
  return page.locator("body").innerText();
}

export function findUserVisibleEngineeringTerms(text: string) {
  return USER_VISIBLE_ENGINEERING_TERMS.filter((term) => {
    const pattern = new RegExp(`(^|[^a-zA-Z0-9_])${escapeRegExp(term)}([^a-zA-Z0-9_]|$)`, "i");
    return pattern.test(text);
  });
}
