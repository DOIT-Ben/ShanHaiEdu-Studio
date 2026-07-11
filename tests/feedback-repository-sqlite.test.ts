import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { createPrismaFeedbackRepository } from "@/server/feedback/repository";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

describe("Prisma feedback retry and reconciliation CAS", () => {
  it("keeps a fresh retry outside the stale window and rejects foreground writes after a reconciler claim", async () => {
    const root = path.join(process.cwd(), ".tmp", `feedback-repository-${randomUUID()}`);
    const dbPath = path.join(root, "feedback.sqlite");
    cleanupPaths.push(root);
    const databaseUrl = `file:${dbPath}`;
    const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        SHANHAI_DB_INIT_SKIP_DOTENV: "1",
      },
      encoding: "utf8",
    });
    expect(initialized.status, initialized.stderr).toBe(0);

    const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
    try {
      const old = new Date("2026-07-10T09:00:00.000Z");
      const retryAt = new Date("2026-07-10T10:00:00.000Z");
      await client.localUser.create({
        data: {
          id: "teacher-sqlite",
          displayName: "SQLite Teacher",
          role: "teacher",
          authMode: "password",
          email: "sqlite-teacher@example.test",
          passwordHash: "test-only-hash",
        },
      });
      await client.feedbackRecord.create({
        data: {
          id: "feedback-sqlite",
          receipt: "FB-20260710-SQLITE",
          category: "bug",
          description: "SQLite retry race",
          status: "failed",
          idempotencyKey: "sqlite-race-key",
          requestFingerprint: "fingerprint",
          origin: "global",
          pageRoute: "/sqlite-race",
          appVersion: "test",
          clientContextJson: "{}",
          stagingKey: "old-stage",
          failureCode: "old-failure",
          createdByUserId: "teacher-sqlite",
          createdAt: old,
          updatedAt: old,
          attachments: {
            create: {
              id: "attachment-sqlite",
              kind: "expected",
              originalName: "reference.png",
              mimeType: "image/png",
              extension: "png",
              byteSize: 10,
              width: 2,
              height: 2,
              sha256: "hash",
              storageKey: "attachment-storage-sqlite",
            },
          },
        },
      });

      const repository = createPrismaFeedbackRepository(client);
      expect((await repository.getById("feedback-sqlite"))?.attachments[0].kind).toBe("expected");
      expect(await repository.retryFailed("feedback-sqlite", "retry-stage", retryAt)).toBe(true);
      expect(await repository.claimStaleProcessing({
        owner: "worker-1",
        now: retryAt,
        staleBefore: new Date(retryAt.getTime() - 1),
        leaseUntil: new Date(retryAt.getTime() + 60_000),
        limit: 10,
      })).toHaveLength(0);

      await client.feedbackRecord.update({ where: { id: "feedback-sqlite" }, data: { updatedAt: old } });
      expect(await repository.claimStaleProcessing({
        owner: "worker-1",
        now: retryAt,
        staleBefore: retryAt,
        leaseUntil: new Date(retryAt.getTime() + 60_000),
        limit: 10,
      })).toHaveLength(1);
      expect(await repository.markFailed("feedback-sqlite", "foreground-failure")).toBe(false);
      expect(await repository.finalizeSubmitted({
        id: "feedback-sqlite",
        actorUserId: "teacher-sqlite",
        projectId: null,
        metadata: {},
      })).toBe(false);
      expect(await repository.markFailed("feedback-sqlite", "reconciler-failure", "worker-1")).toBe(true);
    } finally {
      await client.$disconnect();
    }
  });

  it("rejects cross-user project and message context combinations in the real Prisma repository", async () => {
    const root = path.join(process.cwd(), ".tmp", `feedback-authorization-${randomUUID()}`);
    const dbPath = path.join(root, "feedback.sqlite");
    cleanupPaths.push(root);
    const databaseUrl = `file:${dbPath}`;
    const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
      encoding: "utf8",
    });
    expect(initialized.status, initialized.stderr).toBe(0);

    const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
    try {
      await client.localUser.createMany({
        data: [
          { id: "teacher-owner", displayName: "Owner", role: "teacher", authMode: "password", email: "owner@example.test", passwordHash: "hash" },
          { id: "teacher-other", displayName: "Other", role: "teacher", authMode: "password", email: "other@example.test", passwordHash: "hash" },
        ],
      });
      await client.project.createMany({
        data: [
          { id: "project-owner", title: "Owner project", status: "active", currentNodeKey: "requirement", ownerUserId: "teacher-owner" },
          { id: "project-other", title: "Other project", status: "active", currentNodeKey: "requirement", ownerUserId: "teacher-other" },
        ],
      });
      await client.conversationMessage.create({
        data: { id: "message-other", projectId: "project-other", role: "assistant", content: "Other user message" },
      });
      const repository = createPrismaFeedbackRepository(client);
      const actor = {
        userId: "teacher-owner",
        displayName: "Owner",
        role: "teacher" as const,
        authMode: "password" as const,
        isAdmin: false,
        projectRoles: { "project-owner": "owner" as const },
        memberships: [],
      };

      await expect(repository.authorizeContext({ actor, projectId: "project-other" })).rejects.toThrow(/access denied/i);
      await expect(repository.authorizeContext({
        actor,
        projectId: "project-owner",
        messageId: "message-other",
      })).rejects.toThrow(/do not match/i);
    } finally {
      await client.$disconnect();
    }
  });
});
