import "dotenv/config";
import { randomUUID } from "node:crypto";

import dbModule from "../src/server/db/client.ts";
import feedbackServiceModule from "../src/server/feedback/service.ts";

const { prisma } = dbModule;
const { createFeedbackService } = feedbackServiceModule;

const service = createFeedbackService();

try {
  const result = await service.reconcile({
    owner: `feedback-reconciler-${process.pid}-${randomUUID()}`,
    staleAfterMs: readNonNegativeInteger("FEEDBACK_RECONCILE_STALE_AFTER_MS", 5 * 60_000),
    leaseMs: readPositiveInteger("FEEDBACK_RECONCILE_LEASE_MS", 60_000),
    orphanGraceMs: readNonNegativeInteger("FEEDBACK_RECONCILE_ORPHAN_GRACE_MS", 60 * 60_000),
    limit: readPositiveInteger("FEEDBACK_RECONCILE_LIMIT", 50),
  });
  const ok = result.cleanupFailures === 0 && result.recoveryFailures === 0;
  console.log(JSON.stringify({
    ok,
    claimed: result.claimed,
    cleanupFailures: result.cleanupFailures,
    recoveryFailures: result.recoveryFailures,
  }));
  if (!ok) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

function readPositiveInteger(name, fallback) {
  const value = readInteger(name, fallback);
  if (value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

function readNonNegativeInteger(name, fallback) {
  const value = readInteger(name, fallback);
  if (value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}

function readInteger(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer.`);
  return value;
}
