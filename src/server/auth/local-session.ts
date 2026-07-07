import { randomUUID } from "node:crypto";

export type WorkbenchActor = {
  userId: string;
  role: "teacher";
  displayName: string;
};

export type LocalWorkbenchSession = {
  actor: WorkbenchActor;
  isNewSession: boolean;
};

export type LocalWorkbenchSessionOptions = {
  generateUserId?: () => string;
};

export const localWorkbenchUserCookieName = "shanhai_local_user";

const localUserIdPattern = /^[A-Za-z0-9_-]{8,80}$/;
const maxAgeSeconds = 60 * 60 * 24 * 30;

export function resolveLocalWorkbenchActor(request: Request, options: LocalWorkbenchSessionOptions = {}): LocalWorkbenchSession {
  const cookieUserId = readCookie(request.headers.get("cookie") ?? "", localWorkbenchUserCookieName);
  const generatedUserId = options.generateUserId?.() ?? defaultGeneratedUserId();
  const userId = cookieUserId && isSafeLocalUserId(cookieUserId) ? cookieUserId : generatedUserId;

  return {
    actor: {
      userId,
      role: "teacher",
      displayName: "本地教师",
    },
    isNewSession: userId !== cookieUserId,
  };
}

function defaultGeneratedUserId() {
  if (process.env.NODE_ENV === "test") {
    return "local-test-user";
  }
  return randomUUID();
}

export function createLocalSessionSetCookieHeader(session: LocalWorkbenchSession) {
  return [
    `${localWorkbenchUserCookieName}=${session.actor.userId}`,
    `Max-Age=${maxAgeSeconds}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ].join("; ");
}

function readCookie(cookieHeader: string, name: string) {
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) {
      return rawValue.join("=").trim();
    }
  }
  return null;
}

function isSafeLocalUserId(value: string) {
  return localUserIdPattern.test(value);
}
