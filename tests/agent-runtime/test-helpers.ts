import type { AgentRuntimeResult, AgentRuntimeSucceededResult } from "../../src/server/agent-runtime/types";

export function expectSucceeded(result: AgentRuntimeResult): AgentRuntimeSucceededResult {
  if (result.status !== "succeeded") {
    throw new Error(`Expected succeeded runtime result, received ${result.status}`);
  }

  return result;
}
