import { Usage, type AgentInputItem, type Model, type ModelRequest, type ModelResponse } from "@openai/agents";

import type { TaskBrief } from "@/server/conversation/task-contract";
import type {
  RuntimeAbObservation,
  RuntimeAbResponsesClient,
  RuntimeAbToolName,
} from "@/server/runtime-ab/types";
import { projectRuntimeAbToolDefinitions } from "@/server/runtime-ab/tool-projection";
import { resolveMainAgentToolDefinition } from "@/server/tools/main-agent-tool-registry";

type OfflineRuntimeAbDecision =
  | { kind: "tool"; toolName: RuntimeAbToolName; arguments: Record<string, unknown> }
  | { kind: "complete"; summary: string };

export function createOfflineRuntimeAbFixture(
  taskBrief: TaskBrief,
  options?: { failTool?: RuntimeAbToolName; failFirstTool?: RuntimeAbToolName },
) {
  let externalProviderCalls = 0;
  let modelRequests = 0;
  const executionRecords: Array<{ toolName: RuntimeAbToolName; idempotencyKey: string }> = [];
  const executionCounts = new Map<RuntimeAbToolName, number>();
  const toolContracts = new Map(projectRuntimeAbToolDefinitions().map((tool) => {
    const production = resolveMainAgentToolDefinition(tool.name);
    return [tool.name, {
      requiredArtifactKinds: production.requiredArtifactKinds,
      producedArtifactKind: production.producedArtifactKind,
    }] as const;
  }));

  const responsesClient: RuntimeAbResponsesClient = {
    responses: {
      async create(request) {
        modelRequests += 1;
        return toResponsesDecision(chooseNext(taskBrief, request.observations, toolContracts), modelRequests);
      },
    },
  };

  const agentsModel: Model = {
    async getResponse(request: ModelRequest): Promise<ModelResponse> {
      modelRequests += 1;
      const observations = observationsFromAgentInput(request.input);
      const decision = chooseNext(taskBrief, observations, toolContracts);
      return {
        usage: new Usage({ requests: 0 }),
        output: decision.kind === "tool"
          ? [{
              type: "function_call",
              callId: `offline-sdk-${modelRequests}`,
              name: decision.toolName,
              arguments: JSON.stringify(decision.arguments),
              status: "completed",
            }]
          : [{
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: decision.summary }],
            }],
      };
    },
    async *getStreamedResponse() {
      throw new Error("Offline Runtime A/B fixture does not support streaming.");
    },
  };

  return {
    responsesClient,
    agentsModel,
    get externalProviderCalls() {
      return externalProviderCalls;
    },
    get modelRequests() {
      return modelRequests;
    },
    executionRecords,
    execute: async (input: { toolName: RuntimeAbToolName; idempotencyKey: string }) => {
      executionRecords.push({ toolName: input.toolName, idempotencyKey: input.idempotencyKey });
      const executionCount = (executionCounts.get(input.toolName) ?? 0) + 1;
      executionCounts.set(input.toolName, executionCount);
      if (
        options?.failTool === input.toolName
        || (options?.failFirstTool === input.toolName && executionCount === 1)
      ) {
        return {
          status: "failed" as const,
          reasonCode: "offline_tool_failure",
          summary: `${input.toolName} failed in the explicit offline fixture`,
        };
      }
      const producedArtifactKind = toolContracts.get(input.toolName)?.producedArtifactKind;
      if (!producedArtifactKind) throw new Error(`Offline fixture has no production Tool contract for ${input.toolName}.`);
      return {
        status: "succeeded" as const,
        producedOutputs: [producedArtifactKind],
        summary: `${input.toolName} completed by the explicit offline fixture`,
      };
    },
  };
}

function chooseNext(
  taskBrief: TaskBrief,
  observations: RuntimeAbObservation[],
  toolContracts: Map<RuntimeAbToolName, { requiredArtifactKinds: string[]; producedArtifactKind?: string }>,
): OfflineRuntimeAbDecision {
  const completed = new Set(observations.flatMap((observation) => observation.producedOutputs));
  const missing = [...toolContracts.entries()]
    .filter(([, contract]) => contract.producedArtifactKind && !completed.has(contract.producedArtifactKind))
    .filter(([, contract]) => contract.requiredArtifactKinds.every((kind) => completed.has(kind)))
    .map(([toolName]) => toolName);
  if (missing.length === 0) {
    return { kind: "complete", summary: "All requested offline text candidates are available." };
  }

  const offset = [...taskBrief.goal].reduce((total, character) => total + character.codePointAt(0)!, 0) % missing.length;
  const toolName = missing[offset];
  return {
    kind: "tool",
    toolName,
    arguments: buildArguments(taskBrief, toolContracts.get(toolName)?.requiredArtifactKinds ?? []),
  };
}

function buildArguments(taskBrief: TaskBrief, requiredArtifactKinds: string[]) {
  return {
    projectId: taskBrief.projectId,
    userInstruction: taskBrief.goal,
    ...(requiredArtifactKinds.length ? {
      artifactRefs: requiredArtifactKinds.map((kind) => ({ kind, artifactId: `offline-${kind}` })),
    } : {}),
  };
}

function toResponsesDecision(decision: OfflineRuntimeAbDecision, requestNumber: number) {
  if (decision.kind === "tool") {
    return {
      output: [{
        type: "function_call" as const,
        call_id: `offline-responses-${requestNumber}`,
        name: decision.toolName,
        arguments: JSON.stringify(decision.arguments),
      }],
      output_text: "",
    };
  }
  return { output: [], output_text: decision.summary };
}

function observationsFromAgentInput(input: string | AgentInputItem[]): RuntimeAbObservation[] {
  const observations: RuntimeAbObservation[] = [];
  const seen = new Set<string>();
  for (const text of collectStrings(input)) {
    try {
      const parsed = JSON.parse(text) as {
        observation?: RuntimeAbObservation;
        observations?: RuntimeAbObservation[];
        checkpoint?: { observations?: RuntimeAbObservation[] };
      };
      const candidates = [
        ...(parsed.observations ?? []),
        ...(parsed.checkpoint?.observations ?? []),
        ...(parsed.observation ? [parsed.observation] : []),
      ];
      for (const observation of candidates) {
        if (seen.has(observation.observationId)) continue;
        seen.add(observation.observationId);
        observations.push(observation);
      }
    } catch {
      // Invalid model-visible tool output is ignored by this explicit offline fixture.
    }
  }
  return observations;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(collectStrings);
}
