import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import type { FeedbackAttachmentKind } from "@/lib/feedback-contracts";

export const MAX_FEEDBACK_ATTACHMENTS = 5;
export const MAX_FEEDBACK_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_FEEDBACK_TOTAL_BYTES = 25 * 1024 * 1024;
export const MAX_FEEDBACK_IMAGE_DIMENSION = 8192;
export const MAX_FEEDBACK_IMAGE_PIXELS = 40_000_000;

export type FeedbackAttachmentInput = {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
  kind?: FeedbackAttachmentKind;
};

export type ValidatedFeedbackAttachment = Omit<FeedbackAttachmentInput, "kind"> & {
  kind: FeedbackAttachmentKind;
  format: "png" | "jpeg" | "webp";
  extension: "png" | "jpg" | "webp";
  width: number;
  height: number;
  byteSize: number;
  sha256: string;
};

const formats = {
  png: { mimeType: "image/png", extensions: new Set([".png"]), extension: "png" },
  jpeg: { mimeType: "image/jpeg", extensions: new Set([".jpg", ".jpeg"]), extension: "jpg" },
  webp: { mimeType: "image/webp", extensions: new Set([".webp"]), extension: "webp" },
} as const;

export class FeedbackImageDecodeGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly maxConcurrent: number;
  private readonly timeoutMs: number;

  constructor(options: { maxConcurrent: number; timeoutMs: number }) {
    this.maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent));
    this.timeoutMs = Math.max(1, Math.floor(options.timeoutMs));
  }

  async run<T>(operation: (signal: AbortSignal) => Promise<T>) {
    await this.acquire();
    const controller = new AbortController();
    const operationPromise = Promise.resolve().then(() => operation(controller.signal));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error("图片解码超时，请压缩图片后重试。"));
        controller.abort();
      }, this.timeoutMs);
    });

    try {
      return await Promise.race([operationPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
      void operationPromise.catch(() => undefined).finally(() => this.release());
    }
  }

  private async acquire() {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  private release() {
    this.active -= 1;
    this.waiters.shift()?.();
  }
}

const decodeGate = new FeedbackImageDecodeGate({
  maxConcurrent: Number(process.env.FEEDBACK_IMAGE_DECODE_CONCURRENCY ?? 2),
  timeoutMs: Number(process.env.FEEDBACK_IMAGE_DECODE_TIMEOUT_MS ?? 10_000),
});

export async function validateFeedbackAttachments(inputs: FeedbackAttachmentInput[]) {
  if (inputs.length > MAX_FEEDBACK_ATTACHMENTS) {
    throw new Error(`最多只能上传 ${MAX_FEEDBACK_ATTACHMENTS} 张图片。`);
  }

  const totalBytes = inputs.reduce((sum, input) => sum + input.bytes.length, 0);
  if (totalBytes > MAX_FEEDBACK_TOTAL_BYTES) {
    throw new Error("全部图片合计不能超过 25 MiB。");
  }
  for (const input of inputs) {
    if (input.kind !== undefined && input.kind !== "issue" && input.kind !== "expected") {
      throw new Error("反馈图片分类无效。");
    }
    if (input.bytes.length === 0) throw new Error("图片内容不能为空。");
    if (input.bytes.length > MAX_FEEDBACK_ATTACHMENT_BYTES) {
      throw new Error("单张图片不能超过 10 MiB。");
    }
  }

  return Promise.all(inputs.map((input) => validateFeedbackAttachment(input)));
}

export function enforceFeedbackImageDimensions(input: { width?: number; height?: number }) {
  if (!input.width || !input.height) throw new Error("无法读取图片尺寸。");
  if (input.width > MAX_FEEDBACK_IMAGE_DIMENSION || input.height > MAX_FEEDBACK_IMAGE_DIMENSION) {
    throw new Error("图片宽高不能超过 8192 像素。");
  }
  if (input.width * input.height > MAX_FEEDBACK_IMAGE_PIXELS) {
    throw new Error("图片解码像素不能超过 40,000,000。 ");
  }
}

async function validateFeedbackAttachment(input: FeedbackAttachmentInput): Promise<ValidatedFeedbackAttachment> {
  const requestedMime = input.mimeType.toLowerCase().trim();
  if (!Object.values(formats).some((entry) => entry.mimeType === requestedMime)) {
    throw new Error("只支持 PNG、JPEG 或 WebP 图片。");
  }

  const extension = path.extname(input.fileName).toLowerCase();
  if (!extension || input.fileName.includes("\0")) throw new Error("图片文件名无效。");

  return decodeGate.run(async (signal) => {
    const image = sharp(input.bytes, {
      animated: true,
      failOn: "warning",
      limitInputPixels: MAX_FEEDBACK_IMAGE_PIXELS,
      sequentialRead: true,
    });
    let fullDecode: sharp.Sharp | undefined;
    const cancel = () => {
      image.destroy();
      fullDecode?.destroy();
    };
    signal.addEventListener("abort", cancel, { once: true });

    try {
      let metadata: sharp.Metadata;
      try {
        metadata = await image.metadata();
      } catch {
        throw new Error("图片内容无法完整解码。");
      }

      if (metadata.pages && metadata.pages > 1) throw new Error("不支持动画图片，请上传静态 PNG、JPEG 或 WebP 图片。");
      if (metadata.format !== "png" && metadata.format !== "jpeg" && metadata.format !== "webp") {
        throw new Error("只支持 PNG、JPEG 或 WebP 图片。");
      }

      const expected = formats[metadata.format];
      if (requestedMime !== expected.mimeType || !expected.extensions.has(extension as never)) {
        throw new Error("图片类型、扩展名与真实内容不一致。");
      }
      enforceFeedbackImageDimensions(metadata);

      fullDecode = image.clone();
      try {
        await fullDecode.stats();
      } catch {
        throw new Error("图片内容无法完整解码。");
      }

      return {
        ...input,
        kind: input.kind ?? "issue",
        mimeType: expected.mimeType,
        format: metadata.format,
        extension: expected.extension,
        width: metadata.width!,
        height: metadata.height!,
        byteSize: input.bytes.length,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
      };
    } finally {
      signal.removeEventListener("abort", cancel);
      image.destroy();
      fullDecode?.destroy();
    }
  });
}
