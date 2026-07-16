import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { createAgentRuntimeFromEnv } from "@/server/agent-runtime/runtime-factory";
import {
  createMainConversationAgentFromEnv,
  resolveMainAgentToolControlPlane,
} from "@/server/conversation/model-main-conversation-agent";
import { drainProjectConversationQueue } from "@/server/conversation/conversation-turn-queue";
import { normalizeXiaoKuResponseStyle } from "@/lib/xiaoku-preferences";
import { createAgentToolExecutorFromEnv } from "@/server/tools/openai-agent-tool-executor";
import { recoverConversationTurnFromCheckpoint } from "@/server/conversation/conversation-turn-checkpoint-recovery";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { resolvePreAgentControl } from "@/server/conversation/turn-intake-control";

const runtime = createAgentRuntimeFromEnv();
const mainAgent = createMainConversationAgentFromEnv();
const mainAgentToolControlPlane = resolveMainAgentToolControlPlane();
const agentToolExecutor = createAgentToolExecutorFromEnv();

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId } = await context.params;
      const messages = await service.getMessages(projectId);
      return NextResponse.json({ messages });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Messages lookup failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "项目消息暂时没有取回，请稍后再试。" }, { status });
    }
  });
}

export async function POST(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId } = await context.params;
      const body = await request.json();
      const recoveryCheckpointId = optionalString(body.recoveryCheckpointId);
      if (recoveryCheckpointId) {
        if (optionalString(body.body ?? body.content) || optionalString(body.reference) || Array.isArray(body.artifactRefs) && body.artifactRefs.length > 0) {
          throw new Error("Checkpoint recovery cannot submit a second teacher message.");
        }
        const recovered = await recoverConversationTurnFromCheckpoint({
          projectId,
          checkpointId: recoveryCheckpointId,
          service,
          controlPlaneStore: createControlPlaneStore(),
        });
        scheduleProjectQueueDrain(projectId, service);
        return NextResponse.json(recovered, { status: 202 });
      }
      const teacherContent = String(body.body ?? body.content ?? "").trim();
      const reference = body.reference ? String(body.reference).trim() : "";
      const content = reference ? `${teacherContent}\n\n引用：${reference}` : teacherContent;
      const artifactRefs = Array.isArray(body.artifactRefs) ? body.artifactRefs.map(String) : [];
      const confirmedActionId = optionalString(body.confirmedActionId ?? body.actionId);
      const responseStyle = body.responseStyle === undefined ? undefined : normalizeXiaoKuResponseStyle(body.responseStyle);
      const idempotencyKey = optionalString(body.idempotencyKey) ?? optionalString(request.headers.get("idempotency-key"));
      const preemptiveControl = resolvePreAgentControl(content, { hasActiveTask: true, hasPendingPlan: true, allowRedirect: true });
      const { message, job } = await service.enqueueMessageAndConversationTurn(projectId, {
        role: "teacher",
        content,
        artifactRefs,
        metadata: {
          ...(confirmedActionId ? { confirmedActionId } : {}),
          ...(responseStyle ? { responseStyle } : {}),
        },
        idempotencyKey,
        ...(preemptiveControl ? { preemptiveControl: { ...preemptiveControl, advanceIntentEpoch: true as const } } : {}),
      });

      if (job.status === "queued" && shouldAutoDrainConversationQueue()) {
        scheduleProjectQueueDrain(projectId, service);
      }

      return NextResponse.json({ message, job }, { status: 202 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Message create failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "这条消息暂时没有发送成功，请稍后再试。" }, { status });
    }
  });
}

function scheduleProjectQueueDrain(projectId: string, service: Parameters<Parameters<typeof withLocalWorkbenchActor>[1]>[0]["service"]) {
  if (!shouldAutoDrainConversationQueue()) return;
  void drainProjectConversationQueue(projectId, {
    service,
    runtime,
    agent: mainAgent,
    agentToolExecutor,
    enableTaskGrantAutonomy: true,
    enableNativeToolControlPlane: mainAgentToolControlPlane === "native",
  }).catch(() => null);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function shouldAutoDrainConversationQueue() {
  return process.env.NODE_ENV !== "test" && process.env.VITEST !== "true";
}
