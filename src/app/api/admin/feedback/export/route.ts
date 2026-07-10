import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { handleFeedbackAdminExport } from "@/server/feedback/http";
import { createFeedbackService } from "@/server/feedback/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withLocalWorkbenchActor(request, ({ actor }) => (
    handleFeedbackAdminExport(request, actor, createFeedbackService())
  ));
}
