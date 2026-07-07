import { createHash, randomBytes } from "node:crypto";
import type { AuthMode } from "@/server/auth/actor";
import { isPublicAuthMode } from "@/server/auth/actor";
import { prisma } from "@/server/db/client";

export const publicCsrfHeaderName = "x-shanhai-csrf";

export type CreateCsrfTokenInput = {
  sessionId: string;
  nonce?: string;
};

export type VerifyCsrfTokenInput = {
  sessionId: string;
  token: string;
  tokenHash: string;
};

export type IssueCsrfTokenInput = {
  sessionId: string;
  userId: string;
  expiresAt: Date;
  nonce?: string;
  db?: typeof prisma;
};

export type ValidateCsrfTokenInput = {
  sessionId: string;
  userId: string;
  token?: string | null;
  db?: typeof prisma;
  now?: () => Date;
};

export function createCsrfToken(input: CreateCsrfTokenInput) {
  const token = input.nonce ?? randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashCsrfToken(input.sessionId, token),
  };
}

export function verifyCsrfToken(input: VerifyCsrfTokenInput) {
  return hashCsrfToken(input.sessionId, input.token) === input.tokenHash;
}

export async function issueCsrfToken(input: IssueCsrfTokenInput) {
  const db = input.db ?? prisma;
  const csrf = createCsrfToken({ sessionId: input.sessionId, nonce: input.nonce });
  await db.csrfToken.create({
    data: {
      sessionId: input.sessionId,
      userId: input.userId,
      tokenHash: csrf.tokenHash,
      expiresAt: input.expiresAt,
      consumedAt: null,
    },
  });
  return csrf;
}

export async function validateCsrfToken(input: ValidateCsrfTokenInput) {
  if (!input.token || !isSafeCsrfToken(input.token)) return false;
  const db = input.db ?? prisma;
  const now = input.now?.() ?? new Date();
  const tokenHash = hashCsrfToken(input.sessionId, input.token);
  const record = await db.csrfToken.findFirst({
    where: {
      sessionId: input.sessionId,
      userId: input.userId,
      tokenHash,
      consumedAt: null,
      expiresAt: { gt: now },
    },
  });
  return Boolean(record);
}

export function requiresCsrfToken(input: { method: string; authMode: AuthMode }) {
  return isWriteMethod(input.method) && isPublicAuthMode(input.authMode);
}

function hashCsrfToken(sessionId: string, token: string) {
  return createHash("sha256").update(`${sessionId}:${token}`).digest("hex");
}

function isWriteMethod(method: string) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

function isSafeCsrfToken(value: string) {
  return /^[A-Za-z0-9_-]{12,256}$/.test(value);
}
