import { randomUUID } from "node:crypto";
import { rm, utimes } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/server/auth/rate-limit";

import {
  FeedbackConflictError,
  createFeedbackRequestFingerprint,
  createFeedbackService,
} from "@/server/feedback/service";
import { serializeFeedbackCsv } from "@/server/feedback/export";
import {
  handleFeedbackAdminAttachment,
  handleFeedbackAdminExport,
  handleFeedbackAdminDetail,
  handleFeedbackAdminList,
  handleFeedbackPost,
  parseFeedbackMultipart,
} from "@/server/feedback/http";
import { FeedbackStorage } from "@/server/feedback/storage";
import { createPrismaFeedbackRepository, whitelistFeedbackAuditMetadata } from "@/server/feedback/repository";
import {
  createFeedbackImage,
  createFeedbackMetadata,
  createMemoryFeedbackRepository,
  passwordAdminActor,
  teacherActor,
} from "./support/feedback-fixtures";

const roots: string[] = [];

afterEach(async () => {
  resetRateLimits();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FeedbackService submission", () => {
  it("enforces the feedback audit metadata allowlist at the repository boundary", () => {
    expect(whitelistFeedbackAuditMetadata({
      category: "bug",
      severity: "affected",
      attachmentCount: 1,
      status: "submitted",
      format: "csv",
      count: 10,
      description: "private description",
      originalName: "private-name.png",
      storagePath: "C:\\private\\feedback",
    })).toEqual({
      category: "bug",
      severity: "affected",
      attachmentCount: 1,
      status: "submitted",
      format: "csv",
      count: 10,
    });
  });

  it("requires a non-empty authenticated actor", async () => {
    const repository = createMemoryFeedbackRepository();
    const service = createService(repository);
    const bytes = await createFeedbackImage("png");

    await expect(service.submit({ ...teacherActor, userId: " " }, {
      metadata: createFeedbackMetadata({ projectId: undefined, messageId: undefined }),
      attachments: [{ bytes, mimeType: "image/png", fileName: "screen.png" }],
    })).rejects.toThrow(/actor/i);
    expect(repository.records.size).toBe(0);
  });

  it("enforces project and message authorization as one context", async () => {
    const repository = createMemoryFeedbackRepository();
    repository.seedProject("project-1", teacherActor.userId);
    repository.seedProject("project-2", "teacher-2");
    repository.seedMessage("message-1", "project-1");
    repository.seedMessage("message-2", "project-2");
    const service = createService(repository);

    await expect(service.submit(teacherActor, {
      metadata: createFeedbackMetadata({ projectId: "project-1", messageId: "message-2" }),
      attachments: [],
    })).rejects.toThrow(/match|access/i);
    await expect(service.submit(teacherActor, {
      metadata: createFeedbackMetadata({ projectId: "project-2", messageId: undefined, idempotencyKey: "key-2" }),
      attachments: [],
    })).rejects.toThrow(/access/i);
  });

  it("moves processing to submitted and stores only whitelisted audit metadata", async () => {
    const repository = createMemoryFeedbackRepository();
    repository.seedProject("project-1", teacherActor.userId);
    repository.seedMessage("message-1", "project-1");
    const root = createRoot();
    const storage = new FeedbackStorage(root);
    const service = createFeedbackService({ repository, storage, generateId: sequentialIds(), appVersion: "9.9.9-test" });
    const bytes = await createFeedbackImage("png");

    const result = await service.submit(teacherActor, {
      metadata: createFeedbackMetadata(),
      attachments: [{ bytes, mimeType: "image/png", fileName: "private-name.png" }],
    });

    expect(result).toEqual({
      feedbackId: expect.any(String),
      receiptCode: expect.stringMatching(/^FB-/),
      status: "submitted",
      reused: false,
    });
    const record = [...repository.records.values()][0];
    expect(record.status).toBe("submitted");
    expect(record.createdByUserId).toBe(teacherActor.userId);
    expect(record.origin).toBe("global");
    expect(record.appVersion).toBe("9.9.9-test");
    expect(record.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(record.attachments[0].kind).toBe("issue");
    expect(repository.auditLogs).toEqual([{
      action: "feedback.submitted",
      metadata: { category: "bug", severity: "affected", attachmentCount: 1, status: "submitted" },
    }]);
    expect(JSON.stringify(repository.auditLogs)).not.toContain("private-name");
    expect(JSON.stringify(repository.auditLogs)).not.toContain("按钮没有反应");
    expect(JSON.stringify(repository.auditLogs)).not.toContain(root);
  });

  it("fingerprints normalized fields and ordered attachment hash, mime and bytes", async () => {
    const png = await createFeedbackImage("png");
    const webp = await createFeedbackImage("webp");
    const metadata = createFeedbackMetadata({ description: "line one\r\nline two" });
    const first = await createFeedbackRequestFingerprint(metadata, [
      { bytes: png, mimeType: "image/png", fileName: "a.png" },
      { bytes: webp, mimeType: "image/webp", fileName: "b.webp" },
    ]);
    const normalized = await createFeedbackRequestFingerprint(
      { ...metadata, description: "  line one\nline two  " },
      [
        { bytes: png, mimeType: "image/png", fileName: "renamed.png" },
        { bytes: webp, mimeType: "image/webp", fileName: "renamed.webp" },
      ],
    );
    const reordered = await createFeedbackRequestFingerprint(metadata, [
      { bytes: webp, mimeType: "image/webp", fileName: "b.webp" },
      { bytes: png, mimeType: "image/png", fileName: "a.png" },
    ]);

    expect(normalized).toBe(first);
    expect(reordered).not.toBe(first);
    const reclassified = await createFeedbackRequestFingerprint(metadata, [
      { bytes: png, mimeType: "image/png", fileName: "a.png", kind: "expected" },
      { bytes: webp, mimeType: "image/webp", fileName: "b.webp", kind: "issue" },
    ]);
    expect(reclassified).not.toBe(first);
  });

  it("reuses equal idempotent submissions, rejects changed content, and scopes keys by user", async () => {
    const repository = createMemoryFeedbackRepository();
    const service = createService(repository);
    const input = { metadata: createFeedbackMetadata({ projectId: undefined, messageId: undefined }), attachments: [] };
    const first = await service.submit(teacherActor, input);
    const retry = await service.submit(teacherActor, input);
    expect(retry).toEqual({ ...first, reused: true });
    expect(repository.records.size).toBe(1);

    await expect(service.submit(teacherActor, {
      ...input,
      metadata: { ...input.metadata, description: "changed" },
    })).rejects.toBeInstanceOf(FeedbackConflictError);

    await expect(service.submit({ ...teacherActor, userId: "teacher-2" }, input)).resolves.toMatchObject({ status: "submitted" });
    expect(repository.records.size).toBe(2);
  });

  it("retries a failed equal submission and cleans staging when database creation fails", async () => {
    const repository = createMemoryFeedbackRepository();
    const root = createRoot();
    const storage = new FeedbackStorage(root);
    const service = createFeedbackService({ repository, storage, generateId: sequentialIds() });
    const input = { metadata: createFeedbackMetadata({ projectId: undefined, messageId: undefined }), attachments: [] };
    const first = await service.submit(teacherActor, input);
    const record = [...repository.records.values()][0];
    record.status = "failed";
    await storage.removeFinal(record.id);

    await expect(service.submit(teacherActor, input)).resolves.toEqual({ ...first, reused: true });
    expect(record.status).toBe("submitted");

    const failingRepository = createMemoryFeedbackRepository();
    failingRepository.setFailCreate(true);
    const failingStorage = new FeedbackStorage(createRoot());
    const failingService = createFeedbackService({ repository: failingRepository, storage: failingStorage, generateId: sequentialIds() });
    await expect(failingService.submit(teacherActor, {
      metadata: createFeedbackMetadata({ projectId: undefined, messageId: undefined, idempotencyKey: "db-failure" }),
      attachments: [],
    })).rejects.toThrow(/database/);
    expect(await failingStorage.listStagingKeys()).toEqual([]);
    expect(await failingStorage.listFinalFeedbackIds()).toEqual([]);
  });
});

describe("FeedbackService reconciliation and admin access", () => {
  it("recovers crashes after processing record and after rename, and cleans old orphans", async () => {
    for (const crashPoint of ["afterRecord", "afterCommit"] as const) {
      const repository = createMemoryFeedbackRepository();
      const storage = new FeedbackStorage(createRoot());
      const crashing = createFeedbackService({
        repository,
        storage,
        generateId: sequentialIds(),
        faults: { [crashPoint]: () => { throw new Error(`simulated-crash-${crashPoint}`); } },
      });
      await expect(crashing.submit(teacherActor, {
        metadata: createFeedbackMetadata({ projectId: undefined, messageId: undefined, idempotencyKey: crashPoint }),
        attachments: [],
      })).rejects.toThrow("simulated-crash");

      const record = [...repository.records.values()][0];
      expect(record.status).toBe("processing");
      const reconciler = createFeedbackService({ repository, storage });
      await reconciler.reconcile({ owner: "worker-1", staleAfterMs: 0, leaseMs: 60_000, orphanGraceMs: 0 });
      expect(record.status).toBe("submitted");
      expect(repository.auditLogs.filter((entry) => entry.action === "feedback.submitted")).toHaveLength(1);
    }

    const repository = createMemoryFeedbackRepository();
    const storage = new FeedbackStorage(createRoot());
    await storage.stage("orphan-stage", []);
    await storage.stage("for-final", []);
    await storage.commit("for-final", "orphan-final");
    const old = new Date(Date.now() - 60_000);
    await utimes(path.join(storage.stagingRoot, "orphan-stage"), old, old);
    await utimes(path.join(storage.feedbackRoot, "orphan-final"), old, old);

    await createFeedbackService({ repository, storage }).reconcile({
      owner: "worker-1",
      staleAfterMs: 0,
      leaseMs: 60_000,
      orphanGraceMs: 1_000,
    });
    expect(await storage.listStagingKeys()).toEqual([]);
    expect(await storage.listFinalFeedbackIds()).toEqual([]);
  });

  it("uses a lease/CAS so a second worker cannot claim active reconciliation work", async () => {
    const repository = createMemoryFeedbackRepository();
    const service = createService(repository, { faults: { afterRecord: () => { throw new Error("crash"); } } });
    await expect(service.submit(teacherActor, {
      metadata: createFeedbackMetadata({ projectId: undefined, messageId: undefined }), attachments: [],
    })).rejects.toThrow("crash");
    const now = new Date();
    const first = await repository.claimStaleProcessing({
      owner: "worker-1", now, staleBefore: now, leaseUntil: new Date(now.getTime() + 60_000), limit: 10,
    });
    const second = await repository.claimStaleProcessing({
      owner: "worker-2", now, staleBefore: now, leaseUntil: new Date(now.getTime() + 60_000), limit: 10,
    });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("refreshes failed retries and keeps foreground finalization out of reconciler-owned records", async () => {
    const repository = createMemoryFeedbackRepository();
    const service = createService(repository, { faults: { afterRecord: () => { throw new Error("crash"); } } });
    await expect(service.submit(teacherActor, {
      metadata: createFeedbackMetadata({ projectId: undefined, messageId: undefined }), attachments: [],
    })).rejects.toThrow("crash");
    const record = [...repository.records.values()][0];
    record.status = "failed";
    record.updatedAt = new Date("2026-07-10T09:00:00.000Z");
    const retryAt = new Date("2026-07-10T10:00:00.000Z");

    expect(await repository.retryFailed(record.id, "retry-stage", retryAt)).toBe(true);
    expect(record.updatedAt).toEqual(retryAt);
    expect(await repository.claimStaleProcessing({
      owner: "worker-1",
      now: retryAt,
      staleBefore: new Date(retryAt.getTime() - 1),
      leaseUntil: new Date(retryAt.getTime() + 60_000),
      limit: 10,
    })).toHaveLength(0);

    record.updatedAt = new Date(retryAt.getTime() - 60_000);
    expect(await repository.claimStaleProcessing({
      owner: "worker-1",
      now: retryAt,
      staleBefore: retryAt,
      leaseUntil: new Date(retryAt.getTime() + 60_000),
      limit: 10,
    })).toHaveLength(1);
    expect(await repository.markFailed(record.id, "foreground-failure")).toBe(false);
    expect(await repository.finalizeSubmitted({
      id: record.id,
      actorUserId: record.createdByUserId,
      projectId: record.projectId,
      metadata: {},
    })).toBe(false);
    expect(record.status).toBe("processing");
  });

  it("keeps an existing final directory recoverable when transactional finalization fails", async () => {
    const repository = createMemoryFeedbackRepository();
    const storage = new FeedbackStorage(createRoot());
    let currentTime = new Date("2026-07-10T10:00:00.000Z");
    const crashing = createFeedbackService({
      repository,
      storage,
      now: () => currentTime,
      faults: { afterCommit: () => { throw new Error("crash-after-commit"); } },
    });
    await expect(crashing.submit(teacherActor, {
      metadata: createFeedbackMetadata({ projectId: undefined, messageId: undefined }),
      attachments: [],
    })).rejects.toThrow("crash-after-commit");
    const record = [...repository.records.values()][0];

    repository.setFailFinalize(true);
    const reconciler = createFeedbackService({ repository, storage, now: () => currentTime });
    const failedRecovery = await reconciler.reconcile({ owner: "worker-1", staleAfterMs: 0, leaseMs: 1_000, orphanGraceMs: 0 });
    expect(failedRecovery).toEqual({ claimed: 1, cleanupFailures: 0, recoveryFailures: 1 });
    expect(record.status).toBe("processing");
    expect(await storage.hasFinal(record.id)).toBe(true);
    expect(repository.auditLogs).toHaveLength(0);

    repository.setFailFinalize(false);
    currentTime = new Date(currentTime.getTime() + 1_001);
    const recovered = await reconciler.reconcile({ owner: "worker-2", staleAfterMs: 0, leaseMs: 1_000, orphanGraceMs: 0 });
    expect(recovered).toEqual({ claimed: 1, cleanupFailures: 0, recoveryFailures: 0 });
    expect(record.status).toBe("submitted");
    expect(repository.auditLogs.filter((entry) => entry.action === "feedback.submitted")).toHaveLength(1);
  });

  it("reports orphan cleanup failures instead of returning a false successful reconciliation", async () => {
    const repository = createMemoryFeedbackRepository();
    const storage = new FeedbackStorage(createRoot());
    await storage.stage("orphan-stage", []);
    const old = new Date(Date.now() - 60_000);
    await utimes(path.join(storage.stagingRoot, "orphan-stage"), old, old);
    vi.spyOn(storage, "removeStaging").mockRejectedValueOnce(new Error("disk cleanup failed"));

    const result = await createFeedbackService({ repository, storage }).reconcile({
      owner: "worker-cleanup",
      staleAfterMs: 0,
      leaseMs: 60_000,
      orphanGraceMs: 1_000,
    });

    expect(result).toEqual({ claimed: 0, cleanupFailures: 1, recoveryFailures: 0 });
  });

  it("requires password admin for reads and downloads attachments only by database ID", async () => {
    const repository = createMemoryFeedbackRepository();
    const storage = new FeedbackStorage(createRoot());
    const service = createFeedbackService({ repository, storage, generateId: sequentialIds() });
    const bytes = await createFeedbackImage("png");
    await service.submit(teacherActor, {
      metadata: createFeedbackMetadata({ projectId: undefined, messageId: undefined }),
      attachments: [{ bytes, mimeType: "image/png", fileName: "screen.png" }],
    });
    const record = [...repository.records.values()][0];
    const attachment = record.attachments[0];

    await expect(service.list(teacherActor, { limit: 20 })).rejects.toThrow(/admin/i);
    await expect(service.list({ ...passwordAdminActor, authMode: "local" }, { limit: 20 })).rejects.toThrow(/password/i);
    await expect(service.list(passwordAdminActor, { limit: 20 })).resolves.toMatchObject({ total: 1, nextCursor: null });
    await expect(service.downloadAttachment(passwordAdminActor, record.id, "../screen.png")).rejects.toThrow(/not found/i);
    await expect(service.downloadAttachment(passwordAdminActor, record.id, attachment.id)).resolves.toMatchObject({
      bytes,
      mimeType: "image/png",
    });
  });

  it("writes RFC4180 CSV and neutralizes formula prefixes without changing ordinary text", () => {
    const csv = serializeFeedbackCsv([{
      receipt: "FB-1",
      category: "bug",
      severity: "affected",
      status: "submitted",
      description: "=HYPERLINK(\"https://bad\")\r\nsecond line\n  @SUM(1,1)",
      pageRoute: "/workbench,detail",
      appVersion: "0.1.0",
      attachmentCount: 1,
      createdAt: "2026-07-10T00:00:00.000Z",
    }, {
      receipt: "FB-2",
      category: "other",
      severity: "normal",
      status: "submitted",
      description: "ordinary text",
      pageRoute: "/",
      appVersion: "0.1.0",
      attachmentCount: 0,
      createdAt: "2026-07-10T00:01:00.000Z",
    }]);

    expect(csv).toContain('"\'=HYPERLINK(""https://bad"")\r\nsecond line\n\'  @SUM(1,1)"');
    expect(csv).not.toContain("\nsecond line\n'  @SUM(1,1),");
    expect(csv).toContain('"/workbench,detail"');
    expect(csv).toContain("ordinary text");
    expect(csv.split("\r\n")).toHaveLength(5);
  });
});

describe("feedback HTTP handlers", () => {
  it("streams multipart metadata and ordered image fields through busboy", async () => {
    const png = await createFeedbackImage("png");
    const webp = await createFeedbackImage("webp");
    const request = multipartRequest(createFeedbackMetadata({ projectId: undefined, messageId: undefined }), [
      { bytes: png, mimeType: "image/png", fileName: "one.png", field: "issueImages" },
      { bytes: webp, mimeType: "image/webp", fileName: "two.webp", field: "expectedImages" },
    ]);

    const parsed = await parseFeedbackMultipart(request);
    expect(parsed.metadata).toMatchObject({ category: "bug", idempotencyKey: "feedback-key-1" });
    expect(parsed.attachments.map((attachment) => attachment.fileName)).toEqual(["one.png", "two.webp"]);
    expect(parsed.attachments.map((attachment) => attachment.bytes)).toEqual([png, webp]);
    expect(parsed.attachments.map((attachment) => attachment.kind)).toEqual(["issue", "expected"]);
  });

  it("rejects non-multipart and oversized requests before parsing the body", async () => {
    await expect(parseFeedbackMultipart(new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }))).rejects.toThrow(/multipart/i);

    await expect(parseFeedbackMultipart(new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(26 * 1024 * 1024),
      },
      body: "--x--\r\n",
    }))).rejects.toMatchObject({ status: 413 });
  });

  it("rejects multipart file fields outside the classified and legacy allowlist", async () => {
    const png = await createFeedbackImage("png");
    const form = new FormData();
    form.append("metadata", JSON.stringify(createFeedbackMetadata({ projectId: undefined, messageId: undefined })));
    form.append("otherImages", new Blob([Uint8Array.from(png)], { type: "image/png" }), "other.png");
    await expect(parseFeedbackMultipart(new Request("http://localhost/api/feedback", { method: "POST", body: form })))
      .rejects.toMatchObject({ status: 400 });
  });

  it("returns only receipt and safe status from POST and maps idempotency conflicts to 409", async () => {
    const repository = createMemoryFeedbackRepository();
    const service = createService(repository);
    const metadata = createFeedbackMetadata({ projectId: undefined, messageId: undefined });
    const first = await handleFeedbackPost(multipartRequest(metadata, []), teacherActor, service);
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({
      feedbackId: expect.any(String),
      receiptCode: expect.stringMatching(/^FB-/),
      status: "submitted",
      reused: false,
    });

    const conflict = await handleFeedbackPost(multipartRequest({ ...metadata, description: "changed" }, []), teacherActor, service);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: "feedback_idempotency_conflict",
      message: "这次反馈与之前使用同一提交标识的内容不同，请刷新后重试。",
    });
  });

  it("does not report an in-flight idempotent record as a successful submission", async () => {
    const repository = createMemoryFeedbackRepository();
    const service = createService(repository, {
      faults: { afterRecord: () => { throw new Error("simulated crash"); } },
    });
    const metadata = createFeedbackMetadata({ projectId: undefined, messageId: undefined });
    await expect(service.submit(teacherActor, { metadata, attachments: [] })).rejects.toThrow("simulated crash");

    const response = await handleFeedbackPost(multipartRequest(metadata, []), teacherActor, service);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "feedback_processing",
      message: "这次反馈仍在处理中，请稍后使用同一提交重试。",
    });
  });

  it("returns a concrete Chinese size error for an oversized multipart request", async () => {
    const request = new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(26 * 1024 * 1024),
      },
      body: "--x--\r\n",
    });
    const response = await handleFeedbackPost(request, { ...teacherActor, userId: "oversize-teacher" }, createService());
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: "feedback_invalid_request",
      message: "全部图片合计不能超过 25 MiB。",
    });
  });

  it("rate limits by actor before parsing an invalid multipart body", async () => {
    const service = createService(createMemoryFeedbackRepository());
    const invalidRequest = () => new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not multipart",
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await handleFeedbackPost(multipartRequest(createFeedbackMetadata({
        projectId: undefined,
        messageId: undefined,
        idempotencyKey: `rate-${attempt}`,
      }), []), teacherActor, service);
    }

    const denied = await handleFeedbackPost(invalidRequest(), teacherActor, service);
    expect(denied.status).toBe(429);
    expect(await denied.json()).toEqual({
      error: "feedback_rate_limited",
      message: "提交得有些频繁，请稍后再试，已填写的内容和图片不会丢失。",
    });
  });

  it("enforces password admin and emits safe list, attachment, CSV and JSON responses", async () => {
    const repository = createMemoryFeedbackRepository();
    const service = createService(repository);
    const png = await createFeedbackImage("png");
    await service.submit(teacherActor, {
      metadata: createFeedbackMetadata({
        projectId: undefined,
        messageId: undefined,
        description: "=DANGEROUS(), ordinary detail",
      }),
      attachments: [{ bytes: png, mimeType: "image/png", fileName: "private-name.png", kind: "expected" }],
    });
    const record = [...repository.records.values()][0];
    const attachment = record.attachments[0];

    const denied = await handleFeedbackAdminList(new Request("http://localhost/api/admin/feedback"), teacherActor, service);
    expect(denied.status).toBe(403);
    const deniedExport = await handleFeedbackAdminExport(
      new Request("http://localhost/api/admin/feedback/export?format=csv"),
      teacherActor,
      service,
    );
    expect(deniedExport.status).toBe(403);

    const list = await handleFeedbackAdminList(new Request("http://localhost/api/admin/feedback?category=bug&limit=20"), passwordAdminActor, service);
    const listBody = await list.json() as { items: Array<Record<string, unknown>>; total: number; nextCursor: string | null };
    expect(list.status).toBe(200);
    expect(listBody).toMatchObject({ total: 1, nextCursor: null });
    expect(listBody.items[0].receiptCode).toBe(record.receipt);
    expect(listBody.items[0]).not.toHaveProperty("storageKey");
    expect(listBody.items[0]).not.toHaveProperty("createdByUserId");
    expect(JSON.stringify(listBody)).not.toContain("private-name");

    const detail = await handleFeedbackAdminDetail(passwordAdminActor, service, record.id);
    const detailBody = await detail.json() as { feedback: { receiptCode: string; attachments: Array<{ downloadUrl: string; kind: string }> } };
    expect(detailBody.feedback.receiptCode).toBe(record.receipt);
    expect(detailBody.feedback.attachments[0].downloadUrl).toBe(
      `/api/admin/feedback/${record.id}/attachments/${attachment.id}`,
    );
    expect(detailBody.feedback.attachments[0].kind).toBe("expected");

    const missingDetail = await handleFeedbackAdminDetail(passwordAdminActor, service, "missing-feedback");
    expect(missingDetail.status).toBe(404);
    expect(await missingDetail.json()).toEqual({
      error: "feedback_not_found",
      message: "没有找到这条反馈。",
    });

    const attachmentResponse = await handleFeedbackAdminAttachment(passwordAdminActor, service, record.id, attachment.id);
    expect(attachmentResponse.status).toBe(200);
    expect(Buffer.from(await attachmentResponse.arrayBuffer())).toEqual(png);
    expect(attachmentResponse.headers.get("content-disposition")).not.toContain("\\");

    const csv = await handleFeedbackAdminExport(new Request("http://localhost/api/admin/feedback/export?format=csv"), passwordAdminActor, service);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("'=DANGEROUS()");

    const json = await handleFeedbackAdminExport(new Request("http://localhost/api/admin/feedback/export?format=json"), passwordAdminActor, service);
    const jsonText = await json.text();
    expect(json.headers.get("content-type")).toContain("application/json");
    expect(jsonText).not.toContain("storageKey");
    expect(jsonText).not.toContain("createdByUserId");
    expect(jsonText).not.toContain("private-name");
  });

  it("paginates lists with total and exports every cursor page beyond 200 records", async () => {
    const repository = createMemoryFeedbackRepository();
    const service = createService(repository);
    await service.submit(teacherActor, {
      metadata: createFeedbackMetadata({ projectId: undefined, messageId: undefined }),
      attachments: [],
    });
    const template = [...repository.records.values()][0];
    for (let index = 1; index < 205; index += 1) {
      const id = `bulk-${String(index).padStart(3, "0")}`;
      repository.records.set(id, {
        ...template,
        id,
        receipt: `FB-BULK-${String(index).padStart(3, "0")}`,
        idempotencyKey: `bulk-key-${index}`,
        description: index === 104 ? "=1+1 formula on a later export page" : `bulk description ${index}`,
        createdAt: new Date(template.createdAt.getTime() - index),
        updatedAt: new Date(template.updatedAt.getTime() - index),
        attachments: [],
      });
    }

    const firstPage = await service.list(passwordAdminActor, { limit: 100 });
    expect(firstPage.items).toHaveLength(100);
    expect(firstPage.total).toBe(205);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const secondPage = await service.list(passwordAdminActor, { limit: 100, cursor: firstPage.nextCursor! });
    expect(secondPage.items).toHaveLength(100);
    expect(secondPage.nextCursor).toEqual(expect.any(String));

    const json = await handleFeedbackAdminExport(
      new Request("http://localhost/api/admin/feedback/export?format=json"),
      passwordAdminActor,
      service,
    );
    const exported = await json.json() as { items: Array<{ receipt: string }> };
    expect(exported.items).toHaveLength(205);
    expect(exported.items.some((item) => item.receipt === "FB-BULK-204")).toBe(true);

    const csv = await handleFeedbackAdminExport(
      new Request("http://localhost/api/admin/feedback/export?format=csv"),
      passwordAdminActor,
      service,
    );
    const csvText = await csv.text();
    expect(csvText).toContain("FB-BULK-204");
    expect(csvText).toContain("'=1+1 formula on a later export page");
    expect(csvText).not.toMatch(/(?:^|,)=[^,\r\n]*/m);
  });

  it("exports one page per pull without requesting repeated totals", async () => {
    const repository = createMemoryFeedbackRepository();
    const service = createService(repository);
    await service.submit(teacherActor, {
      metadata: createFeedbackMetadata({ projectId: undefined, messageId: undefined }),
      attachments: [],
    });
    const template = [...repository.records.values()][0];
    for (let index = 1; index < 150; index += 1) {
      repository.records.set(`stream-${index}`, {
        ...template,
        id: `stream-${index}`,
        receipt: `FB-STREAM-${index}`,
        idempotencyKey: `stream-key-${index}`,
        createdAt: new Date(template.createdAt.getTime() - index),
        updatedAt: new Date(template.updatedAt.getTime() - index),
        attachments: [],
      });
    }
    const listInputs: Array<Record<string, unknown>> = [];
    const originalList = repository.list.bind(repository);
    repository.list = async (input) => {
      listInputs.push(input);
      return originalList(input);
    };

    const response = await handleFeedbackAdminExport(
      new Request("http://localhost/api/admin/feedback/export?format=json"),
      passwordAdminActor,
      service,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listInputs).toHaveLength(0);

    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(listInputs).toHaveLength(1);
    expect(listInputs[0]).toMatchObject({ includeTotal: false, limit: 100 });
    await reader.cancel();
  });

  it("skips the Prisma count query when totals are not requested", async () => {
    const count = vi.fn();
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = createPrismaFeedbackRepository({
      feedbackRecord: { count, findMany },
      $transaction: vi.fn(),
    } as never);

    await repository.list({ limit: 100, includeTotal: false });

    expect(count).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledOnce();
  });
});

function createRoot() {
  const root = path.join(process.cwd(), ".tmp", `feedback-service-${randomUUID()}`);
  roots.push(root);
  return root;
}

function createService(repository = createMemoryFeedbackRepository(), overrides: Record<string, unknown> = {}) {
  return createFeedbackService({
    repository,
    storage: new FeedbackStorage(createRoot()),
    generateId: sequentialIds(),
    ...overrides,
  });
}

function sequentialIds() {
  let index = 0;
  return () => `generated-${++index}`;
}

function multipartRequest(
  metadata: ReturnType<typeof createFeedbackMetadata>,
  attachments: Array<{ bytes: Buffer; mimeType: string; fileName: string; field?: "images" | "issueImages" | "expectedImages" }>,
) {
  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  for (const attachment of attachments) {
    form.append(attachment.field ?? "images", new Blob([Uint8Array.from(attachment.bytes)], { type: attachment.mimeType }), attachment.fileName);
  }
  return new Request("http://localhost/api/feedback", { method: "POST", body: form });
}
