import { describe, expect, it } from "vitest";

import { resolveSafeMarkdownHref } from "@/components/conversation/assistant-ui/MessagePartRenderers";

describe("assistant-ui markdown link boundary", () => {
  it("allows https and same-origin absolute paths", () => {
    expect(resolveSafeMarkdownHref("https://example.com/reference")).toBe("https://example.com/reference");
    expect(resolveSafeMarkdownHref("/artifacts/lesson-1")).toBe("/artifacts/lesson-1");
  });

  it.each([
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "data:text/html,unsafe",
  ])("renders unsafe href %s as plain text", (href) => {
    expect(resolveSafeMarkdownHref(href)).toBeUndefined();
  });
});
