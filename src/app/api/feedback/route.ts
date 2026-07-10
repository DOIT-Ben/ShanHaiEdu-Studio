import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { handleFeedbackPost } from "@/server/feedback/http";
import { createFeedbackService } from "@/server/feedback/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withLocalWorkbenchActor(request, ({ actor }) => (
    handleFeedbackPost(request, actor, createFeedbackService())
  ));
}
