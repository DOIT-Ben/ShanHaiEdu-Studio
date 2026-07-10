import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_SEVERITIES,
  FEEDBACK_ORIGINS,
  appendFeedbackHint,
  parseFeedbackMetadata,
} from "@/server/feedback/contract";
import {
  enforceFeedbackImageDimensions,
  FeedbackImageDecodeGate,
  validateFeedbackAttachments,
} from "@/server/feedback/media";
import { createAnimatedWebp, createFeedbackImage } from "./support/feedback-fixtures";

describe("feedback contract", () => {
  it("publishes all guided categories with two or three chips", () => {
    expect(FEEDBACK_CATEGORIES.map((category) => category.id)).toEqual([
      "visual",
      "bug",
      "content_quality",
      "confusing",
      "feature_request",
      "performance",
      "other",
    ]);

    for (const category of FEEDBACK_CATEGORIES) {
      expect(category.label.length).toBeGreaterThan(0);
      expect(category.placeholder.length).toBeGreaterThan(0);
      expect(category.chips.length).toBeGreaterThanOrEqual(2);
      expect(category.chips.length).toBeLessThanOrEqual(3);
    }

    expect(FEEDBACK_SEVERITIES.map((severity) => severity.id)).toEqual([
      "normal",
      "affected",
      "blocked",
    ]);
    expect(FEEDBACK_ORIGINS).toEqual(["global", "profile", "message_helpful", "message_unhelpful"]);
  });

  it("appends a chip without replacing or duplicating the draft", () => {
    expect(appendFeedbackHint("已有说明", "按钮没有反应")).toBe("已有说明\n按钮没有反应");
    expect(appendFeedbackHint("已有说明\n按钮没有反应", "按钮没有反应")).toBe("已有说明\n按钮没有反应");
    expect(appendFeedbackHint("", "按钮没有反应")).toBe("按钮没有反应");
  });

  it("accepts and normalizes a complete metadata object", () => {
    expect(parseFeedbackMetadata({
      category: "bug",
      description: "  点击保存后没有响应。\r\n请检查。  ",
      severity: "affected",
      idempotencyKey: " feedback-123 ",
      origin: "message_unhelpful",
      pageRoute: " /workbench/project-1 ",
      projectId: " project-1 ",
      messageId: " message-1 ",
      clientContext: {
        userAgent: " Test Browser ",
        language: " zh-CN ",
        viewport: { width: 1440, height: 900 },
      },
    })).toEqual({
      category: "bug",
      description: "点击保存后没有响应。\n请检查。",
      severity: "affected",
      idempotencyKey: "feedback-123",
      origin: "message_unhelpful",
      pageRoute: "/workbench/project-1",
      projectId: "project-1",
      messageId: "message-1",
      clientContext: {
        userAgent: "Test Browser",
        language: "zh-CN",
        viewport: { width: 1440, height: 900 },
      },
    });
  });

  it.each([
    [{ category: "unknown" }, "category"],
    [{ description: "   " }, "description"],
    [{ severity: "critical" }, "severity"],
    [{ origin: "unknown" }, "origin"],
    [{ idempotencyKey: "" }, "idempotencyKey"],
    [{ pageRoute: "https://attacker.example/path" }, "pageRoute"],
    [{ unexpected: true }, "unexpected"],
    [{ appVersion: "forged-client-version" }, "appVersion"],
    [{ clientContext: { injected: true } }, "injected"],
    [{ clientContext: { viewport: { width: 100, height: 100, scale: 2 } } }, "scale"],
  ])("rejects invalid or unknown metadata fields", (override, expectedField) => {
    const candidate = {
      category: "bug",
      description: "按钮没有反应",
      severity: "normal",
      idempotencyKey: "feedback-123",
      origin: "global",
      pageRoute: "/workbench",
      clientContext: {
        userAgent: "Test Browser",
        language: "zh-CN",
        viewport: { width: 1440, height: 900 },
      },
      ...override,
    };

    expect(() => parseFeedbackMetadata(candidate)).toThrow(expectedField);
  });
});

describe("feedback image contract", () => {
  it("bounds decode concurrency and cancels timed-out work", async () => {
    const gate = new FeedbackImageDecodeGate({ maxConcurrent: 2, timeoutMs: 30 });
    let active = 0;
    let maximum = 0;
    const work = Array.from({ length: 4 }, () => gate.run(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return true;
    }));
    await expect(Promise.all(work)).resolves.toEqual([true, true, true, true]);
    expect(maximum).toBe(2);

    await expect(gate.run((signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    }))).rejects.toThrow("图片解码超时");
  });

  it("fully decodes through bounded statistics without allocating a raw output buffer", async () => {
    const source = await readFile(path.join(process.cwd(), "src", "server", "feedback", "media.ts"), "utf8");
    expect(source).toContain(".stats()");
    expect(source).not.toContain(".raw().toBuffer()");
  });

  it("fully decodes PNG, JPEG and WebP and records canonical metadata", async () => {
    const inputs = await Promise.all([
      createFeedbackImage("png"),
      createFeedbackImage("jpeg"),
      createFeedbackImage("webp"),
    ]);

    const result = await validateFeedbackAttachments([
      { bytes: inputs[0], mimeType: "image/png", fileName: "screen.png" },
      { bytes: inputs[1], mimeType: "image/jpeg", fileName: "photo.jpeg" },
      { bytes: inputs[2], mimeType: "image/webp", fileName: "capture.webp" },
    ]);

    expect(result.map(({ format, mimeType, width, height }) => ({ format, mimeType, width, height }))).toEqual([
      { format: "png", mimeType: "image/png", width: 2, height: 2 },
      { format: "jpeg", mimeType: "image/jpeg", width: 2, height: 2 },
      { format: "webp", mimeType: "image/webp", width: 2, height: 2 },
    ]);
    expect(result.every((attachment) => /^[a-f0-9]{64}$/.test(attachment.sha256))).toBe(true);
  });

  it.each([
    ["SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), "image/svg+xml", "attack.svg"],
    ["HTML", Buffer.from("<html><script>alert(1)</script></html>"), "image/png", "screen.png"],
    ["pseudo extension", Buffer.from("not a jpeg"), "image/jpeg", "screen.jpg"],
  ])("rejects %s content", async (_label, bytes, mimeType, fileName) => {
    await expect(validateFeedbackAttachments([{ bytes, mimeType, fileName }])).rejects.toThrow();
  });

  it("rejects an animated image even when its format is allowed", async () => {
    const bytes = await createAnimatedWebp();
    await expect(validateFeedbackAttachments([
      { bytes, mimeType: "image/webp", fileName: "animated.webp" },
    ])).rejects.toThrow("不支持动画图片");
  });

  it("enforces count, per-file bytes, aggregate bytes, dimensions and decoded pixels", async () => {
    const png = await createFeedbackImage("png");
    const attachment = { bytes: png, mimeType: "image/png", fileName: "screen.png" };

    await expect(validateFeedbackAttachments(Array.from({ length: 6 }, () => attachment))).rejects.toThrow(/5/);
    await expect(validateFeedbackAttachments([
      { ...attachment, bytes: Buffer.alloc(10 * 1024 * 1024 + 1) },
    ])).rejects.toThrow(/10 MiB/);
    await expect(validateFeedbackAttachments([
      { ...attachment, bytes: Buffer.alloc(9 * 1024 * 1024) },
      { ...attachment, bytes: Buffer.alloc(9 * 1024 * 1024) },
      { ...attachment, bytes: Buffer.alloc(8 * 1024 * 1024) },
    ])).rejects.toThrow(/25 MiB/);

    expect(() => enforceFeedbackImageDimensions({ width: 8193, height: 1 })).toThrow(/8192/);
    expect(() => enforceFeedbackImageDimensions({ width: 8000, height: 5001 })).toThrow(/40,000,000/);
    expect(() => enforceFeedbackImageDimensions({ width: 8000, height: 5000 })).not.toThrow();
  });
});
