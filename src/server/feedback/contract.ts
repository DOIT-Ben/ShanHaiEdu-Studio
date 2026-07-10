import {
  feedbackCategoryOptions,
  feedbackSeverityOptions,
  type FeedbackCategory,
  type FeedbackClientContext,
  type FeedbackMetadata,
  type FeedbackOrigin,
  type FeedbackSeverity,
} from "@/lib/feedback-contracts";

export const FEEDBACK_CATEGORIES = feedbackCategoryOptions;
export const FEEDBACK_SEVERITIES = feedbackSeverityOptions;
export const FEEDBACK_ORIGINS = ["global", "profile", "message_helpful", "message_unhelpful"] as const satisfies readonly FeedbackOrigin[];
export type { FeedbackCategory, FeedbackClientContext, FeedbackMetadata, FeedbackOrigin, FeedbackSeverity };
export type ParsedFeedbackMetadata = Omit<FeedbackMetadata, "clientContext"> & {
  clientContext: Partial<FeedbackClientContext>;
};

const categoryIds = new Set<string>(FEEDBACK_CATEGORIES.map((category) => category.id));
const severityIds = new Set<string>(FEEDBACK_SEVERITIES.map((severity) => severity.id));
const originIds = new Set<string>(FEEDBACK_ORIGINS);
const metadataKeys = new Set([
  "category",
  "description",
  "severity",
  "idempotencyKey",
  "origin",
  "pageRoute",
  "projectId",
  "messageId",
  "clientContext",
]);

export function appendFeedbackHint(draft: string, hint: string) {
  if (draft.includes(hint)) return draft;
  if (!draft) return hint;
  return `${draft}${draft.endsWith("\n") ? "" : "\n"}${hint}`;
}

export function parseFeedbackMetadata(value: unknown): ParsedFeedbackMetadata {
  const input = requireObject(value, "metadata");
  rejectUnknownKeys(input, metadataKeys);

  const category = requireString(input.category, "category", 64) as FeedbackCategory;
  if (!categoryIds.has(category)) throw new Error("Invalid category");

  const description = normalizeMultiline(requireString(input.description, "description", 5_000));
  if (!description) throw new Error("Invalid description");

  const severity = optionalString(input.severity, "severity", 32) as FeedbackSeverity | undefined;
  if (severity && !severityIds.has(severity)) throw new Error("Invalid severity");

  const idempotencyKey = requireString(input.idempotencyKey, "idempotencyKey", 128).trim();
  if (!idempotencyKey) throw new Error("Invalid idempotencyKey");

  const origin = requireString(input.origin, "origin", 32) as FeedbackOrigin;
  if (!originIds.has(origin)) throw new Error("Invalid origin");

  const pageRoute = requireString(input.pageRoute, "pageRoute", 2_048).trim();
  if (!pageRoute.startsWith("/") || pageRoute.startsWith("//")) throw new Error("Invalid pageRoute");

  const projectId = optionalTrimmedId(input.projectId, "projectId");
  const messageId = optionalTrimmedId(input.messageId, "messageId");
  const clientContext = parseClientContext(input.clientContext);

  return {
    category,
    description,
    ...(severity ? { severity } : {}),
    idempotencyKey,
    origin,
    pageRoute,
    ...(projectId ? { projectId } : {}),
    ...(messageId ? { messageId } : {}),
    clientContext,
  };
}

function parseClientContext(value: unknown): Partial<FeedbackClientContext> {
  const input = requireObject(value, "clientContext");
  rejectUnknownKeys(input, new Set(["userAgent", "language", "viewport"]));
  const userAgent = optionalString(input.userAgent, "userAgent", 512)?.trim();
  const language = optionalString(input.language, "language", 64)?.trim();

  let viewport: FeedbackClientContext["viewport"] | undefined;
  if (input.viewport !== undefined) {
    const viewportInput = requireObject(input.viewport, "viewport");
    rejectUnknownKeys(viewportInput, new Set(["width", "height"]));
    viewport = {
      width: requireInteger(viewportInput.width, "width", 1, 100_000),
      height: requireInteger(viewportInput.height, "height", 1, 100_000),
    };
  }

  return {
    ...(userAgent ? { userAgent } : {}),
    ...(language ? { language } : {}),
    ...(viewport ? { viewport } : {}),
  };
}

function rejectUnknownKeys(input: Record<string, unknown>, allowed: Set<string>) {
  const unknownKey = Object.keys(input).find((key) => !allowed.has(key));
  if (unknownKey) throw new Error(`Unknown metadata field: ${unknownKey}`);
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${field}`);
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) throw new Error(`Invalid ${field}`);
  return value;
}

function optionalString(value: unknown, field: string, maxLength: number) {
  if (value === undefined || value === null || value === "") return undefined;
  return requireString(value, field, maxLength);
}

function optionalTrimmedId(value: unknown, field: string) {
  const result = optionalString(value, field, 128)?.trim();
  if (value !== undefined && !result) throw new Error(`Invalid ${field}`);
  return result;
}

function requireInteger(value: unknown, field: string, min: number, max: number) {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`Invalid ${field}`);
  return value as number;
}

function normalizeMultiline(value: string) {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}
