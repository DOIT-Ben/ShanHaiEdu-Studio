import OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  createOpenAICompatibleConfigDigest,
  normalizeDigestCredentialSource,
  pickOpenAICompatibleConfig,
  type OpenAICompatibleConfig,
  type OpenAICompatibleEnv,
} from "../src/server/openai-compatible-config";
import {
  writeV1_9AgentBrainHealthEvidence,
  type V1_9AgentBrainHealthEvidence,
} from "../src/server/provider-ledger/v1-9-agent-brain-health-evidence";
import {
  resolveProviderLedgerRuntimeContract,
  type ProviderLedgerPurpose,
} from "../src/server/provider-ledger/provider-ledger-adapter";
import { resolveAgentBrainPurposeForChannel } from "../src/server/provider-ledger/provider-ledger-contract.mjs";

type ProbeEnv = OpenAICompatibleEnv & {
  V1_9_E2E_MANIFEST_PATH?: string;
  V1_9_AGENT_BRAIN_HEALTH_TIMEOUT_MS?: string;
};

type ProbeManifest = {
  schemaVersion: "v1-9-run-manifest.v1";
  status: string;
  providerLock: {
    schemaVersion: "v1-9-provider-lock.v1";
    channel: string;
    model: string;
    endpointCategory: string;
    reasoningEffort: string;
    credentialSource: string;
    configDigest: string;
  } | null;
};

type ProbeClient = {
  responses: {
    create(input: Record<string, unknown>): Promise<{ output_text?: string | null }>;
  };
};

export type V1_9AgentBrainHealthProbeDependencies = {
  resolveConfig(env: ProbeEnv): OpenAICompatibleConfig | null;
  createConfigDigest(config: OpenAICompatibleConfig): string;
  resolvePurpose(input: { env: ProbeEnv; channel: OpenAICompatibleConfig["channel"] }): ProviderLedgerPurpose;
  readActiveRun(input: { cwd: string; env: ProbeEnv }): Promise<{ manifestPath: string; manifest: ProbeManifest }>;
  createClient(options: { apiKey: string; baseURL?: string; timeout: number; maxRetries: 0 }): ProbeClient;
  writeEvidence(evidence: V1_9AgentBrainHealthEvidence, env: ProbeEnv): Promise<{ path: string; record: V1_9AgentBrainHealthEvidence }>;
  writeRunCopy(input: { manifestPath: string; evidence: V1_9AgentBrainHealthEvidence }): Promise<void>;
  now(): Date;
  randomId(): string;
};

export type V1_9AgentBrainHealthProbeReport = {
  schemaVersion: "v1-9-agent-brain-health-probe-report.v1";
  ok: boolean;
  reasonCode: "none" | "v1_9_provider_config_missing" | "v1_9_provider_lock_mismatch" | "v1_9_agent_brain_health_probe_failed";
  evidenceId?: string;
  channel?: string;
  model?: string;
  providerRequestCount: 0 | 1;
  retryCount: 0;
};

export async function runV1_9AgentBrainHealthProbe(input: {
  cwd?: string;
  env?: ProbeEnv;
  dependencies?: Partial<V1_9AgentBrainHealthProbeDependencies>;
} = {}): Promise<V1_9AgentBrainHealthProbeReport> {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const env = input.env ?? process.env;
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const config = dependencies.resolveConfig(env);
  if (!config) return report(false, "v1_9_provider_config_missing", 0);

  const activeRun = await dependencies.readActiveRun({ cwd, env });
  const configDigest = dependencies.createConfigDigest(config);
  if (!matchesProviderLock(config, configDigest, activeRun.manifest)) {
    return report(false, "v1_9_provider_lock_mismatch", 0);
  }
  let purpose: ProviderLedgerPurpose;
  try {
    purpose = dependencies.resolvePurpose({ env, channel: config.channel });
  } catch {
    return report(false, "v1_9_provider_config_missing", 0);
  }

  const testedAt = dependencies.now().toISOString();
  const evidenceId = createEvidenceId(testedAt, dependencies.randomId());
  const timeout = positiveInteger(env.V1_9_AGENT_BRAIN_HEALTH_TIMEOUT_MS, 120_000);
  const client = dependencies.createClient({
    apiKey: config.credential,
    baseURL: config.baseURL,
    timeout,
    maxRetries: 0,
  });
  const baseEvidence = createBaseEvidence({ evidenceId, testedAt, config, configDigest, purpose });

  try {
    const response = await client.responses.create({
      model: config.model,
      reasoning: { effort: config.reasoningEffort },
      instructions: "Return only the requested JSON. Do not include secrets, paths, provider diagnostics, or debug traces.",
      input: "Return a short Chinese health acknowledgement for the ShanHaiEdu Main Agent Responses channel.",
      text: {
        format: {
          type: "json_schema",
          name: "shanhai_v1_9_agent_brain_health",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["ok", "summary"],
            properties: {
              ok: { type: "boolean", const: true },
              summary: { type: "string", minLength: 1, maxLength: 80 },
            },
          },
        },
      },
    });
    const parsed = parseProbeResponse(response.output_text);
    if (!parsed.ok) throw Object.assign(new Error("invalid_probe_response"), { category: "invalid_response" });
    const evidence = { ...baseEvidence, result: "succeeded", errorCategory: "none" } satisfies V1_9AgentBrainHealthEvidence;
    await dependencies.writeEvidence(evidence, env);
    await dependencies.writeRunCopy({ manifestPath: activeRun.manifestPath, evidence });
    return {
      ...report(true, "none", 1),
      evidenceId,
      channel: config.channel,
      model: config.model,
    };
  } catch (error) {
    const evidence = {
      ...baseEvidence,
      result: "failed",
      errorCategory: classifyError(error),
    } satisfies V1_9AgentBrainHealthEvidence;
    await dependencies.writeEvidence(evidence, env);
    await dependencies.writeRunCopy({ manifestPath: activeRun.manifestPath, evidence });
    return {
      ...report(false, "v1_9_agent_brain_health_probe_failed", 1),
      evidenceId,
      channel: config.channel,
      model: config.model,
    };
  }
}

function createBaseEvidence(input: {
  evidenceId: string;
  testedAt: string;
  config: OpenAICompatibleConfig;
  configDigest: string;
  purpose: ProviderLedgerPurpose;
}): Omit<V1_9AgentBrainHealthEvidence, "result" | "errorCategory"> {
  return {
    schemaVersion: "v1-9-agent-brain-health.v2",
    evidenceId: input.evidenceId,
    providerId: "agent_brain",
    capability: "agent_brain",
    purpose: input.purpose,
    channel: input.config.channel,
    model: input.config.model,
    endpointCategory: input.config.endpointCategory,
    reasoningEffort: input.config.reasoningEffort,
    credentialSource: normalizeDigestCredentialSource(input.config.credentialSource),
    configDigest: input.configDigest,
    probe: "single_strict_structured_text",
    testedAt: input.testedAt,
    providerRequestCount: 1,
    maxRetries: 0,
    retryCount: 0,
  };
}

function matchesProviderLock(config: OpenAICompatibleConfig, configDigest: string, manifest: ProbeManifest) {
  const lock = manifest.providerLock;
  if (manifest.schemaVersion !== "v1-9-run-manifest.v1" || manifest.status !== "paused_recovery" || !lock) return false;
  return lock.schemaVersion === "v1-9-provider-lock.v1" &&
    lock.channel === config.channel &&
    lock.model === config.model &&
    lock.endpointCategory === config.endpointCategory &&
    lock.reasoningEffort === config.reasoningEffort &&
    lock.credentialSource === normalizeDigestCredentialSource(config.credentialSource) &&
    lock.configDigest === configDigest;
}

async function defaultReadActiveRun(input: { cwd: string; env: ProbeEnv }) {
  const pointerPath = path.resolve(input.cwd, "test-results", "v1-9-product-e2e-active.json");
  const pointer = JSON.parse(readFileSync(pointerPath, "utf8")) as Record<string, unknown>;
  if (pointer.schemaVersion !== "v1-9-active-run.v1" || pointer.status !== "active") throw new Error("v1_9_active_run_invalid");
  const relativeRunRoot = String(pointer.relativeRunRoot ?? "").replaceAll("\\", "/");
  if (!/^test-results\/v1-9-[a-z0-9._-]+$/i.test(relativeRunRoot) || relativeRunRoot.includes("..")) throw new Error("v1_9_active_run_invalid");
  const manifestPath = input.env.V1_9_E2E_MANIFEST_PATH?.trim()
    ? path.resolve(input.cwd, input.env.V1_9_E2E_MANIFEST_PATH)
    : path.resolve(input.cwd, ...relativeRunRoot.split("/"), "run-manifest.json");
  const expectedManifestPath = path.resolve(input.cwd, ...relativeRunRoot.split("/"), "run-manifest.json");
  if (manifestPath !== expectedManifestPath || !existsSync(manifestPath)) throw new Error("v1_9_active_run_manifest_invalid");
  return { manifestPath, manifest: JSON.parse(readFileSync(manifestPath, "utf8")) as ProbeManifest };
}

async function defaultWriteRunCopy(input: { manifestPath: string; evidence: V1_9AgentBrainHealthEvidence }) {
  const runRoot = path.dirname(input.manifestPath);
  const evidenceRoot = path.resolve(runRoot, "evidence");
  const evidencePath = path.resolve(evidenceRoot, `${input.evidence.evidenceId}.json`);
  const relative = path.relative(runRoot, evidencePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("v1_9_run_evidence_path_escape");
  await mkdir(evidenceRoot, { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(input.evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function parseProbeResponse(output: string | null | undefined) {
  const value = JSON.parse(output ?? "null") as unknown;
  return isRecord(value) && value.ok === true && typeof value.summary === "string" && value.summary.trim().length > 0
    ? { ok: true as const }
    : { ok: false as const };
}

function classifyError(error: unknown): V1_9AgentBrainHealthEvidence["errorCategory"] {
  if (isRecord(error) && error.category === "invalid_response") return "invalid_response";
  const status = isRecord(error) && typeof error.status === "number" ? error.status : undefined;
  if (status === 401 || status === 403) return "authorization";
  if (status === 429) return "rate_limit";
  const name = error instanceof Error ? error.name.toLowerCase() : "";
  if (name.includes("timeout") || name.includes("abort")) return "timeout";
  if (name.includes("connection") || name.includes("network") || name.includes("fetch")) return "transport";
  return status && status >= 500 ? "provider" : "unknown";
}

function createEvidenceId(testedAt: string, randomId: string) {
  const timestamp = testedAt.replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = randomId.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 36) || "probe";
  return `agent-brain-health-${timestamp}-${suffix}`;
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function report(ok: boolean, reasonCode: V1_9AgentBrainHealthProbeReport["reasonCode"], providerRequestCount: 0 | 1): V1_9AgentBrainHealthProbeReport {
  return {
    schemaVersion: "v1-9-agent-brain-health-probe-report.v1",
    ok,
    reasonCode,
    providerRequestCount,
    retryCount: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const defaultDependencies: V1_9AgentBrainHealthProbeDependencies = {
  resolveConfig: pickOpenAICompatibleConfig,
  createConfigDigest: createOpenAICompatibleConfigDigest,
  resolvePurpose: ({ env, channel }) => {
    const runtimeContract = resolveProviderLedgerRuntimeContract({
      capability: "agent_brain",
      ambientEnv: env,
    });
    if (runtimeContract.kind !== "agent_brain_responses") throw new Error("v1_9_provider_config_missing");
    return resolveAgentBrainPurposeForChannel(runtimeContract, channel);
  },
  readActiveRun: defaultReadActiveRun,
  createClient: (options) => new OpenAI(options) as unknown as ProbeClient,
  writeEvidence: (evidence, env) => writeV1_9AgentBrainHealthEvidence({ evidence, env }),
  writeRunCopy: defaultWriteRunCopy,
  now: () => new Date(),
  randomId: () => randomUUID().slice(0, 12),
};

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  void runMain();
}

async function runMain() {
  await import("dotenv/config");
  const result = await runV1_9AgentBrainHealthProbe();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}
