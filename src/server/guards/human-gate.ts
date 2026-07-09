export function createHumanGateActionId(input: {
  projectId: string;
  capabilityId: string;
  messageId: string;
}): string {
  return `human:${input.projectId}:${input.capabilityId}:${input.messageId}`;
}

export function isConfirmedHumanGateAction(input: { expectedActionId: string; receivedActionId: string }): boolean {
  return input.expectedActionId === input.receivedActionId;
}
