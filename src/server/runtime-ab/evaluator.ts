import type { TaskBrief } from "@/server/conversation/task-contract";

import { projectRuntimeAbToolDefinitions } from "./tool-projection";
import type { RuntimeAbRunResult } from "./types";

export type RuntimeAbEvaluation = {
  accepted: boolean;
  fixedOrderRequired: false;
  reasonCodes: string[];
};

export function evaluateRuntimeAbRun(result: RuntimeAbRunResult, taskBrief: TaskBrief): RuntimeAbEvaluation {
  const reasonCodes: string[] = [];
  const candidateToolNames = projectRuntimeAbToolDefinitions().map((tool) => tool.name);
  const selectedCalls = new Set(result.trace.map((entry) => entry.callDigest));
  const checkpointOutputs = new Set(result.checkpoint.observations.flatMap((observation) => observation.producedOutputs));

  if (result.adoptionStatus === "not_adopted") reasonCodes.push("runtime_not_adopted");
  if (result.productionEligible !== false) reasonCodes.push("runtime_production_profile_invalid");
  if (result.status !== "completed") reasonCodes.push("runtime_not_completed");
  if (result.checkpoint.taskBriefDigest !== taskBrief.digest) reasonCodes.push("checkpoint_task_mismatch");
  if (result.requestCount > 6) reasonCodes.push("turn_budget_exceeded");
  if (result.trace.some((entry) => !candidateToolNames.includes(entry.toolName))) {
    reasonCodes.push("tool_outside_candidate_set");
  }
  for (const requestedOutput of taskBrief.requestedOutputs) {
    if (!checkpointOutputs.has(requestedOutput)) reasonCodes.push(`missing_output:${requestedOutput}`);
  }
  if (selectedCalls.size !== result.trace.length) reasonCodes.push("duplicate_tool_call");

  return { accepted: reasonCodes.length === 0, fixedOrderRequired: false, reasonCodes };
}
