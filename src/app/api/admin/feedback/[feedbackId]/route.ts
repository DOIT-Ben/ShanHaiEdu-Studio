import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { handleFeedbackAdminDetail } from "@/server/feedback/http";
import { createFeedbackService } from "@/server/feedback/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ feedbackId: string }> };

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ actor }) => {
    const { feedbackId } = await context.params;
    return handleFeedbackAdminDetail(actor, createFeedbackService(), feedbackId);
  });
}
