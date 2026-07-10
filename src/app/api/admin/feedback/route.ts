import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { handleFeedbackAdminList } from "@/server/feedback/http";
import { createFeedbackService } from "@/server/feedback/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withLocalWorkbenchActor(request, ({ actor }) => (
    handleFeedbackAdminList(request, actor, createFeedbackService())
  ));
}
