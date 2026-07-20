import type { GenerationIntensity } from "@/server/generation-intensity/generation-intensity-policy";

type StatusError = Error & { status?: number };

export async function updateGenerationIntensityWithRecovery<TResult>(input: {
  projectId: string;
  intensity: GenerationIntensity;
  confirmationActionId?: string;
  expectedVersion: number;
  update: (projectId: string, intensity: GenerationIntensity, expectedVersion: number, confirmationActionId?: string) => Promise<TResult>;
  apply: (result: TResult) => void;
  reload: (projectId: string) => Promise<unknown>;
}): Promise<TResult> {
  try {
    const result = await input.update(input.projectId, input.intensity, input.expectedVersion, input.confirmationActionId);
    input.apply(result);
    return result;
  } catch (error) {
    if (error instanceof Error && (error as StatusError).status === 409) await input.reload(input.projectId);
    throw error;
  }
}
