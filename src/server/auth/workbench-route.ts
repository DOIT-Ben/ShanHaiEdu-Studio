import {
  createLocalSessionSetCookieHeader,
  resolveLocalWorkbenchActor,
  type WorkbenchActor,
} from "@/server/auth/local-session";
import { createWorkbenchService } from "@/server/workbench/service";

export type AuthenticatedWorkbenchRequest = {
  actor: WorkbenchActor;
  service: ReturnType<typeof createWorkbenchService>;
};

export async function withLocalWorkbenchActor(
  request: Request,
  handler: (context: AuthenticatedWorkbenchRequest) => Promise<Response>,
) {
  const session = resolveLocalWorkbenchActor(request);
  const response = await handler({
    actor: session.actor,
    service: createWorkbenchService(undefined, session.actor),
  });

  if (session.isNewSession) {
    response.headers.append("set-cookie", createLocalSessionSetCookieHeader(session));
  }

  return response;
}

export function isProjectAccessError(error: unknown) {
  return error instanceof Error && /Project not found|access denied/i.test(error.message);
}
