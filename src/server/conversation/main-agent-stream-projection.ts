import type {
  GptProtocolStreamEvent,
  GptProtocolTelemetry,
  GptProtocolUsage,
} from "@/server/gpt-protocol/types";

export type MainAgentProgressEvent =
  | { type: "response_started" }
  | { type: "text_delta"; delta: string }
  | {
      type: "step_started";
      toolName: string;
      purpose?: string;
      inputSummary?: string[];
      expectedOutput?: string;
    }
  | {
      type: "step_observed";
      toolName: string;
      status: "succeeded" | "failed" | "blocked" | "inconclusive" | "repair" | "needs_input";
      observationId?: string;
      reasonCodes: string[];
      summary?: string;
      nextAction?: string;
      artifactRefs?: Array<{ artifactId: string; kind?: string; version?: number; digest?: string }>;
    }
  | { type: "response_completed"; usage: GptProtocolUsage; telemetry: GptProtocolTelemetry }
  | { type: "response_failed"; summary: string; telemetry: GptProtocolTelemetry };

export type MainAgentProgressSink = (event: MainAgentProgressEvent) => void | Promise<void>;

export function createNaturalLanguageMainAgentStreamProjection(onProgress?: MainAgentProgressSink) {
  return async (event: GptProtocolStreamEvent) => {
    if (!onProgress) return;
    if (event.type === "response_started") {
      await onProgress({ type: "response_started" });
      return;
    }
    if (event.type === "text_delta") {
      if (event.delta) await onProgress({ type: "text_delta", delta: event.delta });
      return;
    }
    await projectTerminalStreamEvent(event, onProgress);
    // Function-call arguments stay internal; Tool state is projected from committed events.
  };
}

export function createStructuredMainAgentStreamProjection(onProgress?: MainAgentProgressSink) {
  const body = new IncrementalAssistantBody();
  return async (event: GptProtocolStreamEvent) => {
    if (!onProgress) return;
    if (event.type === "response_started") {
      body.reset();
      await onProgress({ type: "response_started" });
      return;
    }
    if (event.type === "text_delta") {
      const visibleDelta = body.push(event.delta);
      if (visibleDelta) await onProgress({ type: "text_delta", delta: visibleDelta });
      return;
    }
    await projectTerminalStreamEvent(event, onProgress);
    // Function-call argument deltas are deliberately internal and never projected.
  };
}

async function projectTerminalStreamEvent(event: GptProtocolStreamEvent, onProgress: MainAgentProgressSink) {
  if (event.type === "response_completed") {
    await onProgress({ type: "response_completed", usage: event.usage, telemetry: event.telemetry });
  } else if (event.type === "response_failed") {
    await onProgress({ type: "response_failed", summary: "智能服务请求未完成。", telemetry: event.telemetry });
  }
}

class IncrementalAssistantBody {
  private source = "";
  private emitted = "";

  reset() {
    this.source = "";
    this.emitted = "";
  }

  push(delta: string) {
    this.source += delta;
    const decoded = extractCompleteJsonStringPrefix(this.source, "assistantMessage", "body");
    if (!decoded || decoded.length <= this.emitted.length) return "";
    const addition = decoded.slice(this.emitted.length);
    this.emitted = decoded;
    return addition;
  }
}

function extractCompleteJsonStringPrefix(source: string, objectKey: string, fieldKey: string) {
  const objectIndex = source.indexOf(JSON.stringify(objectKey));
  if (objectIndex < 0) return "";
  const fieldIndex = source.indexOf(JSON.stringify(fieldKey), objectIndex + objectKey.length + 2);
  if (fieldIndex < 0) return "";
  const colonIndex = source.indexOf(":", fieldIndex + fieldKey.length + 2);
  if (colonIndex < 0) return "";
  let quoteIndex = colonIndex + 1;
  while (/\s/.test(source[quoteIndex] ?? "")) quoteIndex += 1;
  if (source[quoteIndex] !== '"') return "";

  let escaped = false;
  let completeEnd = quoteIndex + 1;
  for (let index = quoteIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      if (character === "u") {
        if (!/^[a-f0-9]{4}$/i.test(source.slice(index + 1, index + 5))) break;
        index += 4;
      }
      escaped = false;
      completeEnd = index + 1;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') break;
    completeEnd = index + 1;
  }
  const encoded = source.slice(quoteIndex + 1, completeEnd);
  try {
    return JSON.parse(`"${encoded}"`) as string;
  } catch {
    return "";
  }
}
