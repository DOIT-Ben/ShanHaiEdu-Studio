import { createExecutionEnvelope, type IntentGrant, type TaskBrief } from "@/server/conversation/task-contract";
import {
  executeThroughToolGateway,
  type CurrentToolExecutionScope,
  type ToolGatewayFailure,
} from "@/server/tools/tool-execution-gateway";

import type {
  RuntimeAbGateway,
  RuntimeAbObservation,
  RuntimeAbToolCall,
  RuntimeAbToolExecutionOutcome,
  RuntimeAbToolName,
} from "./types";
import { createRuntimeAbCallBinding } from "./types";

export function createEnvelopeBoundRuntimeAbGateway(input: {
  actorUserId: string;
  taskBrief: TaskBrief;
  intentGrant: IntentGrant;
  planRevision: number;
  getCurrentScope: () => CurrentToolExecutionScope;
  execute: (input: {
    callId: string;
    toolName: RuntimeAbToolName;
    arguments: Record<string, unknown>;
    idempotencyKey: string;
  }) => Promise<RuntimeAbToolExecutionOutcome> | RuntimeAbToolExecutionOutcome;
}): RuntimeAbGateway {
  return {
    async execute(call) {
      const executionEnvelope = createExecutionEnvelope({
        actorUserId: input.actorUserId,
        taskBrief: input.taskBrief,
        planRevision: input.planRevision,
        intensity: input.taskBrief.generationIntensity,
        intentGrant: input.intentGrant,
        action: { toolName: call.toolName, arguments: call.arguments },
      });
      const result = await executeThroughToolGateway<RuntimeAbToolExecutionOutcome>({
        request: {
          toolName: call.toolName,
          projectId: input.taskBrief.projectId,
          intentEpoch: input.taskBrief.intentEpoch,
          arguments: structuredClone(call.arguments),
        },
        current: input.getCurrentScope(),
        executionEnvelope,
        execute: ({ idempotencyKey }) => input.execute({
          callId: call.callId,
          toolName: call.toolName,
          arguments: structuredClone(call.arguments),
          idempotencyKey,
        }),
      });
      return toObservation(call, executionEnvelope.idempotencyKey, result);
    },
  };
}

function toObservation(
  call: RuntimeAbToolCall,
  idempotencyKey: string,
  result: RuntimeAbToolExecutionOutcome | ToolGatewayFailure,
): RuntimeAbObservation {
  const binding = createRuntimeAbCallBinding(call);
  if (result.status === "failed") {
    return {
      observationId: `runtime-ab-observation-${call.callId}`,
      callId: call.callId,
      toolName: call.toolName,
      ...binding,
      idempotencyKey,
      status: "failed",
      producedOutputs: [],
      summary: "The isolated tool execution was rejected and requires replanning.",
      reasonCode: result.reasonCode,
    };
  }
  return {
    observationId: `runtime-ab-observation-${call.callId}`,
    callId: call.callId,
    toolName: call.toolName,
    ...binding,
    idempotencyKey,
    status: "succeeded",
    producedOutputs: [...result.producedOutputs],
    summary: result.summary,
  };
}
