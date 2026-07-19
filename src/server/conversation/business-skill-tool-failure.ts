import { randomUUID } from "node:crypto";

import { createValidationReport, validationDomainForCapability } from "@/server/contracts/contract-validator";
import { resolveRuntimeContract } from "@/server/contracts/runtime-contract";
import { createAgentObservation, type AgentObservation } from "@/server/conversation/react-control";
import { BusinessToolSkillOutputContractError } from "@/server/skills/business-tool-skill-output-contract";
import type { BusinessToolSkillContext } from "@/server/skills/business-tool-skill-runtime";
import { getToolDefinition } from "@/server/tools/tool-registry";

import { createControlPlaneStore } from "./control-plane-store";
import type { ExecutionEnvelope } from "./task-contract";

type ControlPlaneStore = ReturnType<typeof createControlPlaneStore>;

export async function persistBusinessSkillRuntimeFailure(input: {
  controlPlaneStore: ControlPlaneStore;
  invocationId: string;
  executionEnvelope: ExecutionEnvelope;
  triggerMessageId: string;
  toolName: string;
  reasonCode: string;
  nextAction: AgentObservation["minimalNextAction"];
}) {
  const runtimeContract = resolveRuntimeContract(getToolDefinition(input.toolName));
  const observation = createAgentObservation({
    projectId: input.executionEnvelope.projectId,
    source: "validation",
    status: "failed",
    actionKey: input.toolName,
    inputHash: input.executionEnvelope.idempotencyKey,
    reasonCodes: [input.reasonCode],
    reportRefs: [],
    targetLocators: [{ kind: "tool", toolId: input.toolName }],
    responsibleStage: "business_skill_runtime",
    minimalNextAction: input.nextAction,
    teacherSafeSummary: "这一步的业务能力没有完成加载，系统已保存恢复信息且没有执行生成。",
  });
  const validationReport = createValidationReport({
    reportId: randomUUID(),
    createdAt: new Date().toISOString(),
    domain: validationDomainForCapability(runtimeContract.capabilityId),
    stage: runtimeContract.capabilityId,
    target: { kind: "tool_invocation", targetId: input.invocationId },
    contract: { id: runtimeContract.id, version: runtimeContract.version },
    inputHash: input.executionEnvelope.idempotencyKey,
    intentEpoch: input.executionEnvelope.intentEpoch,
    overallStatus: "failed",
    gates: [{
      gateId: "business_skill_load",
      validatorId: "business_skill_runtime",
      validatorVersion: "v1",
      status: "failed",
      evidenceRefs: [],
      locators: [{ kind: "tool", toolId: input.toolName }],
      responsibleStage: "business_skill_runtime",
      reasonCode: input.reasonCode,
    }],
  });
  await input.controlPlaneStore.commitToolFailure({
    invocationId: input.invocationId,
    validationReport,
    observation: {
      observationId: observation.observationId,
      status: observation.status,
      reasonCodes: observation.reasonCodes,
      payload: structuredClone(observation) as unknown as Record<string, unknown>,
    },
    event: failureEvent(input, observation.observationId, validationReport.reportId),
  });
  return { observation, validationReport };
}

export async function persistBusinessSkillOutputFailure(input: {
  controlPlaneStore: ControlPlaneStore;
  invocationId: string;
  executionEnvelope: ExecutionEnvelope;
  triggerMessageId: string;
  toolName: string;
  businessSkillContext: BusinessToolSkillContext;
  error: unknown;
  generationJobId?: string;
  generationInputHash?: string;
}) {
  const reasonCode = input.error instanceof BusinessToolSkillOutputContractError
    ? input.error.reasonCode
    : "formal_skill_output_validation_failed";
  const validationErrors = input.error instanceof BusinessToolSkillOutputContractError
    ? sanitizeFormalSkillValidationErrors(input.error.validationErrors)
    : [];
  const formalContract = input.businessSkillContext.semanticSlice.contracts.skill?.produces[0];
  const runtimeContract = resolveRuntimeContract(getToolDefinition(input.toolName));
  const observation = createAgentObservation({
    projectId: input.executionEnvelope.projectId,
    source: "validation",
    status: "failed",
    actionKey: input.toolName,
    inputHash: input.executionEnvelope.idempotencyKey,
    reasonCodes: [reasonCode],
    reportRefs: [],
    targetLocators: [{ kind: "tool", toolId: input.toolName }],
    responsibleStage: "business_skill_output",
    minimalNextAction: "repair_upstream",
    teacherSafeSummary: "生成结果没有通过当前业务交付合同，我没有保存这份结果，并已把具体问题交回智能体调整。",
  });
  const validationReport = createValidationReport({
    reportId: randomUUID(),
    createdAt: new Date().toISOString(),
    domain: validationDomainForCapability(runtimeContract.capabilityId),
    stage: runtimeContract.capabilityId,
    target: { kind: "tool_invocation", targetId: input.invocationId },
    contract: { id: runtimeContract.id, version: runtimeContract.version },
    inputHash: input.generationInputHash ?? input.executionEnvelope.idempotencyKey,
    intentEpoch: input.executionEnvelope.intentEpoch,
    overallStatus: "failed",
    gates: [{
      gateId: "formal_skill_output_contract",
      validatorId: "business_skill_runtime",
      validatorVersion: "v2",
      status: "failed",
      evidenceRefs: [
        input.businessSkillContext.provenance.entrypointSha256,
        input.businessSkillContext.provenance.bindingPolicyDigest,
        ...input.businessSkillContext.provenance.references.map((reference) => reference.sha256),
      ],
      locators: [{ kind: "tool", toolId: input.toolName }],
      responsibleStage: "business_skill_output",
      reasonCode,
    }],
  });
  await input.controlPlaneStore.commitToolFailure({
    invocationId: input.invocationId,
    ...(input.generationJobId ? {
      generationJob: {
        jobId: input.generationJobId,
        status: "failed" as const,
        errorMessage: observation.teacherSafeSummary,
      },
    } : {}),
    validationReport,
    observation: {
      observationId: observation.observationId,
      status: observation.status,
      reasonCodes: observation.reasonCodes,
      payload: {
        ...structuredClone(observation),
        validationErrors,
        skillName: input.businessSkillContext.skillName,
        skillVersion: input.businessSkillContext.skillVersion,
        ...(formalContract ? { formalContract: structuredClone(formalContract) } : {}),
      } as unknown as Record<string, unknown>,
    },
    event: failureEvent(input, observation.observationId, validationReport.reportId, reasonCode),
  });
  return { observation, validationReport };
}

function failureEvent(
  input: { executionEnvelope: ExecutionEnvelope; triggerMessageId: string },
  observationId: string,
  validationReportId: string,
  reasonCode?: string,
) {
  return {
    eventId: randomUUID(),
    projectId: input.executionEnvelope.projectId,
    taskId: input.executionEnvelope.taskId,
    runId: `turn:${input.triggerMessageId}`,
    intentEpoch: input.executionEnvelope.intentEpoch,
    kind: "tool_observed" as const,
    visibility: "internal" as const,
    occurredAt: new Date().toISOString(),
    payload: { observationId, validationReportId, ...(reasonCode ? { reasonCode } : {}), status: "failed" },
  };
}

function sanitizeFormalSkillValidationErrors(errors: string[]) {
  return [...new Set(errors
    .map((error) => String(error).replace(/\s+/g, " ").trim())
    .filter((error) => error.length > 0 && error.length <= 200)
    .filter((error) => !/[A-Z]:\\|\/Users\/|https?:\/\/|api[_-]?key|token|secret|credential/i.test(error))
    .slice(0, 20))];
}
