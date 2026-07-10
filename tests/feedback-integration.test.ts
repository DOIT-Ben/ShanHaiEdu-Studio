import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { submitFeedback } from "@/lib/feedback-api";
import { handleFeedbackPost } from "@/server/feedback/http";
import { createFeedbackService } from "@/server/feedback/service";
import { FeedbackStorage } from "@/server/feedback/storage";
import {
  createFeedbackImage,
  createFeedbackMetadata,
  createMemoryFeedbackRepository,
  teacherActor,
} from "./support/feedback-fixtures";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("submitFeedback client to route contract", () => {
  it("submits images without a manual multipart content-type and accepts the unified receipt", async () => {
    const root = path.join(process.cwd(), ".tmp", `feedback-integration-${randomUUID()}`);
    roots.push(root);
    const service = createFeedbackService({
      repository: createMemoryFeedbackRepository(),
      storage: new FeedbackStorage(root),
      appVersion: "integration-version",
    });
    const image = await createFeedbackImage("png");
    let capturedRequest: Request | undefined;

    const result = await submitFeedback({
      metadata: createFeedbackMetadata({ projectId: undefined, messageId: undefined }),
      images: [new File([Uint8Array.from(image)], "screen.png", { type: "image/png" })],
    }, {
      fetcher: async (input, init) => {
        capturedRequest = new Request(new URL(String(input), "http://localhost"), init);
        return handleFeedbackPost(capturedRequest, teacherActor, service);
      },
    });

    expect(capturedRequest?.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    expect((capturedRequest as Request).headers.has("Content-Type")).toBe(true);
    expect(result).toEqual({
      feedbackId: expect.any(String),
      receiptCode: expect.stringMatching(/^FB-/),
      status: "submitted",
      reused: false,
    });
  });
});
