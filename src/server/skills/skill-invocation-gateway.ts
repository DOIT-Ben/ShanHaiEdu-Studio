import {
  createPendingDecisionForAction,
  evaluateActionPolicy,
  type ActionRiskKind,
} from "@/server/guards/action-policy";
import {
  executeThroughToolGateway,
  type CurrentToolExecutionScope,
  type ToolGatewayFailureReason,
} from "@/server/tools/tool-execution-gateway";
import type {
  ExecutionEnvelope,
  IntentGrant,
  PendingDecision,
  TaskBrief,
} from "@/server/conversation/task-contract";

import {
  SHANHAI_ARTIFACT_REF_VERSION,
  SHANHAI_SKILL_INVOCATION_VERSION,
  SHANHAI_SKILL_RESULT_VERSION,
  type RegisteredSkill,
  type ShanHaiArtifactRef,
  type SkillCapability,
  type SkillInvocation,
  type SkillNextAction,
  type SkillResult,
  type SkillResultObservation,
  type SkillSideEffect,
} from "./skill-runtime-types";

export type SkillCapabilityBinding = {
  capability: SkillCapability;
  toolName: string;
  available: boolean;
};

export type SkillSelection = {
  selectedBy: "main_agent";
  skillName: string;
  mode: string;
  businessToolName: string;
  businessToolArguments: Record<string, unknown>;
};

export type SkillInvocationOutcome =
  | {
      kind: "candidate_result";
      invocation: SkillInvocation;
      result: SkillResultObservation;
      orchestrationAuthority: "main_agent";
      advisoryNextAction: SkillNextAction;
      promotionEligible: false;
      requiresToolResultCommit: true;
    }
  | {
      kind: "human_gate";
      reasonCode: string;
      pendingDecision: PendingDecision;
    }
  | {
      kind: "blocked";
      reasonCode: SkillGatewayFailureReason;
      missingCapabilities?: string[];
    };

export type SkillGatewayFailureReason =
  | ToolGatewayFailureReason
  | "skill_selection_not_owned_by_main_agent"
  | "skill_business_tool_mismatch"
  | "skill_not_active"
  | "skill_capability_unavailable"
  | "skill_side_effect_not_declared"
  | "skill_business_choice_unresolved"
  | "skill_input_artifact_invalid"
  | "skill_intent_grant_mismatch"
  | "skill_invocation_invalid"
  | "skill_result_invalid"
  | "skill_execution_failed";

export type SkillGatewayInput = {
  selection: SkillSelection;
  taskBrief: TaskBrief;
  intentGrant: IntentGrant;
  executionEnvelope: ExecutionEnvelope;
  current: CurrentToolExecutionScope;
  inputArtifacts: ShanHaiArtifactRef[];
  runId: string;
  invocationId: string;
  humanGateGrants: string[];
  resumeToken?: string | null;
  unresolvedBusinessChoice?: boolean;
  externalProviderCallsUsed?: number;
  executeSkill: (invocation: SkillInvocation, skill: RegisteredSkill) => Promise<SkillResult>;
};

export class SkillInvocationGateway {
  private readonly bindings: Map<string, SkillCapabilityBinding>;

  constructor(private readonly dependencies: {
    resolveSkill: (skillName: string) => RegisteredSkill;
    capabilityBindings: SkillCapabilityBinding[];
    resolveBusinessSkillName: (toolName: string) => string | undefined;
    resolveBusinessToolSideEffects: (toolName: string) => SkillSideEffect[];
  }) {
    this.bindings = new Map(dependencies.capabilityBindings.map((binding) => [binding.capability, { ...binding }]));
    if (this.bindings.size !== dependencies.capabilityBindings.length) {
      throw new Error("SkillInvocationGateway requires unique capability bindings.");
    }
  }

  async invoke(input: SkillGatewayInput): Promise<SkillInvocationOutcome> {
    if (input.selection.selectedBy !== "main_agent") {
      return blocked("skill_selection_not_owned_by_main_agent");
    }
    const expectedSkillName = this.dependencies.resolveBusinessSkillName(input.selection.businessToolName);
    if (!expectedSkillName || expectedSkillName !== input.selection.skillName) {
      return blocked("skill_business_tool_mismatch");
    }

    let skill: RegisteredSkill;
    try {
      skill = this.dependencies.resolveSkill(input.selection.skillName);
    } catch {
      return blocked("skill_not_active");
    }
    if (skill.status !== "active" || skill.name !== input.selection.skillName) {
      return blocked("skill_not_active");
    }
    try {
      const gatewayResult = await executeThroughToolGateway({
        request: {
          toolName: input.selection.businessToolName,
          projectId: input.current.projectId,
          intentEpoch: input.current.intentEpoch,
          arguments: input.selection.businessToolArguments,
        },
        current: input.current,
        executionEnvelope: input.executionEnvelope,
        execute: async (): Promise<SkillInvocationOutcome> => {
          if (!sameIntentGrant(input.intentGrant, input.executionEnvelope.intentGrant)) {
            return blocked("skill_intent_grant_mismatch");
          }
          const missingCapabilities = skill.capabilities.required.filter((capability) => {
            const binding = this.bindings.get(capability);
            return !binding?.available || !binding.toolName.trim();
          });
          if (missingCapabilities.length) {
            return {
              kind: "blocked",
              reasonCode: "skill_capability_unavailable",
              missingCapabilities: [...missingCapabilities].sort(),
            };
          }
          if (!input.inputArtifacts.every(isFormalInputArtifact)) {
            return blocked("skill_input_artifact_invalid");
          }
          const actualSideEffects = unique(
            this.dependencies.resolveBusinessToolSideEffects(input.selection.businessToolName),
          );
          if (actualSideEffects.some((sideEffect) => !skill.sideEffects.includes(sideEffect))) {
            return blocked("skill_side_effect_not_declared");
          }
          if (input.unresolvedBusinessChoice) {
            return blocked("skill_business_choice_unresolved");
          }
          const risk = highestRisk(actualSideEffects);
          const policy = evaluateActionPolicy({
            risk,
            intentGrant: input.intentGrant,
            expectedScope: {
              projectId: input.current.projectId,
              intentEpoch: input.current.intentEpoch,
              intensity: input.current.intensity,
            },
            externalProviderCallsUsed: input.externalProviderCallsUsed,
          });
          if (policy.kind === "human_gate") {
            return {
              kind: "human_gate",
              reasonCode: policy.reason,
              pendingDecision: createPendingDecisionForAction({
                action: risk,
                decision: policy,
                actionId: `skill-${input.invocationId}`,
                actorUserId: input.current.actorUserId,
                projectId: input.current.projectId,
                taskId: input.current.taskId,
                intentEpoch: input.current.intentEpoch,
                planId: `plan-${input.current.taskId}-${input.current.planRevision}`,
                intentGrant: input.intentGrant,
              }),
            };
          }
          const grantedCapabilities = unique([
            ...skill.capabilities.required,
            ...skill.capabilities.optional.filter((capability) => this.bindings.get(capability)?.available),
          ]).sort();
          const invocation = createSkillInvocation({ input, skill, actualSideEffects, grantedCapabilities });
          if (!isValidSkillInvocation(invocation)) return blocked("skill_invocation_invalid");
          const result = await input.executeSkill(invocation, structuredClone(skill));
          if (!isValidSkillResult(result, invocation, skill)) return blocked("skill_result_invalid");
          const { nextAction, ...resultObservation } = structuredClone(result);
          return {
            kind: "candidate_result",
            invocation,
            result: resultObservation,
            orchestrationAuthority: "main_agent",
            advisoryNextAction: nextAction,
            promotionEligible: false,
            requiresToolResultCommit: true,
          };
        },
      });
      if (isToolGatewayFailure(gatewayResult)) return blocked(gatewayResult.reasonCode);
      return gatewayResult;
    } catch {
      return blocked("skill_execution_failed");
    }
  }
}

function isValidSkillInvocation(invocation: SkillInvocation): boolean {
  const ids = [invocation.invocationId, invocation.runId, invocation.projectId, invocation.skill.mode];
  if (!ids.every((value) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value))) return false;
  if (!/^shanhai-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(invocation.skill.name)) return false;
  if (!/^\d+\.\d+$/.test(invocation.skill.version) || !invocation.objective.trim()) return false;
  if (!invocation.constraints.contentBoundary.trim() || invocation.constraints.language.length < 2) return false;
  if (new Set(invocation.inputs.map((artifact) => artifact.artifactId)).size !== invocation.inputs.length) return false;
  if (new Set(invocation.authorization.grantedCapabilities).size !== invocation.authorization.grantedCapabilities.length) return false;
  if (new Set(invocation.authorization.allowedSideEffects).size !== invocation.authorization.allowedSideEffects.length) return false;
  if (new Set(invocation.authorization.humanGateGrants).size !== invocation.authorization.humanGateGrants.length) return false;
  return invocation.authorization.humanGateGrants.every((grant) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(grant));
}

function createSkillInvocation(input: {
  input: SkillGatewayInput;
  skill: RegisteredSkill;
  actualSideEffects: SkillSideEffect[];
  grantedCapabilities: SkillCapability[];
}): SkillInvocation {
  return {
    schemaVersion: SHANHAI_SKILL_INVOCATION_VERSION,
    invocationId: input.input.invocationId,
    runId: input.input.runId,
    projectId: input.input.taskBrief.projectId,
    skill: {
      name: input.skill.name,
      version: input.skill.version,
      mode: input.input.selection.mode,
    },
    objective: input.input.taskBrief.goal,
    inputs: input.input.inputArtifacts.map((artifact) => structuredClone(artifact)),
    constraints: {
      contentBoundary: input.input.taskBrief.constraints.join("；") || input.input.taskBrief.goal,
      mustNotPreteach: [...input.input.taskBrief.excludedOutputs],
      language: "zh-CN",
    },
    authorization: {
      grantedCapabilities: [...input.grantedCapabilities],
      allowedSideEffects: [...input.actualSideEffects].sort(),
      humanGateGrants: unique(input.input.humanGateGrants).sort(),
    },
    resumeToken: input.input.resumeToken ?? null,
  };
}

function highestRisk(sideEffects: SkillSideEffect[]): ActionRiskKind {
  if (sideEffects.includes("destructive_write")) return "destructive";
  if (sideEffects.includes("external_publish")) return "publish";
  if (sideEffects.includes("external_generation")) return "external_generation";
  return "internal";
}

function isFormalInputArtifact(artifact: ShanHaiArtifactRef): boolean {
  return artifact.schemaVersion === SHANHAI_ARTIFACT_REF_VERSION
    && Boolean(artifact.artifactId.trim())
    && Boolean(artifact.artifactType.trim())
    && Boolean(artifact.contractVersion.trim())
    && Boolean(artifact.locator.trim())
    && Boolean(artifact.mediaType.trim())
    && (artifact.status === "approved" || artifact.status === "completed");
}

function isValidSkillResult(
  value: unknown,
  invocation: SkillInvocation,
  skill: RegisteredSkill,
): value is SkillResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Partial<SkillResult>;
  if (result.schemaVersion !== SHANHAI_SKILL_RESULT_VERSION
      || result.invocationId !== invocation.invocationId
      || result.runId !== invocation.runId
      || result.skill?.name !== skill.name
      || result.skill.version !== skill.version
      || !isResultStatus(result.status)
      || !Array.isArray(result.artifacts)
      || !Array.isArray(result.messages)
      || !result.messages.length
      || !result.messages.every((message) => Boolean(message?.code?.trim()) && Boolean(message?.text?.trim()))
      || !result.nextAction
      || !isNextAction(result.nextAction.type)
      || !result.nextAction.label?.trim()) return false;
  if (result.status === "completed" && (result.artifacts.length === 0 ||
      result.artifacts.some((artifact) => artifact.status !== "approved" && artifact.status !== "completed"))) {
    return false;
  }
  return result.artifacts.every((artifact) => isResultArtifact(artifact, skill, result.status!));
}

function isResultArtifact(
  artifact: ShanHaiArtifactRef,
  skill: RegisteredSkill,
  resultStatus: SkillResult["status"],
) {
  const declaredOutput = skill.contracts.produces.some((contract) =>
    contract.artifactType === artifact.artifactType && contract.contractVersion === artifact.contractVersion);
  const allowedStatus = resultStatus === "completed"
    ? artifact.status === "approved" || artifact.status === "completed"
    : artifact.status === "draft" || artifact.status === "needs_review";
  return artifact.schemaVersion === SHANHAI_ARTIFACT_REF_VERSION
    && Boolean(artifact.artifactId?.trim())
    && Boolean(artifact.artifactType?.trim())
    && Boolean(artifact.contractVersion?.trim())
    && Boolean(artifact.locator?.trim())
    && Boolean(artifact.mediaType?.trim())
    && artifact.sourceSkill === skill.name
    && artifact.sourceVersion === skill.version
    && declaredOutput
    && allowedStatus
    && (artifact.digest === undefined || artifact.digest === null || /^sha256:[a-f0-9]{64}$/i.test(artifact.digest));
}

function isResultStatus(value: unknown): value is SkillResult["status"] {
  return value === "completed" || value === "needs_input" || value === "needs_review"
    || value === "blocked" || value === "failed";
}

function isNextAction(value: unknown): value is SkillResult["nextAction"]["type"] {
  return value === "none" || value === "provide_input" || value === "review"
    || value === "retry" || value === "continue" || value === "change_route";
}

function isToolGatewayFailure(value: unknown): value is { status: "failed"; reasonCode: ToolGatewayFailureReason } {
  return Boolean(value && typeof value === "object" && (value as { status?: string }).status === "failed"
    && typeof (value as { reasonCode?: unknown }).reasonCode === "string");
}

function sameIntentGrant(left: IntentGrant, right: IntentGrant) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function blocked(reasonCode: SkillGatewayFailureReason): SkillInvocationOutcome {
  return { kind: "blocked", reasonCode };
}
