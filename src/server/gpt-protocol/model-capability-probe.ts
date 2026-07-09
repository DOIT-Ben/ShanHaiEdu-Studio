import type { GptProviderCapabilityStatus } from "./types";

export type GptProviderCapabilityProbeInput = {
  responsesAvailable?: boolean;
  structuredOutputAvailable?: boolean;
  textOutputAvailable?: boolean;
  chatCompletionsAvailable?: boolean;
};

export function classifyGptProviderCapability(input: GptProviderCapabilityProbeInput): GptProviderCapabilityStatus {
  if (input.responsesAvailable && input.structuredOutputAvailable && input.textOutputAvailable) {
    return "responses_full";
  }

  if (input.responsesAvailable && input.textOutputAvailable) {
    return "responses_text_only";
  }

  if (input.chatCompletionsAvailable) {
    return "chat_completions_only";
  }

  return "unavailable";
}
