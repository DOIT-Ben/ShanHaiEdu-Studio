import type { GenerationIntensity } from "./generation-intensity-policy";

export function createGenerationIntensityConfirmationAction(input: {
  projectId: string;
  expectedVersion: number;
  target: GenerationIntensity;
}) {
  return `intensity:${encodeURIComponent(input.projectId)}:${input.expectedVersion}:${input.target}`;
}

export function isValidGenerationIntensityConfirmationAction(input: {
  actionId: unknown;
  projectId: string;
  expectedVersion: number;
  target: GenerationIntensity;
}) {
  return input.actionId === createGenerationIntensityConfirmationAction(input);
}
