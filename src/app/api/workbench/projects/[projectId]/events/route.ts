import { NextResponse } from "next/server";

import { projectTeacherAgentEvent } from "@/lib/teacher-agent-events";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { waitForProjectAgentEvent } from "@/server/conversation/agent-event-notifier";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId } = await context.params;
      await service.getProject(projectId);
      const url = new URL(request.url);
      const afterSequence = resolveAfterSequence(
        url.searchParams.get("afterSequence"),
        request.headers.get("last-event-id"),
      );
      const store = createControlPlaneStore();
      const stream = createTeacherEventStream({
        projectId,
        afterSequence,
        requestSignal: request.signal,
        listEvents: (cursor) => store.listEvents(projectId, cursor),
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Project event stream failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "项目进度暂时没有取回，请稍后再试。" }, { status });
    }
  });
}

export function resolveAfterSequence(queryValue: string | null, lastEventId: string | null) {
  const values = [queryValue, lastEventId]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0);
  return values.length ? Math.max(...values) : 0;
}

function createTeacherEventStream(input: {
  projectId: string;
  afterSequence: number;
  requestSignal: AbortSignal;
  listEvents: (afterSequence: number) => ReturnType<ReturnType<typeof createControlPlaneStore>["listEvents"]>;
}) {
  const encoder = new TextEncoder();
  const streamAbort = new AbortController();
  input.requestSignal.addEventListener("abort", () => streamAbort.abort(), { once: true });

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let cursor = input.afterSequence;
      let closed = false;
      controller.enqueue(encoder.encode("retry: 1500\n\n"));

      const pump = async () => {
        try {
          while (!streamAbort.signal.aborted) {
            const events = await input.listEvents(cursor);
            for (const event of events) {
              cursor = Math.max(cursor, event.sequence);
              const projected = projectTeacherAgentEvent(event);
              if (!projected || streamAbort.signal.aborted) continue;
              controller.enqueue(encoder.encode(encodeServerSentEvent(projected.sequence, projected)));
            }
            await waitForProjectAgentEvent({
              projectId: input.projectId,
              afterSequence: cursor,
              signal: streamAbort.signal,
              fallbackMs: 2_000,
            });
          }
        } catch (error) {
          if (!streamAbort.signal.aborted) {
            closed = true;
            controller.error(error);
          }
        } finally {
          if (!closed) {
            closed = true;
            try { controller.close(); } catch { /* the browser already closed the stream */ }
          }
        }
      };
      void pump();
    },
    cancel() {
      streamAbort.abort();
    },
  });
}

export function encodeServerSentEvent(sequence: number, event: unknown) {
  return `id: ${sequence}\ndata: ${JSON.stringify(event)}\n\n`;
}
