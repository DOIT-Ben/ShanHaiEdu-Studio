import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import packageJson from "../../../package.json";
import type { WorkbenchActor } from "@/server/auth/actor";
import {
  parseFeedbackMetadata,
  type FeedbackCategory,
  type ParsedFeedbackMetadata,
  type FeedbackSeverity,
} from "./contract";
import {
  validateFeedbackAttachments,
  type FeedbackAttachmentInput,
  type ValidatedFeedbackAttachment,
} from "./media";
import {
  createPrismaFeedbackRepository,
  type FeedbackAttachmentEntity,
  type FeedbackRecordEntity,
  type FeedbackRepository,
} from "./repository";
import { FeedbackStorage } from "./storage";

export class FeedbackConflictError extends Error {
  readonly status = 409;

  constructor() {
    super("This idempotency key was already used for different feedback.");
  }
}

export type FeedbackServiceOptions = {
  repository?: FeedbackRepository;
  storage?: FeedbackStorage;
  generateId?: () => string;
  now?: () => Date;
  appVersion?: string;
  faults?: Partial<Record<"afterStage" | "afterRecord" | "afterCommit", () => void | Promise<void>>>;
};

export function createFeedbackService(options: FeedbackServiceOptions = {}) {
  const repository = options.repository ?? createPrismaFeedbackRepository();
  const storage = options.storage ?? new FeedbackStorage();
  const generateId = options.generateId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const appVersion = options.appVersion?.trim() || process.env.SHANHAI_APP_VERSION?.trim() || packageJson.version;

  return {
    assertAdmin(actor: WorkbenchActor) {
      requirePasswordAdmin(actor);
    },

    async submit(actor: WorkbenchActor, input: { metadata: unknown; attachments: FeedbackAttachmentInput[] }) {
      requireActor(actor);
      const metadata = parseFeedbackMetadata(input.metadata);
      const validated = await validateFeedbackAttachments(input.attachments);
      const context = await repository.authorizeContext({
        actor,
        projectId: metadata.projectId,
        messageId: metadata.messageId,
      });
      const normalizedMetadata: ParsedFeedbackMetadata = {
        ...metadata,
        ...(context.projectId ? { projectId: context.projectId } : { projectId: undefined }),
        ...(context.messageId ? { messageId: context.messageId } : { messageId: undefined }),
      };
      const fingerprint = fingerprintValidated(normalizedMetadata, validated);
      const existing = await repository.findByIdempotency(actor.userId, metadata.idempotencyKey);
      if (existing) return handleExisting(existing, actor, normalizedMetadata, validated, fingerprint);

      const createdAt = now();
      const feedbackId = generateId();
      const stagingKey = generateId();
      const attachments = createAttachmentEntities(feedbackId, validated, generateId, createdAt);
      const record: Omit<FeedbackRecordEntity, "attachments"> = {
        id: feedbackId,
        receipt: createReceipt(createdAt, generateId()),
        category: normalizedMetadata.category,
        description: normalizedMetadata.description,
        severity: normalizedMetadata.severity ?? null,
        status: "processing",
        idempotencyKey: normalizedMetadata.idempotencyKey,
        requestFingerprint: fingerprint,
        origin: normalizedMetadata.origin,
        projectId: context.projectId,
        messageId: context.messageId,
        pageRoute: normalizedMetadata.pageRoute,
        appVersion,
        clientContextJson: JSON.stringify(normalizedMetadata.clientContext),
        stagingKey,
        failureCode: null,
        reconciliationOwner: null,
        reconciliationLeaseUntil: null,
        createdByUserId: actor.userId,
        createdAt,
        updatedAt: createdAt,
        submittedAt: null,
      };

      await storage.stage(stagingKey, stagedAttachments(attachments, validated));
      await options.faults?.afterStage?.();
      try {
        await repository.createProcessing({ actor, record, attachments });
      } catch (error) {
        await storage.removeStaging(stagingKey).catch(() => undefined);
        const raced = await repository.findByIdempotency(actor.userId, metadata.idempotencyKey);
        if (raced) return reuseOrConflict(raced, fingerprint);
        throw error;
      }
      await options.faults?.afterRecord?.();

      try {
        await storage.commit(stagingKey, feedbackId);
      } catch (error) {
        await repository.markFailed(feedbackId, "storage_commit_failed").catch(() => false);
        await storage.removeStaging(stagingKey).catch(() => undefined);
        await storage.removeFinal(feedbackId).catch(() => undefined);
        throw error;
      }
      await options.faults?.afterCommit?.();

      if (!await finalizeSubmitted(repository, actor.userId, { ...record, attachments }, undefined)) {
        throw new Error("Feedback status changed before submission completed.");
      }
      return { feedbackId: record.id, receiptCode: record.receipt, status: "submitted" as const, reused: false };
    },

    async reconcile(input: {
      owner: string;
      staleAfterMs: number;
      leaseMs: number;
      orphanGraceMs: number;
      limit?: number;
    }) {
      const current = now();
      const claimed = await repository.claimStaleProcessing({
        owner: input.owner,
        now: current,
        staleBefore: new Date(current.getTime() - input.staleAfterMs),
        leaseUntil: new Date(current.getTime() + input.leaseMs),
        limit: input.limit ?? 50,
      });
      let cleanupFailures = 0;
      let recoveryFailures = 0;
      for (const record of claimed) {
        let finalExists = false;
        try {
          finalExists = await storage.hasFinal(record.id);
          if (!finalExists) {
            if (!await storage.hasStaging(record.stagingKey)) {
              await repository.markFailed(record.id, "missing_staged_attachments", input.owner);
              recoveryFailures += 1;
              continue;
            }
            await storage.commit(record.stagingKey, record.id);
            finalExists = true;
          }
          if (!await finalizeSubmitted(repository, record.createdByUserId, record, input.owner)) {
            throw new Error("Feedback reconciliation ownership changed before finalization.");
          }
        } catch {
          recoveryFailures += 1;
          const recoverableFinal = finalExists || await storage.hasFinal(record.id).catch(() => true);
          if (!recoverableFinal) {
            await repository.markFailed(record.id, "reconciliation_failed", input.owner).catch(() => false);
            await storage.removeStaging(record.stagingKey).catch(() => { cleanupFailures += 1; });
          }
        }
      }

      const orphanCutoff = current.getTime() - input.orphanGraceMs;
      for (const entry of await storage.listStagingEntries()) {
        if (entry.modifiedAt.getTime() <= orphanCutoff && !await repository.isStagingReferenced(entry.key)) {
          await storage.removeStaging(entry.key).catch(() => { cleanupFailures += 1; });
        }
      }
      for (const entry of await storage.listFinalEntries()) {
        if (entry.modifiedAt.getTime() <= orphanCutoff && !await repository.isFeedbackReferenced(entry.key)) {
          await storage.removeFinal(entry.key).catch(() => { cleanupFailures += 1; });
        }
      }
      return { claimed: claimed.length, cleanupFailures, recoveryFailures };
    },

    async list(actor: WorkbenchActor, input: { category?: FeedbackCategory; severity?: FeedbackSeverity; limit: number; cursor?: string; includeTotal?: boolean }) {
      requirePasswordAdmin(actor);
      return repository.list(input);
    },

    async get(actor: WorkbenchActor, id: string) {
      requirePasswordAdmin(actor);
      return repository.getById(id);
    },

    async downloadAttachment(actor: WorkbenchActor, feedbackId: string, attachmentId: string) {
      requirePasswordAdmin(actor);
      const attachment = await repository.findAttachmentById(feedbackId, attachmentId);
      if (!attachment) throw new Error("Feedback attachment not found.");
      const bytes = await storage.read({
        feedbackId,
        storageKey: attachment.storageKey,
        extension: attachment.extension as "png" | "jpg" | "webp",
      });
      return { bytes, mimeType: attachment.mimeType, fileName: path.basename(attachment.originalName) };
    },
  };

  async function handleExisting(
    existing: FeedbackRecordEntity,
    actor: WorkbenchActor,
    metadata: ParsedFeedbackMetadata,
    validated: ValidatedFeedbackAttachment[],
    fingerprint: string,
  ) {
    if (existing.requestFingerprint !== fingerprint) throw new FeedbackConflictError();
    if (existing.status !== "failed") return reuseOrConflict(existing, fingerprint);

    const stagingKey = generateId();
    await storage.stage(stagingKey, stagedAttachments(existing.attachments, validated));
    if (!await repository.retryFailed(existing.id, stagingKey, now())) {
      await storage.removeStaging(stagingKey).catch(() => undefined);
      const latest = await repository.findByIdempotency(actor.userId, metadata.idempotencyKey);
      if (!latest) throw new Error("Feedback retry state was lost.");
      return reuseOrConflict(latest, fingerprint);
    }
    try {
      await storage.commit(stagingKey, existing.id);
    } catch (error) {
      await repository.markFailed(existing.id, "storage_commit_failed").catch(() => false);
      await storage.removeStaging(stagingKey).catch(() => undefined);
      throw error;
    }
    if (!await finalizeSubmitted(repository, actor.userId, existing, undefined)) throw new Error("Feedback retry status changed.");
    return { feedbackId: existing.id, receiptCode: existing.receipt, status: "submitted" as const, reused: true };
  }
}

export async function createFeedbackRequestFingerprint(metadata: ParsedFeedbackMetadata, attachments: FeedbackAttachmentInput[]) {
  const normalized = parseFeedbackMetadata(metadata);
  const validated = await validateFeedbackAttachments(attachments);
  return fingerprintValidated(normalized, validated);
}

function fingerprintValidated(metadata: ParsedFeedbackMetadata, attachments: ValidatedFeedbackAttachment[]) {
  const canonical = {
    category: metadata.category,
    description: metadata.description,
    severity: metadata.severity ?? null,
    pageRoute: metadata.pageRoute,
    projectId: metadata.projectId ?? null,
    messageId: metadata.messageId ?? null,
    origin: metadata.origin,
    clientContext: metadata.clientContext,
    attachments: attachments.map((attachment) => ({
      kind: attachment.kind,
      sha256: attachment.sha256,
      mimeType: attachment.mimeType,
      bytes: attachment.byteSize,
    })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function createAttachmentEntities(
  feedbackId: string,
  validated: ValidatedFeedbackAttachment[],
  generateId: () => string,
  createdAt: Date,
) {
  return validated.map((attachment): FeedbackAttachmentEntity => ({
    id: generateId(),
    feedbackId,
    kind: attachment.kind,
    originalName: path.basename(attachment.fileName).slice(0, 255),
    mimeType: attachment.mimeType,
    extension: attachment.extension,
    byteSize: attachment.byteSize,
    width: attachment.width,
    height: attachment.height,
    sha256: attachment.sha256,
    storageKey: generateId(),
    createdAt,
  }));
}

function stagedAttachments(entities: FeedbackAttachmentEntity[], validated: ValidatedFeedbackAttachment[]) {
  if (entities.length !== validated.length) throw new Error("Feedback attachment fingerprint no longer matches stored metadata.");
  return entities.map((entity, index) => ({
    storageKey: entity.storageKey,
    extension: entity.extension as "png" | "jpg" | "webp",
    bytes: validated[index].bytes,
  }));
}

function reuseOrConflict(record: FeedbackRecordEntity, fingerprint: string) {
  if (record.requestFingerprint !== fingerprint) throw new FeedbackConflictError();
  return { feedbackId: record.id, receiptCode: record.receipt, status: record.status, reused: true };
}

function createReceipt(date: Date, entropy: string) {
  const day = date.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = createHash("sha256").update(entropy).digest("hex").slice(0, 8).toUpperCase();
  return `FB-${day}-${suffix}`;
}

function requireActor(actor: WorkbenchActor) {
  if (!actor?.userId?.trim()) throw new Error("A non-empty authenticated actor is required.");
}

function requirePasswordAdmin(actor: WorkbenchActor) {
  requireActor(actor);
  if (actor.authMode !== "password") throw new Error("Password authentication is required for feedback admin access.");
  if (actor.isAdmin !== true) throw new Error("Feedback admin access is required.");
}

async function finalizeSubmitted(
  repository: FeedbackRepository,
  actorUserId: string,
  record: FeedbackRecordEntity,
  reconciliationOwner?: string,
) {
  return repository.finalizeSubmitted({
    id: record.id,
    reconciliationOwner,
    actorUserId,
    projectId: record.projectId,
    metadata: {
      category: record.category,
      severity: record.severity,
      attachmentCount: record.attachments.length,
      status: "submitted",
    },
  });
}
