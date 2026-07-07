import { createHash, randomBytes } from "node:crypto";
import type { AuthMode } from "@/server/auth/actor";
import { isPublicAuthMode } from "@/server/auth/actor";

export type CreateCsrfTokenInput = {
  sessionId: string;
  nonce?: string;
};

export type VerifyCsrfTokenInput = {
  sessionId: string;
  token: string;
  tokenHash: string;
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

export function requiresCsrfToken(input: { method: string; authMode: AuthMode }) {
  return isWriteMethod(input.method) && isPublicAuthMode(input.authMode);
}

function hashCsrfToken(sessionId: string, token: string) {
  return createHash("sha256").update(`${sessionId}:${token}`).digest("hex");
}

function isWriteMethod(method: string) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}
