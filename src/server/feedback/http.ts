import { once } from "node:events";
import { Readable } from "node:stream";
import busboy from "busboy";
import type { WorkbenchActor } from "@/server/auth/actor";
import { checkRateLimit } from "@/server/auth/rate-limit";
import { FEEDBACK_CATEGORIES, FEEDBACK_SEVERITIES, type FeedbackCategory, type FeedbackSeverity } from "./contract";
import { serializeFeedbackCsv, type FeedbackExportRow } from "./export";
import {
  MAX_FEEDBACK_ATTACHMENTS,
  MAX_FEEDBACK_ATTACHMENT_BYTES,
  MAX_FEEDBACK_TOTAL_BYTES,
  type FeedbackAttachmentInput,
} from "./media";
import type { FeedbackRecordEntity } from "./repository";
import { FeedbackConflictError, createFeedbackService } from "./service";

type FeedbackService = ReturnType<typeof createFeedbackService>;

const MAX_MULTIPART_BODY_BYTES = MAX_FEEDBACK_TOTAL_BYTES + 512 * 1024;
const categoryIds = new Set<string>(FEEDBACK_CATEGORIES.map((entry) => entry.id));
const severityIds = new Set<string>(FEEDBACK_SEVERITIES.map((entry) => entry.id));

class FeedbackHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function parseFeedbackMultipart(request: Request): Promise<{
  metadata: unknown;
  attachments: FeedbackAttachmentInput[];
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new FeedbackHttpError(415, "Feedback submission requires multipart/form-data.");
  }
  const contentLength = parseContentLength(request.headers.get("content-length"));
  if (contentLength !== null && contentLength > MAX_MULTIPART_BODY_BYTES) {
    throw new FeedbackHttpError(413, "Feedback upload is too large.");
  }
  if (!request.body) throw new FeedbackHttpError(400, "Feedback body is required.");

  let parser: ReturnType<typeof busboy>;
  try {
    parser = busboy({
      headers: { "content-type": contentType },
      limits: {
        files: MAX_FEEDBACK_ATTACHMENTS,
        fileSize: MAX_FEEDBACK_ATTACHMENT_BYTES,
        fields: 1,
        fieldSize: 64 * 1024,
        parts: MAX_FEEDBACK_ATTACHMENTS + 1,
      },
    });
  } catch {
    throw new FeedbackHttpError(400, "Feedback multipart boundary is invalid.");
  }

  let metadataText: string | null = null;
  let parseError: FeedbackHttpError | null = null;
  let binaryBytes = 0;
  let bodyBytes = 0;
  let fileIndex = 0;
  const attachments: Array<FeedbackAttachmentInput | undefined> = [];

  parser.on("field", (name, value, info) => {
    if (name !== "metadata" || metadataText !== null) {
      parseError ??= new FeedbackHttpError(400, "Feedback metadata field is invalid.");
      return;
    }
    if (info.valueTruncated) parseError ??= new FeedbackHttpError(413, "Feedback metadata is too large.");
    metadataText = value;
  });
  parser.on("file", (name, stream, info) => {
    const index = fileIndex++;
    if (name !== "images") {
      parseError ??= new FeedbackHttpError(400, "Unexpected feedback file field.");
      stream.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let fileBytes = 0;
    stream.on("data", (chunk: Buffer) => {
      fileBytes += chunk.length;
      binaryBytes += chunk.length;
      if (binaryBytes > MAX_FEEDBACK_TOTAL_BYTES) {
        parseError ??= new FeedbackHttpError(413, "Feedback images exceed the 25 MiB total limit.");
        return;
      }
      chunks.push(chunk);
    });
    stream.on("limit", () => {
      parseError ??= new FeedbackHttpError(413, "A feedback image exceeds the 10 MiB limit.");
    });
    stream.on("end", () => {
      if (fileBytes <= MAX_FEEDBACK_ATTACHMENT_BYTES) {
        attachments[index] = {
          bytes: Buffer.concat(chunks, fileBytes),
          mimeType: info.mimeType,
          fileName: info.filename,
        };
      }
    });
  });
  parser.on("filesLimit", () => {
    parseError ??= new FeedbackHttpError(413, `Feedback supports at most ${MAX_FEEDBACK_ATTACHMENTS} images.`);
  });
  parser.on("fieldsLimit", () => {
    parseError ??= new FeedbackHttpError(400, "Feedback contains too many metadata fields.");
  });
  parser.on("partsLimit", () => {
    parseError ??= new FeedbackHttpError(413, "Feedback contains too many multipart sections.");
  });

  const parserFinished = once(parser, "finish");
  try {
    for await (const rawChunk of Readable.fromWeb(request.body as never)) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as Uint8Array);
      bodyBytes += chunk.length;
      if (bodyBytes > MAX_MULTIPART_BODY_BYTES) throw new FeedbackHttpError(413, "Feedback upload is too large.");
      if (!parser.write(chunk)) await once(parser, "drain");
    }
    parser.end();
    await parserFinished;
  } catch (error) {
    parser.destroy();
    if (error instanceof FeedbackHttpError) throw error;
    throw new FeedbackHttpError(400, "Feedback multipart body is invalid.");
  }

  if (parseError) throw parseError;
  if (metadataText === null) throw new FeedbackHttpError(400, "Feedback metadata is required.");
  if (attachments.some((entry) => !entry)) throw new FeedbackHttpError(400, "Feedback image upload was incomplete.");

  let metadata: unknown;
  try {
    metadata = JSON.parse(metadataText);
  } catch {
    throw new FeedbackHttpError(400, "Feedback metadata must be valid JSON.");
  }
  return { metadata, attachments: attachments as FeedbackAttachmentInput[] };
}

export async function handleFeedbackPost(request: Request, actor: WorkbenchActor, service: FeedbackService) {
  try {
    const rateLimit = checkRateLimit({ scope: "feedback.submit", key: actor.userId, limit: 5, windowMs: 60_000 });
    if (!rateLimit.allowed) {
      return errorJson(
        429,
        "feedback_rate_limited",
        "提交得有些频繁，请稍后再试，已填写的内容和图片不会丢失。",
        { "retry-after": String(rateLimit.retryAfterSeconds) },
      );
    }
    const input = await parseFeedbackMultipart(request);
    const result = await service.submit(actor, input);
    if (result.status !== "submitted") {
      return errorJson(409, "feedback_processing", "这次反馈仍在处理中，请稍后使用同一提交重试。");
    }
    return Response.json(
      result,
      { status: result.status === "submitted" ? 201 : 202 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleFeedbackAdminList(request: Request, actor: WorkbenchActor, service: FeedbackService) {
  try {
    const input = parseAdminQuery(request);
    const page = await service.list(actor, input);
    return Response.json({
      items: page.items.map((record) => toSafeFeedbackRecord(record, false)),
      total: page.total ?? 0,
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleFeedbackAdminDetail(actor: WorkbenchActor, service: FeedbackService, feedbackId: string) {
  try {
    const record = await service.get(actor, feedbackId);
    if (!record) return errorJson(404, "feedback_not_found", "没有找到这条反馈。");
    return Response.json({ feedback: toSafeFeedbackRecord(record, true) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleFeedbackAdminAttachment(
  actor: WorkbenchActor,
  service: FeedbackService,
  feedbackId: string,
  attachmentId: string,
) {
  try {
    const attachment = await service.downloadAttachment(actor, feedbackId, attachmentId);
    const extension = attachment.mimeType === "image/jpeg" ? "jpg" : attachment.mimeType.split("/")[1];
    return new Response(attachment.bytes, {
      headers: {
        "content-type": attachment.mimeType,
        "content-length": String(attachment.bytes.length),
        "content-disposition": `attachment; filename="feedback-image.${extension}"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleFeedbackAdminExport(request: Request, actor: WorkbenchActor, service: FeedbackService) {
  try {
    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "csv";
    if (format !== "csv" && format !== "json") throw new FeedbackHttpError(400, "Unsupported feedback export format.");
    service.assertAdmin(actor);
    const query = parseAdminQuery(request);
    const stream = createFeedbackExportStream(service, actor, {
      category: query.category,
      severity: query.severity,
      format,
    });
    return new Response(stream, {
      headers: {
        "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
        "content-disposition": `attachment; filename=feedback-export.${format}`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function parseAdminQuery(request: Request): { category?: FeedbackCategory; severity?: FeedbackSeverity; limit: number; cursor?: string } {
  const url = new URL(request.url);
  const category = url.searchParams.get("category") ?? undefined;
  const severity = url.searchParams.get("severity") ?? undefined;
  if (category && !categoryIds.has(category)) throw new FeedbackHttpError(400, "Invalid feedback category filter.");
  if (severity && !severityIds.has(severity)) throw new FeedbackHttpError(400, "Invalid feedback severity filter.");
  const rawLimit = url.searchParams.get("limit") ?? "50";
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new FeedbackHttpError(400, "Invalid feedback list limit.");
  const cursor = url.searchParams.get("cursor")?.trim() || undefined;
  if (cursor && cursor.length > 1_024) throw new FeedbackHttpError(400, "Invalid feedback cursor.");
  return { category: category as FeedbackCategory | undefined, severity: severity as FeedbackSeverity | undefined, limit, cursor };
}

function toSafeFeedbackRecord(record: FeedbackRecordEntity, includeDownloadUrls: boolean) {
  return {
    id: record.id,
    receiptCode: record.receipt,
    category: record.category,
    description: record.description,
    severity: record.severity,
    status: record.status,
    projectId: record.projectId,
    messageId: record.messageId,
    pageRoute: record.pageRoute,
    appVersion: record.appVersion,
    createdAt: record.createdAt.toISOString(),
    submittedAt: record.submittedAt?.toISOString() ?? null,
    attachments: record.attachments.map((attachment) => ({
      id: attachment.id,
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize,
      width: attachment.width,
      height: attachment.height,
      createdAt: attachment.createdAt.toISOString(),
      ...(includeDownloadUrls ? {
        downloadUrl: `/api/admin/feedback/${encodeURIComponent(record.id)}/attachments/${encodeURIComponent(attachment.id)}`,
      } : {}),
    })),
  };
}

function createFeedbackExportStream(
  service: FeedbackService,
  actor: WorkbenchActor,
  input: { category?: FeedbackCategory; severity?: FeedbackSeverity; format: "csv" | "json" },
) {
  const encoder = new TextEncoder();
  let cursor: string | undefined;
  let firstPage = true;
  let done = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (done) return;
      try {
        const page = await service.list(actor, {
          category: input.category,
          severity: input.severity,
          limit: 100,
          cursor,
          includeTotal: false,
        });
        const rows = page.items.map(toExportRow);
        const nextCursor = page.nextCursor ?? undefined;
        const chunk = input.format === "csv"
          ? serializeFeedbackCsv(rows, { header: firstPage })
          : `${firstPage ? '{"items":[' : rows.length > 0 ? "," : ""}${rows.map((row) => JSON.stringify(row)).join(",")}${nextCursor ? "" : "]}"}`;
        if (chunk) controller.enqueue(encoder.encode(chunk));
        firstPage = false;
        cursor = nextCursor;
        if (!cursor) {
          done = true;
          controller.close();
        }
      } catch (error) {
        done = true;
        controller.error(error);
      }
    },
  }, { highWaterMark: 0 });
}

function toExportRow(record: FeedbackRecordEntity): FeedbackExportRow {
  return {
    receipt: record.receipt,
    category: record.category,
    severity: record.severity,
    status: record.status,
    description: record.description,
    pageRoute: record.pageRoute,
    appVersion: record.appVersion,
    attachmentCount: record.attachments.length,
    createdAt: record.createdAt.toISOString(),
  };
}

function errorResponse(error: unknown) {
  if (error instanceof FeedbackHttpError) {
    return errorJson(error.status, "feedback_invalid_request", safeMultipartMessage(error));
  }
  if (error instanceof FeedbackConflictError) {
    return errorJson(409, "feedback_idempotency_conflict", "这次反馈与之前使用同一提交标识的内容不同，请刷新后重试。");
  }
  const message = error instanceof Error ? error.message : "Feedback request failed.";
  if (/password authentication|admin access/i.test(message)) return errorJson(403, "feedback_forbidden", "你没有权限查看这些反馈。");
  if (/not found/i.test(message)) return errorJson(404, "feedback_not_found", "没有找到这条反馈。");
  if (/access denied|do not match/i.test(message)) return errorJson(403, "feedback_context_forbidden", "当前项目或消息无法用于这次反馈。");
  if (isSafeFeedbackValidationMessage(message)) return errorJson(400, "feedback_validation_failed", message);
  return errorJson(400, "feedback_invalid", "反馈暂时没有提交成功，请检查填写内容后重试。");
}

function errorJson(status: number, error: string, message: string, headers?: HeadersInit) {
  return Response.json({ error, message }, { status, headers });
}

function safeMultipartMessage(error: FeedbackHttpError) {
  if (error.message === "Feedback upload is too large.") return "全部图片合计不能超过 25 MiB。";
  if (/10 MiB|25 MiB|at most 5|too large/i.test(error.message)) {
    return error.message
      .replace("Feedback supports at most 5 images.", "最多只能上传 5 张图片。")
      .replace("A feedback image exceeds the 10 MiB limit.", "单张图片不能超过 10 MiB。")
      .replace("Feedback images exceed the 25 MiB total limit.", "全部图片合计不能超过 25 MiB。");
  }
  return "反馈内容格式不正确，请检查后重试。";
}

function isSafeFeedbackValidationMessage(message: string) {
  return /图片|PNG|JPEG|WebP|8192|40,000,000|10 MiB|25 MiB|最多只能上传 5/.test(message);
}

function parseContentLength(value: string | null) {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) throw new FeedbackHttpError(400, "Invalid Content-Length header.");
  return Number(value);
}
