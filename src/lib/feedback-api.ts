import { getWorkbenchCsrfToken } from "@/lib/csrf-token";
import type { FeedbackMetadata, FeedbackSubmissionResponse } from "@/lib/feedback-contracts";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type SubmitFeedbackInput = {
  metadata: FeedbackMetadata;
  images: File[];
};

type FeedbackApiOptions = {
  fetcher?: Fetcher;
};

const teacherFacingSubmitError = "反馈暂时没有提交成功，内容和图片已为你保留，请稍后重试。";

export class FeedbackApiError extends Error {
  readonly status?: number;
  readonly userMessage: string;

  constructor(status?: number, userMessage = teacherFacingSubmitError) {
    super("Feedback submission failed");
    this.name = "FeedbackApiError";
    this.status = status;
    this.userMessage = userMessage;
  }
}

export async function submitFeedback(input: SubmitFeedbackInput, options: FeedbackApiOptions = {}): Promise<FeedbackSubmissionResponse> {
  const fetcher = options.fetcher ?? fetch;
  const formData = new FormData();
  const { metadata, images } = input;
  formData.append("metadata", JSON.stringify(metadata));
  for (const file of images) formData.append("images", file);

  const csrfToken = getWorkbenchCsrfToken();
  const response = await fetcher("/api/feedback", {
    method: "POST",
    body: formData,
    credentials: "same-origin",
    headers: csrfToken ? { "x-shanhai-csrf": csrfToken } : undefined,
  });

  if (!response.ok) {
    throw new FeedbackApiError(response.status, await readFeedbackErrorMessage(response));
  }

  const result = (await response.json()) as Partial<FeedbackSubmissionResponse>;
  if (!result.feedbackId || !result.receiptCode || result.status !== "submitted") {
    throw new FeedbackApiError(response.status);
  }
  return result as FeedbackSubmissionResponse;
}

async function readFeedbackErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof body.message === "string" && body.message.trim()) return body.message.trim();
  } catch {
    // The generic teacher-facing message is used when the response cannot be parsed.
  }
  return teacherFacingSubmitError;
}
