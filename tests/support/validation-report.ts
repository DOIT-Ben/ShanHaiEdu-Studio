import { createValidationReport, hashArtifactDraft } from "@/server/contracts/contract-validator";
import type { ValidationDomain } from "@/server/quality/quality-types";
import type { ToolRouterInput } from "@/server/tools/tool-router";
import type { ToolExecutionResult } from "@/server/tools/tool-types";

export function withPassedValidationReport<T extends Extract<ToolExecutionResult, { status: "succeeded" }>>(
  input: ToolRouterInput,
  result: T,
  options: { stage: string; domain: ValidationDomain; toolId: string },
) {
  return {
    ...result,
    validationReport: createValidationReport({
      reportId: `test-validation:${options.toolId}:${Date.now()}`,
      createdAt: new Date().toISOString(),
      domain: options.domain,
      stage: options.stage,
      target: { kind: "artifact_draft", targetDigest: hashArtifactDraft(result.artifactDraft) },
      contract: { id: `tool:${options.toolId}`, version: "tool-v1" },
      inputHash: input.executionInputHash,
      intentEpoch: input.executionIntentEpoch,
      overallStatus: "passed",
      gates: [],
    }),
  };
}
