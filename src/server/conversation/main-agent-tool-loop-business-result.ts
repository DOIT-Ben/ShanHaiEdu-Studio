import { randomUUID } from "node:crypto";

import type { Artifact } from "@/generated/prisma/client";
import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { BusinessToolSkillOutputContractError } from "@/server/skills/business-tool-skill-output-contract";
import type {
  BusinessToolSkillContext,
  BusinessToolSkillResultValidation,
} from "@/server/skills/business-tool-skill-runtime";
import type { MainAgentToolDispatchResult } from "@/server/tools/main-agent-tool-dispatcher";
import type { MainAgentToolDefinition } from "@/server/tools/main-agent-tool-registry";
import type { ArtifactRecord } from "@/server/workbench/types";

import { persistBusinessSkillOutputFailure } from "./business-skill-tool-failure";
import type { MainAgentReActDispatchResult } from "./main-agent-controlled-react-loop";
import type { PreparedMainAgentToolExecution } from "./main-agent-tool-loop-execution";
import type { MainAgentToolLoopCall, MainAgentToolLoopContext } from "./main-agent-tool-loop-types";
import {
  bindFailureValidationReportToInvocation,
  mapCommittedArtifact,
  observationForContinuation,
  observationStatusForModel,
  safeFailureDetails,
  validationFailureDetails,
} from "./main-agent-tool-loop-observations";
import { appendAgentObservationMetadata, createAgentObservation } from "./react-control";
import type { ExecutionEnvelope } from "./task-contract";

type BusinessDispatch = Extract<MainAgentToolDispatchResult, { kind: "business_tool" }>;
type ProviderGeneration = PreparedMainAgentToolExecution["providerGeneration"];
type ProviderBudgetEvent = BusinessDispatch["result"]["budgetEvent"] | undefined;

export async function handleBusinessToolResult(input: {
  context: MainAgentToolLoopContext;
  definition: MainAgentToolDefinition;
  call: MainAgentToolLoopCall;
  executionEnvelope: ExecutionEnvelope | undefined;
  invocationId: string;
  providerGeneration: ProviderGeneration;
  providerBudgetEvent: ProviderBudgetEvent;
  businessSkillContext: BusinessToolSkillContext | undefined;
  dispatch: BusinessDispatch;
}): Promise<MainAgentReActDispatchResult> {
  if (input.dispatch.result.status !== "succeeded") return commitBusinessToolFailure(input);
  const formalSkillValidation = await validateFormalSkillResult(input);
  if (formalSkillValidation.kind === "handled") return formalSkillValidation.result;
  return commitBusinessToolSuccess(input, formalSkillValidation.validation);
}

async function commitBusinessToolFailure(
  input: Parameters<typeof handleBusinessToolResult>[0],
): Promise<MainAgentReActDispatchResult> {
  const { context, call, invocationId, providerGeneration, providerBudgetEvent, dispatch } = input;
  const { input: loopInput, state, controlPlaneStore } = context;
  if (dispatch.result.status === "succeeded") throw new Error("Business Tool failure handler received success.");
  const primaryReason = dispatch.result.status === "needs_input"
    ? "missing_inputs"
    : dispatch.result.errorCategory ?? "tool_failed";
  const failureDetails = [...new Set([
    ...(dispatch.result.observation.reasonCode ? [dispatch.result.observation.reasonCode] : []),
    ...(dispatch.result.observation.reasonDetails ?? []),
    ...safeFailureDetails(dispatch.result.observation.internalReasonSanitized),
    ...validationFailureDetails(dispatch.result.validationReport),
  ])];
  const reasonCodes = [...new Set([primaryReason, ...failureDetails])];
  const invocationValidationReport = bindFailureValidationReportToInvocation(
    dispatch.result.validationReport,
    invocationId,
    loopInput.project.intentEpoch ?? 0,
  );
  const reportRefs = invocationValidationReport
    ? [{ id: invocationValidationReport.reportId, kind: "validation" as const, digest: invocationValidationReport.reportDigest }]
    : [];
  const observation = createAgentObservation({
    projectId: loopInput.project.id,
    source: "tool",
    status: dispatch.result.status === "needs_input" ? "inconclusive" : "failed",
    actionKey: dispatch.result.toolId,
    inputHash: hashRunInput({ toolId: dispatch.result.toolId, call: call.arguments }),
    reasonCodes,
    reportRefs,
    targetLocators: [],
    responsibleStage: dispatch.result.capabilityId,
    minimalNextAction: "repair_upstream",
    teacherSafeSummary: dispatch.result.status === "needs_input"
      ? dispatch.result.assistantPrompt
      : dispatch.result.observation.teacherSafeSummary,
  });
  await controlPlaneStore.commitToolFailure({
    invocationId,
    ...(providerGeneration ? {
      generationJob: {
        jobId: providerGeneration.active.job.id,
        status: "errorCategory" in dispatch.result && dispatch.result.errorCategory === "submission_unknown"
          ? "submission_unknown" as const
          : "failed" as const,
        errorMessage: dispatch.result.observation.teacherSafeSummary,
      },
    } : {}),
    observation: {
      observationId: observation.observationId,
      status: observation.status,
      reasonCodes: observation.reasonCodes,
      payload: {
        ...structuredClone(observation),
        ...(providerBudgetEvent ? { budgetEvent: structuredClone(providerBudgetEvent) } : {}),
      } as unknown as Record<string, unknown>,
    },
    ...(invocationValidationReport ? { validationReport: invocationValidationReport } : {}),
    event: toolObservedEvent(context, observation.observationId, observation.status),
  });
  state.currentMetadata = appendAgentObservationMetadata(state.currentMetadata, observation);
  await persistMessageMetadata(context);
  return {
    status: observationStatusForModel(observation),
    observation: observationForContinuation(observation, {
      reportRefs,
      nextAction: "replan",
      reasonCodes,
      summary: dispatch.result.status === "needs_input"
        ? `${observation.teacherSafeSummary} missing:${dispatch.result.missingInputs.join(",")}`
        : observation.teacherSafeSummary,
    }),
  };
}

async function validateFormalSkillResult(
  input: Parameters<typeof handleBusinessToolResult>[0],
): Promise<
  | { kind: "ready"; validation: BusinessToolSkillResultValidation | undefined }
  | { kind: "handled"; result: MainAgentReActDispatchResult }
> {
  const { context, definition, invocationId, executionEnvelope, providerGeneration, businessSkillContext, dispatch } = input;
  if (dispatch.result.status !== "succeeded" || businessSkillContext?.semanticSlice.bindingMode !== "formal_contract") {
    return { kind: "ready", validation: undefined };
  }
  const { input: loopInput, state, controlPlaneStore } = context;
  try {
    if (!loopInput.businessSkillRuntime) {
      throw new BusinessToolSkillOutputContractError(
        "formal_skill_output_contract_mismatch",
        "Formal Skill Runtime is unavailable for output validation.",
      );
    }
    const validation = await loopInput.businessSkillRuntime.validateSelectedToolResult({
      businessToolName: definition.id,
      context: businessSkillContext,
      result: dispatch.result,
    });
    if (validation.status !== "passed") {
      throw new BusinessToolSkillOutputContractError(
        "formal_skill_output_contract_mismatch",
        "Formal Skill output validation did not produce passing evidence.",
      );
    }
    return { kind: "ready", validation };
  } catch (error) {
    if (!executionEnvelope || typeof definition.internalToolId !== "string") throw error;
    const failure = await persistBusinessSkillOutputFailure({
      controlPlaneStore,
      invocationId,
      executionEnvelope,
      triggerMessageId: loopInput.triggerMessage.id,
      toolName: definition.internalToolId,
      businessSkillContext,
      error,
      ...(providerGeneration ? {
        generationJobId: providerGeneration.active.job.id,
        generationInputHash: providerGeneration.active.job.inputHash ?? undefined,
      } : {}),
    });
    state.currentMetadata = appendAgentObservationMetadata(state.currentMetadata, failure.observation);
    await persistMessageMetadata(context);
    return {
      kind: "handled",
      result: {
        status: "failed",
        observation: observationForContinuation(failure.observation, {
          nextAction: "replan",
          reportRefs: [{
            id: failure.validationReport.reportId,
            kind: "validation",
            digest: failure.validationReport.reportDigest,
          }],
        }),
      },
    };
  }
}

async function commitBusinessToolSuccess(
  input: Parameters<typeof handleBusinessToolResult>[0],
  formalSkillValidation: BusinessToolSkillResultValidation | undefined,
): Promise<MainAgentReActDispatchResult> {
  const { context, definition, call, invocationId, providerGeneration, providerBudgetEvent, dispatch } = input;
  const { input: loopInput, state, controlPlaneStore } = context;
  if (dispatch.result.status !== "succeeded") throw new Error("Business Tool success handler received failure.");
  const observationId = randomUUID();
  const committed = await controlPlaneStore.commitToolResult({
    invocationId,
    ...(providerGeneration ? { generationJobId: providerGeneration.active.job.id } : {}),
    artifact: {
      nodeKey: dispatch.result.artifactDraft.nodeKey as ArtifactRecord["nodeKey"],
      kind: dispatch.result.artifactDraft.kind as ArtifactRecord["kind"],
      title: dispatch.result.artifactDraft.title,
      status: "needs_review",
      summary: dispatch.result.artifactDraft.summary,
      markdownContent: dispatch.result.artifactDraft.markdownContent ?? "",
      structuredContent: dispatch.result.artifactDraft.structuredContent,
      validationReport: dispatch.result.validationReport,
    },
    observation: {
      observationId,
      status: "succeeded",
      reasonCodes: ["business_tool_succeeded"],
      payload: {
        actionKey: dispatch.result.toolId,
        inputHash: hashRunInput({ toolId: dispatch.result.toolId, call: call.arguments }),
        summary: dispatch.result.assistantSummary,
        ...(formalSkillValidation?.status === "passed"
          ? { businessSkillContractValidation: structuredClone(formalSkillValidation) }
          : {}),
        ...(providerBudgetEvent ? { budgetEvent: structuredClone(providerBudgetEvent) } : {}),
      },
    },
    event: {
      eventId: randomUUID(),
      projectId: loopInput.project.id,
      taskId: loopInput.taskBrief!.taskId,
      runId: `turn:${loopInput.triggerMessage.id}`,
      intentEpoch: loopInput.project.intentEpoch ?? 0,
      kind: "artifact_committed",
      visibility: "internal",
      occurredAt: new Date().toISOString(),
      payload: { observationId, toolName: definition.internalToolId },
    },
  });
  const artifact = mapCommittedArtifact(committed.artifact as Artifact);
  loopInput.artifacts.push(artifact);
  const observation = createAgentObservation({
    observationId,
    projectId: loopInput.project.id,
    source: "tool",
    status: "succeeded",
    actionKey: dispatch.result.toolId,
    inputHash: hashRunInput({ toolId: dispatch.result.toolId, artifactId: artifact.id }),
    reasonCodes: ["business_tool_succeeded"],
    reportRefs: [],
    targetLocators: [{ kind: "artifact", artifactKind: artifact.kind, artifactId: artifact.id }],
    responsibleStage: dispatch.result.capabilityId,
    minimalNextAction: "continue",
    teacherSafeSummary: dispatch.result.assistantSummary,
  });
  state.currentMetadata = appendAgentObservationMetadata(state.currentMetadata, observation);
  await persistMessageMetadata(context);
  return {
    status: "succeeded",
    observation: observationForContinuation(observation, {
      artifactRefs: [{
        artifactId: artifact.id,
        kind: artifact.kind,
        version: artifact.version,
        digest: hashArtifactDraft({
          nodeKey: artifact.nodeKey,
          kind: artifact.kind,
          title: artifact.title,
          summary: artifact.summary,
          markdownContent: artifact.markdownContent,
          structuredContent: artifact.structuredContent,
        }),
      }],
    }),
  };
}

function toolObservedEvent(
  context: MainAgentToolLoopContext,
  observationId: string,
  status: string,
) {
  return {
    eventId: randomUUID(),
    projectId: context.input.project.id,
    taskId: context.input.taskBrief!.taskId,
    runId: `turn:${context.input.triggerMessage.id}`,
    intentEpoch: context.input.project.intentEpoch ?? 0,
    kind: "tool_observed" as const,
    visibility: "internal" as const,
    occurredAt: new Date().toISOString(),
    payload: { observationId, status },
  };
}

async function persistMessageMetadata(context: MainAgentToolLoopContext) {
  await context.input.service.updateMessageMetadata(
    context.input.project.id,
    context.input.triggerMessage.id,
    context.state.currentMetadata,
  );
}
