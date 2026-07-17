import type { WorkbenchActor } from "@/server/auth/actor";
import type { FeedbackAttachment, FeedbackRecord, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import type { FeedbackCategory, FeedbackOrigin, FeedbackSeverity } from "./contract";
import type { FeedbackAttachmentKind } from "@/lib/feedback-contracts";

export type FeedbackStatus = "processing" | "submitted" | "failed";

export type FeedbackAttachmentEntity = {
  id: string;
  feedbackId: string;
  kind: FeedbackAttachmentKind;
  originalName: string;
  mimeType: string;
  extension: string;
  byteSize: number;
  width: number;
  height: number;
  sha256: string;
  storageKey: string;
  createdAt: Date;
};

export type FeedbackRecordEntity = {
  id: string;
  receipt: string;
  category: FeedbackCategory;
  description: string;
  severity: FeedbackSeverity | null;
  status: FeedbackStatus;
  idempotencyKey: string;
  requestFingerprint: string;
  origin: FeedbackOrigin;
  projectId: string | null;
  messageId: string | null;
  pageRoute: string;
  appVersion: string;
  clientContextJson: string;
  stagingKey: string;
  failureCode: string | null;
  reconciliationOwner: string | null;
  reconciliationLeaseUntil: Date | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;
  attachments: FeedbackAttachmentEntity[];
};

export type CreateProcessingInput = {
  actor: WorkbenchActor;
  record: Omit<FeedbackRecordEntity, "attachments">;
  attachments: FeedbackAttachmentEntity[];
};

export type FeedbackListInput = {
  category?: FeedbackCategory;
  severity?: FeedbackSeverity;
  limit: number;
  cursor?: string;
  includeTotal?: boolean;
};

export type FeedbackListPage = {
  items: FeedbackRecordEntity[];
  total: number | null;
  nextCursor: string | null;
};

export type FeedbackRepository = {
  findByIdempotency(createdByUserId: string, idempotencyKey: string): Promise<FeedbackRecordEntity | null>;
  authorizeContext(input: {
    actor: WorkbenchActor;
    projectId?: string;
    messageId?: string;
  }): Promise<{ projectId: string | null; messageId: string | null }>;
  createProcessing(input: CreateProcessingInput): Promise<FeedbackRecordEntity>;
  retryFailed(id: string, stagingKey: string, processingStartedAt: Date): Promise<boolean>;
  finalizeSubmitted(input: {
    id: string;
    reconciliationOwner?: string;
    actorUserId: string;
    projectId: string | null;
    metadata: Record<string, unknown>;
  }): Promise<boolean>;
  markFailed(id: string, failureCode: string, reconciliationOwner?: string): Promise<boolean>;
  claimStaleProcessing(input: {
    owner: string;
    now: Date;
    staleBefore: Date;
    leaseUntil: Date;
    limit: number;
  }): Promise<FeedbackRecordEntity[]>;
  isStagingReferenced(stagingKey: string): Promise<boolean>;
  isFeedbackReferenced(id: string): Promise<boolean>;
  list(input: FeedbackListInput): Promise<FeedbackListPage>;
  getById(id: string): Promise<FeedbackRecordEntity | null>;
  findAttachmentById(feedbackId: string, attachmentId: string): Promise<FeedbackAttachmentEntity | null>;
};

export function createPrismaFeedbackRepository(client: PrismaClient = prisma): FeedbackRepository {
  return {
    async findByIdempotency(createdByUserId, idempotencyKey) {
      const record = await client.feedbackRecord.findUnique({
        where: { createdByUserId_idempotencyKey: { createdByUserId, idempotencyKey } },
        include: { attachments: { orderBy: { createdAt: "asc" } } },
      });
      return record ? toEntity(record) : null;
    },

    async authorizeContext(input) {
      const message = input.messageId
        ? await client.conversationMessage.findUnique({ where: { id: input.messageId } })
        : null;
      if (input.messageId && !message) throw new Error("Message not found or access denied.");
      if (input.projectId && message && message.projectId !== input.projectId) {
        throw new Error("Message and project do not match.");
      }

      const projectId = input.projectId ?? message?.projectId ?? null;
      if (!projectId) return { projectId: null, messageId: null };
      const project = await client.project.findUnique({ where: { id: projectId } });
      if (!project) throw new Error("Project not found or access denied.");

      let allowed = input.actor.isAdmin || project.ownerUserId === input.actor.userId;
      if (!allowed && !project.ownerUserId && (input.actor.authMode ?? "local") === "local") allowed = true;
      if (!allowed) {
        allowed = Boolean(await client.projectMembership.findUnique({
          where: { projectId_userId: { projectId, userId: input.actor.userId } },
        }));
      }
      if (!allowed) throw new Error("Project not found or access denied.");
      return { projectId, messageId: message?.id ?? null };
    },

    async createProcessing(input) {
      const created = await client.$transaction(async (tx) => {
        await tx.localUser.upsert({
          where: { id: input.actor.userId },
          update: {},
          create: {
            id: input.actor.userId,
            displayName: input.actor.displayName || "Teacher",
            role: input.actor.role || "teacher",
            authMode: input.actor.authMode ?? "local",
          },
        });
        return tx.feedbackRecord.create({
          data: {
            ...input.record,
            attachments: {
              create: input.attachments.map(({ feedbackId: _feedbackId, ...attachment }) => attachment),
            },
          },
          include: { attachments: { orderBy: { createdAt: "asc" } } },
        });
      });
      return toEntity(created);
    },

    async retryFailed(id, stagingKey, processingStartedAt) {
      const result = await client.feedbackRecord.updateMany({
        where: { id, status: "failed" },
        data: {
          status: "processing",
          stagingKey,
          failureCode: null,
          reconciliationOwner: null,
          reconciliationLeaseUntil: null,
          updatedAt: processingStartedAt,
        },
      });
      return result.count === 1;
    },

    async finalizeSubmitted(input) {
      return client.$transaction(async (tx) => {
        const result = await tx.feedbackRecord.updateMany({
          where: {
            id: input.id,
            status: "processing",
            reconciliationOwner: input.reconciliationOwner ?? null,
          },
          data: {
            status: "submitted",
            submittedAt: new Date(),
            failureCode: null,
            reconciliationOwner: null,
            reconciliationLeaseUntil: null,
          },
        });
        if (result.count !== 1) return false;
        await tx.auditLog.create({
          data: {
            actorUserId: input.actorUserId,
            action: "feedback.submitted",
            targetType: "feedback",
            targetId: input.id,
            projectId: input.projectId,
            metadataJson: JSON.stringify(whitelistFeedbackAuditMetadata(input.metadata)),
          },
        });
        return true;
      });
    },

    async markFailed(id, failureCode, reconciliationOwner) {
      const result = await client.feedbackRecord.updateMany({
        where: { id, status: "processing", reconciliationOwner: reconciliationOwner ?? null },
        data: {
          status: "failed",
          failureCode,
          reconciliationOwner: null,
          reconciliationLeaseUntil: null,
        },
      });
      return result.count === 1;
    },

    async claimStaleProcessing(input) {
      return client.$transaction(async (tx) => {
        const candidates = await tx.feedbackRecord.findMany({
          where: {
            status: "processing",
            updatedAt: { lte: input.staleBefore },
            OR: [
              { reconciliationLeaseUntil: null },
              { reconciliationLeaseUntil: { lte: input.now } },
            ],
          },
          orderBy: { updatedAt: "asc" },
          take: input.limit,
        });
        const claimed: FeedbackRecordEntity[] = [];
        for (const candidate of candidates) {
          const result = await tx.feedbackRecord.updateMany({
            where: {
              id: candidate.id,
              status: "processing",
              updatedAt: candidate.updatedAt,
              OR: [
                { reconciliationLeaseUntil: null },
                { reconciliationLeaseUntil: { lte: input.now } },
              ],
            },
            data: { reconciliationOwner: input.owner, reconciliationLeaseUntil: input.leaseUntil },
          });
          if (result.count === 1) {
            const record = await tx.feedbackRecord.findUniqueOrThrow({
              where: { id: candidate.id },
              include: { attachments: { orderBy: { createdAt: "asc" } } },
            });
            claimed.push(toEntity(record));
          }
        }
        return claimed;
      });
    },

    async isStagingReferenced(stagingKey) {
      return Boolean(await client.feedbackRecord.findFirst({ where: { stagingKey, status: "processing" }, select: { id: true } }));
    },

    async isFeedbackReferenced(id) {
      return Boolean(await client.feedbackRecord.findFirst({
        where: { id, status: { in: ["processing", "submitted"] } },
        select: { id: true },
      }));
    },

    async list(input) {
      const limit = Math.min(Math.max(input.limit, 1), 200);
      const cursor = input.cursor ? decodeFeedbackCursor(input.cursor) : null;
      const filter = { category: input.category, severity: input.severity };
      const recordsQuery = client.feedbackRecord.findMany({
        where: {
          ...filter,
          ...(cursor ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          } : {}),
        },
        include: { attachments: { orderBy: { createdAt: "asc" } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });
      let total: number | null;
      let records: Awaited<typeof recordsQuery>;
      if (input.includeTotal === false) {
        total = null;
        records = await recordsQuery;
      } else {
        [total, records] = await client.$transaction([
          client.feedbackRecord.count({ where: filter }),
          recordsQuery,
        ]);
      }
      const hasMore = records.length > limit;
      const items = records.slice(0, limit).map(toEntity);
      return {
        items,
        total,
        nextCursor: hasMore && items.length > 0 ? encodeFeedbackCursor(items[items.length - 1]) : null,
      };
    },

    async getById(id) {
      const record = await client.feedbackRecord.findUnique({
        where: { id },
        include: { attachments: { orderBy: { createdAt: "asc" } } },
      });
      return record ? toEntity(record) : null;
    },

    async findAttachmentById(feedbackId, attachmentId) {
      const attachment = await client.feedbackAttachment.findFirst({ where: { id: attachmentId, feedbackId } });
      return attachment ? toAttachmentEntity(attachment) : null;
    },
  };
}

export function encodeFeedbackCursor(record: Pick<FeedbackRecordEntity, "createdAt" | "id">) {
  return Buffer.from(JSON.stringify([record.createdAt.toISOString(), record.id]), "utf8").toString("base64url");
}

export function decodeFeedbackCursor(cursor: string) {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || typeof value[1] !== "string") {
      throw new Error("invalid cursor");
    }
    const createdAt = new Date(value[0]);
    if (Number.isNaN(createdAt.getTime()) || !value[1]) throw new Error("invalid cursor");
    return { createdAt, id: value[1] };
  } catch {
    throw new Error("Invalid feedback cursor.");
  }
}

const feedbackAuditMetadataKeys = [
  "category",
  "severity",
  "attachmentCount",
  "status",
  "format",
  "count",
] as const;

export function whitelistFeedbackAuditMetadata(metadata: Record<string, unknown>) {
  return Object.fromEntries(
    feedbackAuditMetadataKeys
      .filter((key) => Object.prototype.hasOwnProperty.call(metadata, key))
      .map((key) => [key, metadata[key]]),
  );
}

function toEntity(record: FeedbackRecord & { attachments: FeedbackAttachment[] }): FeedbackRecordEntity {
  return {
    ...record,
    category: record.category as FeedbackCategory,
    origin: record.origin as FeedbackOrigin,
    severity: record.severity as FeedbackSeverity | null,
    status: record.status as FeedbackStatus,
    attachments: (record.attachments ?? []).map(toAttachmentEntity),
  };
}

function toAttachmentEntity(attachment: FeedbackAttachment): FeedbackAttachmentEntity {
  return { ...attachment, kind: attachment.kind === "expected" ? "expected" : "issue" };
}
