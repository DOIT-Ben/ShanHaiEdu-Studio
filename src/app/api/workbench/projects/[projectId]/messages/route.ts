import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { createAgentRuntimeFromEnv } from "@/server/agent-runtime/runtime-factory";
import { createMainConversationAgentFromEnv } from "@/server/conversation/model-main-conversation-agent";
import { drainProjectConversationQueue } from "@/server/conversation/conversation-turn-queue";
import { normalizeXiaoKuResponseStyle } from "@/lib/xiaoku-preferences";
import { createAgentToolExecutorFromEnv } from "@/server/tools/openai-agent-tool-executor";

const runtime = createAgentRuntimeFromEnv();
const mainAgent = createMainConversationAgentFromEnv();
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
      const teacherContent = String(body.body ?? body.content ?? "").trim();
      const reference = body.reference ? String(body.reference).trim() : "";
      const content = reference ? `${teacherContent}\n\n引用：${reference}` : teacherContent;
      const artifactRefs = Array.isArray(body.artifactRefs) ? body.artifactRefs.map(String) : [];
      const confirmedActionId = optionalString(body.confirmedActionId ?? body.actionId);
      const responseStyle = body.responseStyle === undefined ? undefined : normalizeXiaoKuResponseStyle(body.responseStyle);
      const idempotencyKey = optionalString(body.idempotencyKey) ?? optionalString(request.headers.get("idempotency-key"));
      const { message, job } = await service.enqueueMessageAndConversationTurn(projectId, {
        role: "teacher",
        content,
        artifactRefs,
        metadata: {
          ...(confirmedActionId ? { confirmedActionId } : {}),
          ...(responseStyle ? { responseStyle } : {}),
        },
        idempotencyKey,
      });

      if (shouldAutoDrainConversationQueue()) {
        void drainProjectConversationQueue(projectId, { service, runtime, agent: mainAgent, agentToolExecutor }).catch(() => null);
      }

      return NextResponse.json({ message, job }, { status: 202 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Message create failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "这条消息暂时没有发送成功，请稍后再试。" }, { status });
    }
  });
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function shouldAutoDrainConversationQueue() {
  return process.env.NODE_ENV !== "test" && process.env.VITEST !== "true";
}
