import { describe, expect, it } from "vitest";

import { isSafeMarkdownLink, renderMarkdownBlocks } from "@/components/artifacts/MarkdownPreview";

describe("V1-9R4 MarkdownPreview", () => {
  it("preserves headings, lists, quotes, bold text, and links as structured safe content", () => {
    expect(renderMarkdownBlocks("## 课堂目标\n\n- **理解**百分数\n- [教材](https://example.edu/textbook)\n\n> 先让学生观察命中率")).toEqual([
      { type: "heading", level: 2, text: "课堂目标" },
      { type: "list", items: ["**理解**百分数", "[教材](https://example.edu/textbook)"] },
      { type: "quote", text: "先让学生观察命中率" },
    ]);
  });

  it("rejects executable and data links before they reach an anchor element", () => {
    expect(isSafeMarkdownLink("https://example.edu/resource")).toBe(true);
    expect(isSafeMarkdownLink("mailto:teacher@example.edu")).toBe(true);
    expect(isSafeMarkdownLink("javascript:alert(1)")).toBe(false);
    expect(isSafeMarkdownLink("data:text/html,unsafe")).toBe(false);
  });
});
