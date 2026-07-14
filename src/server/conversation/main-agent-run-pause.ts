import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { MainAgentReActBudgetExhausted } from "./main-agent-controlled-react-loop";
import { createAgentObservation, createRunCheckpoint } from "./react-control";

const roundBudgetPauseSummary = "本轮处理已达到安全步数上限，当前进度已保存，可以从这里继续。";

export function createMainAgentRoundBudgetPause(input: {
  projectId: string;
  taskBriefDigest: string | null;
  intentEpoch: number;
  planRevision: number;
  event: MainAgentReActBudgetExhausted;
}) {
  const actionKey = input.event.pendingToolName ?? "main_agent_tool_loop";
  const inputHash = hashRunInput({
    projectId: input.projectId,
    taskBriefDigest: input.taskBriefDigest,
    intentEpoch: input.intentEpoch,
    planRevision: input.planRevision,
    actionKey,
    toolRoundsUsed: input.event.toolRoundsUsed,
    maxToolRounds: input.event.maxToolRounds,
    observationRefs: input.event.observationIds,
  });
  const observation = createAgentObservation({
    projectId: input.projectId,
    source: "budget",
    status: "blocked",
    actionKey,
    inputHash,
    reasonCodes: [input.event.reason, "retry_budget_exhausted"],
    reportRefs: [],
    targetLocators: [],
    responsibleStage: "main_agent_control_loop",
    minimalNextAction: "pause",
    teacherSafeSummary: roundBudgetPauseSummary,
  });
  const checkpoint = createRunCheckpoint({
    projectId: input.projectId,
    planVersion: input.planRevision,
    reason: "budget_exhausted",
    actionKey,
    inputHash,
    observationRefs: [...new Set([...input.event.observationIds, observation.observationId])],
  });

  return { observation, checkpoint };
}

export function mainAgentRoundBudgetPauseSummary() {
  return roundBudgetPauseSummary;
}
