import { getCapabilityDefinition } from "@/server/capabilities/capability-registry";
import type { CapabilityId } from "@/server/capabilities/types";
import { isConfirmedHumanGateAction } from "@/server/guards/human-gate";
import { getToolDefinitionByCapabilityId } from "@/server/tools/tool-registry";
import { actionRiskForTool, evaluateActionPolicy } from "@/server/guards/action-policy";
import type { IntentGrant } from "@/server/conversation/task-contract";

export type PlanGuardStatus = "allowed" | "needs_confirmation" | "blocked";

export function evaluateToolPlan(input: {
  capabilityId: string;
  toolRequiresConfirmation?: boolean;
  hasHumanConfirmation?: boolean;
  expectedActionId?: string;
  confirmedActionId?: string;
  intentGrant?: IntentGrant;
  externalProviderCallsUsed?: number;
  expectedScope?: Pick<IntentGrant, "projectId" | "intentEpoch" | "intensity">;
}): { status: PlanGuardStatus; reason: string } {
  let capability;

  try {
    capability = getCapabilityDefinition(input.capabilityId as CapabilityId);
  } catch {
    return {
      status: "blocked",
      reason: `Unknown capability: ${input.capabilityId}`,
    };
  }

  const tool = getToolDefinitionByCapabilityId(capability.id);
  const actionRisk = actionRiskForTool(tool);
  const taskGrantDecision = evaluateActionPolicy({
    risk: actionRisk,
    intentGrant: input.intentGrant,
    externalProviderCallsUsed: input.externalProviderCallsUsed,
    expectedScope: input.expectedScope,
  });
  const legacyInternalWithoutGrant = !input.intentGrant &&
    actionRisk === "internal" &&
    tool.adapterKind === "internal_capability" &&
    !tool.requiresHumanGate;

  if (!legacyInternalWithoutGrant && taskGrantDecision.kind !== "allow") {
    const hasConfirmedAction =
      input.hasHumanConfirmation === true &&
      typeof input.expectedActionId === "string" &&
      typeof input.confirmedActionId === "string" &&
      input.expectedActionId.startsWith("human:") &&
      input.expectedActionId.includes(`:${capability.id}:`) &&
      isConfirmedHumanGateAction({ expectedActionId: input.expectedActionId, receivedActionId: input.confirmedActionId });

    if (!hasConfirmedAction) {
      return {
        status: "needs_confirmation",
        reason: `Capability ${capability.id} requires human confirmation before execution.`,
      };
    }
  }

  return {
    status: "allowed",
    reason: `Capability ${capability.id} is allowed by PlanGuard.`,
  };
}
