export const MODEL_GATEWAY_SMOKE_RECEIPT_PATH: string;
export const MODEL_GATEWAY_SMOKE_RECEIPT_SCHEMA: string;
export const MODEL_GATEWAY_MODELS: Readonly<Record<"agent" | "text" | "image" | "video" | "tts", string>>;

export function verifyModelGatewaySmokeReceipt(options?: {
  root?: string;
  now?: Date | string | number;
  maxAgeHours?: number;
}): {
  ok: true;
  passed: true;
  status: "passed";
  matchedPaths: string[];
  verifiedAt: string;
  receiptPath: string;
};

export function gatewayConfigDigest(configs: Record<"agent" | "text" | "image" | "video" | "tts", {
  apiKey: string;
  baseUrl: string;
  model: string;
}>): string;
