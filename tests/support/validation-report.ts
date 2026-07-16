import { validateToolExecutionResult } from "@/server/contracts/contract-validator";
import type { ValidationDomain } from "@/server/quality/quality-types";
import { getToolDefinition } from "@/server/tools/tool-registry";
import type { ToolRouterInput } from "@/server/tools/tool-router";
import type { ToolExecutionResult } from "@/server/tools/tool-types";

export function withPassedValidationReport<T extends Extract<ToolExecutionResult, { status: "succeeded" }>>(
  input: ToolRouterInput,
  result: T,
  options: { stage: string; domain: ValidationDomain; toolId: string },
) {
  const validationReport = validateToolExecutionResult({
    tool: getToolDefinition(options.toolId),
    projectId: input.projectId,
    result,
    inputHash: input.executionInputHash,
    intentEpoch: input.executionIntentEpoch,
  });
  if (
    validationReport.overallStatus !== "passed" ||
    validationReport.stage !== options.stage ||
    validationReport.domain !== options.domain
  ) {
    throw new Error(`Test result does not satisfy ${options.toolId}'s current Runtime Contract.`);
  }

  return {
    ...result,
    validationReport,
  };
}
