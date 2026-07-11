import { getCapabilityDefinition } from "@/server/capabilities/capability-registry";
import type { CapabilityId } from "@/server/capabilities/types";
import { isConfirmedHumanGateAction } from "@/server/guards/human-gate";
import { getToolDefinitionByCapabilityId } from "@/server/tools/tool-registry";

export type PlanGuardStatus = "allowed" | "needs_confirmation" | "blocked";

export function evaluateToolPlan(input: {
  capabilityId: string;
  toolRequiresConfirmation?: boolean;
  hasHumanConfirmation?: boolean;
  expectedActionId?: string;
  confirmedActionId?: string;
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
  const requiresHumanConfirmation =
    tool.requiresHumanGate ||
    tool.adapterKind === "provider" ||
    tool.adapterKind === "package" ||
    tool.sideEffectLevel === "external_call" ||
    tool.sideEffectLevel === "package_write";

  if (requiresHumanConfirmation) {
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
