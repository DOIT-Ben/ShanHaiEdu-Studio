import {
  type WorkbenchActor,
} from "@/server/auth/local-session";
import { publicCsrfHeaderName, requiresCsrfToken, validateCsrfToken } from "@/server/auth/csrf";
import { resolveWorkbenchSession } from "@/server/auth/session";
import { createWorkbenchService } from "@/server/workbench/service";
import { NextResponse } from "next/server";

export type AuthenticatedWorkbenchRequest = {
  actor: WorkbenchActor;
  service: ReturnType<typeof createWorkbenchService>;
  executionIdentity: {
    actorUserId: string;
    actorAuthMode: WorkbenchActor["authMode"];
    authSessionId: string | null;
  };
};

export async function withLocalWorkbenchActor(
  request: Request,
  handler: (context: AuthenticatedWorkbenchRequest) => Promise<Response>,
) {
  if (!isLocalWorkbenchRequestAllowed(request)) {
    return NextResponse.json({ error: "请求暂时不能处理，请刷新页面后重试。" }, { status: 403 });
  }

  const session = await resolveWorkbenchSession(request);
  if (!session.actor) {
    return NextResponse.json({ error: "请先登录后再继续。" }, { status: 401 });
  }

  if (requiresCsrfToken({ method: request.method, authMode: session.authMode })) {
    if (!session.publicSession) {
      return NextResponse.json({ error: "请求暂时不能处理，请刷新页面后重试。" }, { status: 403 });
    }
    const isValidCsrf = await validateCsrfToken({
      sessionId: session.publicSession.id,
      userId: session.actor.userId,
      token: request.headers.get(publicCsrfHeaderName),
    });
    if (!isValidCsrf) {
      return NextResponse.json({ error: "请求暂时不能处理，请刷新页面后重试。" }, { status: 403 });
    }
  }

  const executionIdentity = {
    actorUserId: session.actor.userId,
    actorAuthMode: session.authMode,
    authSessionId: session.publicSession?.id ?? null,
  };
  const response = await handler({
    actor: session.actor,
    executionIdentity,
    service: createWorkbenchService(undefined, session.actor, executionIdentity),
  });

  if (session.setCookieHeader) {
    response.headers.append("set-cookie", session.setCookieHeader);
  }

  return response;
}

export function isProjectAccessError(error: unknown) {
  return error instanceof Error && /Project not found|access denied/i.test(error.message);
}

function isLocalWorkbenchRequestAllowed(request: Request) {
  if (!isWriteMethod(request.method)) return true;

  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin) return sameOrigin(origin, url.origin);

  const referer = request.headers.get("referer");
  if (referer) return sameOrigin(referer, url.origin);

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite === "cross-site") return false;

  return true;
}

function isWriteMethod(method: string) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

function sameOrigin(sourceOrigin: string, expectedOrigin: string) {
  try {
    const source = new URL(sourceOrigin);
    const expected = new URL(expectedOrigin);
    if (source.origin === expected.origin) return true;
    return (
      source.protocol === expected.protocol &&
      source.port === expected.port &&
      isLoopbackHost(source.hostname) &&
      isLoopbackHost(expected.hostname)
    );
  } catch {
    return false;
  }
}

function isLoopbackHost(hostname: string) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname.toLowerCase());
}
