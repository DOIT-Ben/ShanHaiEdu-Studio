import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { handleFeedbackAdminAttachment } from "@/server/feedback/http";
import { createFeedbackService } from "@/server/feedback/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ feedbackId: string; attachmentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ actor }) => {
    const { feedbackId, attachmentId } = await context.params;
    return handleFeedbackAdminAttachment(actor, createFeedbackService(), feedbackId, attachmentId);
  });
}
