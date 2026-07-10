import sharp from "sharp";
import type { WorkbenchActor } from "@/server/auth/actor";
import type {
  FeedbackAttachmentEntity,
  FeedbackRecordEntity,
  FeedbackRepository,
} from "@/server/feedback/repository";
import { decodeFeedbackCursor, encodeFeedbackCursor } from "@/server/feedback/repository";
import type { FeedbackMetadata } from "@/lib/feedback-contracts";

export async function createFeedbackImage(
  format: "png" | "jpeg" | "webp",
  width = 2,
  height = 2,
) {
  const image = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 30, g: 90, b: 160, alpha: 1 },
    },
  });

  if (format === "png") return image.png().toBuffer();
  if (format === "jpeg") return image.jpeg().toBuffer();
  return image.webp().toBuffer();
}

export async function createAnimatedWebp() {
  const twoFrameGif = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00,
    0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
    0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00,
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0x02, 0x02, 0x44, 0x01, 0x00,
    0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00,
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0x02, 0x02, 0x4c, 0x01, 0x00,
    0x3b,
  ]);
  return sharp(twoFrameGif, { animated: true }).webp().toBuffer();
}

export const teacherActor: WorkbenchActor = {
  userId: "teacher-1",
  displayName: "Teacher One",
  role: "teacher",
  authMode: "password",
  isAdmin: false,
  projectRoles: {},
};

export const passwordAdminActor: WorkbenchActor = {
  userId: "admin-1",
  displayName: "Admin One",
  role: "admin",
  authMode: "password",
  isAdmin: true,
  projectRoles: {},
};

export function createFeedbackMetadata(overrides: Partial<FeedbackMetadata> = {}): FeedbackMetadata {
  return {
    category: "bug",
    description: "按钮没有反应",
    severity: "affected",
    idempotencyKey: "feedback-key-1",
    origin: "global",
    pageRoute: "/workbench/project-1",
    projectId: "project-1",
    messageId: "message-1",
    clientContext: { userAgent: "Test Browser", language: "zh-CN", viewport: { width: 1440, height: 900 } },
    ...overrides,
  };
}

export function createMemoryFeedbackRepository() {
  const records = new Map<string, FeedbackRecordEntity>();
  const attachments = new Map<string, FeedbackAttachmentEntity>();
  const projects = new Map<string, { id: string; ownerUserId: string | null; members: Set<string> }>();
  const messages = new Map<string, { id: string; projectId: string }>();
  const auditLogs: Array<{ action: string; metadata: Record<string, unknown> }> = [];
  let failCreate = false;
  let failFinalize = false;

  const repository: FeedbackRepository & {
    records: typeof records;
    attachments: typeof attachments;
    auditLogs: typeof auditLogs;
    seedProject: (id: string, ownerUserId: string, memberIds?: string[]) => void;
    seedMessage: (id: string, projectId: string) => void;
    setFailCreate: (value: boolean) => void;
    setFailFinalize: (value: boolean) => void;
  } = {
    records,
    attachments,
    auditLogs,
    seedProject(id, ownerUserId, memberIds = []) {
      projects.set(id, { id, ownerUserId, members: new Set(memberIds) });
    },
    seedMessage(id, projectId) {
      messages.set(id, { id, projectId });
    },
    setFailCreate(value) {
      failCreate = value;
    },
    setFailFinalize(value) {
      failFinalize = value;
    },
    async findByIdempotency(createdByUserId, idempotencyKey) {
      return [...records.values()].find((record) => (
        record.createdByUserId === createdByUserId && record.idempotencyKey === idempotencyKey
      )) ?? null;
    },
    async authorizeContext(input) {
      const message = input.messageId ? messages.get(input.messageId) : undefined;
      const projectId = input.projectId ?? message?.projectId;
      if (input.messageId && !message) throw new Error("Message not found or access denied.");
      if (input.projectId && message?.projectId !== input.projectId && input.messageId) {
        throw new Error("Message and project do not match.");
      }
      if (!projectId) return { projectId: null, messageId: null };
      const project = projects.get(projectId);
      if (!project) throw new Error("Project not found or access denied.");
      if (!input.actor.isAdmin && project.ownerUserId !== input.actor.userId && !project.members.has(input.actor.userId)) {
        throw new Error("Project not found or access denied.");
      }
      return { projectId, messageId: message?.id ?? null };
    },
    async createProcessing(input) {
      if (failCreate) throw new Error("database write failed");
      if ([...records.values()].some((record) => record.receipt === input.record.receipt)) throw new Error("receipt conflict");
      if ([...records.values()].some((record) => record.stagingKey === input.record.stagingKey)) throw new Error("staging conflict");
      if (await repository.findByIdempotency(input.record.createdByUserId, input.record.idempotencyKey)) throw new Error("idempotency conflict");
      records.set(input.record.id, { ...input.record, attachments: input.attachments.map((item) => ({ ...item })) });
      for (const attachment of input.attachments) attachments.set(attachment.id, { ...attachment });
      return records.get(input.record.id)!;
    },
    async retryFailed(id, stagingKey, processingStartedAt) {
      const record = requireRecord(id);
      if (record.status !== "failed") return false;
      record.status = "processing";
      record.stagingKey = stagingKey;
      record.failureCode = null;
      record.reconciliationOwner = null;
      record.reconciliationLeaseUntil = null;
      record.updatedAt = processingStartedAt;
      return true;
    },
    async finalizeSubmitted(input) {
      if (failFinalize) throw new Error("audit transaction failed");
      const id = input.id;
      const owner = input.reconciliationOwner;
      const record = requireRecord(id);
      if (record.status !== "processing") return false;
      if (owner ? record.reconciliationOwner !== owner : record.reconciliationOwner !== null) return false;
      auditLogs.push({ action: "feedback.submitted", metadata: input.metadata });
      record.status = "submitted";
      record.submittedAt = new Date();
      record.reconciliationOwner = null;
      record.reconciliationLeaseUntil = null;
      return true;
    },
    async markFailed(id, failureCode, owner) {
      const record = requireRecord(id);
      if (owner ? record.reconciliationOwner !== owner : record.reconciliationOwner !== null) return false;
      record.status = "failed";
      record.failureCode = failureCode;
      record.reconciliationOwner = null;
      record.reconciliationLeaseUntil = null;
      return true;
    },
    async claimStaleProcessing(input) {
      const claimed: FeedbackRecordEntity[] = [];
      for (const record of records.values()) {
        if (claimed.length >= input.limit) break;
        if (record.status !== "processing" || record.updatedAt > input.staleBefore) continue;
        if (record.reconciliationLeaseUntil && record.reconciliationLeaseUntil > input.now) continue;
        record.reconciliationOwner = input.owner;
        record.reconciliationLeaseUntil = input.leaseUntil;
        claimed.push(record);
      }
      return claimed;
    },
    async isStagingReferenced(stagingKey) {
      return [...records.values()].some((record) => record.stagingKey === stagingKey && record.status === "processing");
    },
    async isFeedbackReferenced(id) {
      return records.get(id)?.status === "submitted" || records.get(id)?.status === "processing";
    },
    async list(input) {
      const filtered = [...records.values()]
        .filter((record) => !input.category || record.category === input.category)
        .filter((record) => !input.severity || record.severity === input.severity)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
      const cursor = input.cursor ? decodeFeedbackCursor(input.cursor) : null;
      const afterCursor = cursor
        ? filtered.filter((record) => (
            record.createdAt < cursor.createdAt ||
            (record.createdAt.getTime() === cursor.createdAt.getTime() && record.id < cursor.id)
          ))
        : filtered;
      const page = afterCursor.slice(0, input.limit + 1);
      const items = page.slice(0, input.limit);
      return {
        items,
        total: input.includeTotal === false ? null : filtered.length,
        nextCursor: page.length > input.limit && items.length > 0
          ? encodeFeedbackCursor(items[items.length - 1])
          : null,
      };
    },
    async getById(id) {
      return records.get(id) ?? null;
    },
    async findAttachmentById(feedbackId, attachmentId) {
      const attachment = attachments.get(attachmentId);
      return attachment?.feedbackId === feedbackId ? attachment : null;
    },
  };

  function requireRecord(id: string) {
    const record = records.get(id);
    if (!record) throw new Error("Feedback not found.");
    return record;
  }

  return repository;
}
