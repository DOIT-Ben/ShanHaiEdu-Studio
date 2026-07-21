import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseDotenv } from "dotenv";

export type ModelGatewayCapability =
  | "agent"
  | "text"
  | "image"
  | "ppt_image"
  | "video"
  | "tts";

export type ModelGatewayConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  voiceId?: string;
};

type GatewayEnv = Record<string, string | undefined>;

const modelNames: Record<ModelGatewayCapability, string> = {
  agent: "MODEL_GATEWAY_AGENT_MODEL",
  text: "MODEL_GATEWAY_TEXT_MODEL",
  image: "MODEL_GATEWAY_IMAGE_MODEL",
  ppt_image: "MODEL_GATEWAY_PPT_IMAGE_MODEL",
  video: "MODEL_GATEWAY_VIDEO_MODEL",
  tts: "MODEL_GATEWAY_TTS_MODEL",
};

const defaults: Partial<Record<ModelGatewayCapability, string>> = {
  agent: "gpt-5.6",
  text: "deepseek",
  image: "image-2",
  video: "video-grok",
  tts: "speech-2.8-hd",
};

export function resolveModelGatewayConfig(
  capability: ModelGatewayCapability,
  env: GatewayEnv = process.env,
): ModelGatewayConfig {
  const values = readGatewayValues(env);
  const baseUrl = values.MODEL_GATEWAY_BASE_URL?.trim();
  const apiKey = values.MODEL_GATEWAY_API_KEY?.trim();
  const model = values[modelNames[capability]]?.trim() || defaults[capability];
  if (!baseUrl || !apiKey || !model) {
    throw new ModelGatewayConfigError("MODEL_GATEWAY_CONFIG_MISSING", capability);
  }
  let parsedBaseUrl: URL;
  try { parsedBaseUrl = new URL(baseUrl); } catch { throw new ModelGatewayConfigError("MODEL_GATEWAY_BASE_URL_INVALID", capability); }
  if (parsedBaseUrl.protocol !== "https:" || parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.search || parsedBaseUrl.hash || !["", "/", "/v1"].includes(parsedBaseUrl.pathname.replace(/\/+$/, "") || "/")) {
    throw new ModelGatewayConfigError("MODEL_GATEWAY_BASE_URL_INVALID", capability);
  }
  const normalizedBaseUrl = `${parsedBaseUrl.origin}${parsedBaseUrl.pathname.replace(/\/+$/, "") || ""}`;
  return Object.freeze({
    baseUrl: normalizedBaseUrl.endsWith("/v1") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`,
    apiKey,
    model,
    ...(capability === "tts"
      ? { voiceId: values.MODEL_GATEWAY_TTS_VOICE_ID?.trim() || "male-qn-qingse" }
      : {}),
  });
}

export function resolveModelGatewayValueBag(
  capability: ModelGatewayCapability,
  env: GatewayEnv = process.env,
) {
  const config = resolveModelGatewayConfig(capability, env);
  const modelKey = modelNames[capability];
  const values = new Map<string, string>([
    ["MODEL_GATEWAY_BASE_URL", config.baseUrl],
    ["MODEL_GATEWAY_API_KEY", config.apiKey],
    [modelKey, config.model],
    ...(config.voiceId ? [["MODEL_GATEWAY_TTS_VOICE_ID", config.voiceId] as const] : []),
  ]);
  return Object.freeze({
    capability,
    source: "model_gateway_env" as const,
    has: (name: string) => values.has(name),
    get: (name: string) => values.get(name),
    require: (name: string) => {
      const value = values.get(name);
      if (!value) throw new ModelGatewayConfigError("MODEL_GATEWAY_FIELD_MISSING", capability, name);
      return value;
    },
  });
}

function readGatewayValues(env: GatewayEnv): GatewayEnv {
  const localEnvPath = resolve(".env.local");
  const filePath = env.MODEL_GATEWAY_ENV_FILE?.trim() || (env === process.env && env.NODE_ENV !== "test" && existsSync(localEnvPath) ? localEnvPath : "");
  const firstValues = filePath && existsSync(filePath) ? readGatewayFile(filePath) : {};
  const referencedPath = firstValues.MODEL_GATEWAY_ENV_FILE?.trim();
  const referencedValues = referencedPath && existsSync(referencedPath)
    ? readGatewayFile(referencedPath)
    : {};
  return { ...referencedValues, ...firstValues, ...env };
}

function readGatewayFile(filePath: string): GatewayEnv {
  const raw = readFileSync(resolve(filePath), "utf8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.key === "string" && typeof parsed.url === "string") {
      return {
        MODEL_GATEWAY_API_KEY: parsed.key,
        MODEL_GATEWAY_BASE_URL: parsed.url.replace(/\/+$/, "").endsWith("/v1") ? parsed.url.replace(/\/+$/, "") : `${parsed.url.replace(/\/+$/, "")}/v1`,
      };
    }
  } catch {
    // Fall through to dotenv for ordinary local environment files.
  }
  return parseDotenv(raw);
}

export class ModelGatewayConfigError extends Error {
  constructor(readonly code: string, readonly capability: string, readonly field?: string) {
    super(`${code}:${capability}${field ? `:${field}` : ""}`);
    this.name = "ModelGatewayConfigError";
  }
}
