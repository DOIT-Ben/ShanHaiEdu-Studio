import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  resolveProviderLedgerRoot,
  resolveProviderLedgerRuntimeContract,
  type ProviderLedgerCredentialSource,
  type ProviderLedgerEnv,
  type ProviderLedgerPurpose,
} from "./provider-ledger-adapter";
import {
  resolveAgentBrainPurposeForChannel,
  type AgentBrainRuntimeContract,
} from "./provider-ledger-contract.mjs";

export const V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_VERSION = "v1-9-agent-brain-health.v2" as const;

export type V1_9AgentBrainHealthEvidence = {
  schemaVersion: typeof V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_VERSION;
  evidenceId: string;
  providerId: "agent_brain";
  capability: "agent_brain";
  purpose: ProviderLedgerPurpose;
  channel: "primary" | "third" | "fallback";
  model: string;
  endpointCategory: "openai_compatible_responses";
  reasoningEffort: "low" | "medium" | "high" | "xhigh";
  credentialSource: ProviderLedgerCredentialSource;
  configDigest: string;
  probe: "single_strict_structured_text";
  result: "succeeded" | "failed";
  testedAt: string;
  providerRequestCount: 1;
  maxRetries: 0;
  retryCount: 0;
  errorCategory: "none" | "authorization" | "rate_limit" | "timeout" | "transport" | "provider" | "invalid_response" | "unknown";
};

export type V1_9AgentBrainProviderLock = Pick<
  V1_9AgentBrainHealthEvidence,
  "channel" | "model" | "endpointCategory" | "reasoningEffort" | "credentialSource" | "configDigest"
>;

export async function writeV1_9AgentBrainHealthEvidence(input: {
  ledgerRoot?: string;
  env?: ProviderLedgerEnv;
  evidence: V1_9AgentBrainHealthEvidence;
}): Promise<{ path: string; record: V1_9AgentBrainHealthEvidence }> {
  const record = parseV1_9AgentBrainHealthEvidence(input.evidence);
  const ledgerRoot = resolveProviderLedgerRoot(input.env ?? process.env, input.ledgerRoot);
  assertEvidencePurposeMatchesRuntimeContract(record, resolveAgentBrainRuntimeContract({
    ledgerRoot,
    env: input.env,
  }));
  const evidenceDirectory = path.resolve(ledgerRoot, "evidence", "provider-adapter-tests");
  assertWithinLedger(ledgerRoot, evidenceDirectory);
  if (!existsSync(path.dirname(evidenceDirectory))) throw new Error("v1_9_provider_evidence_boundary_missing");
  await mkdir(evidenceDirectory, { recursive: true });
  const targetPath = path.resolve(evidenceDirectory, `${record.evidenceId}.json`);
  assertWithinLedger(evidenceDirectory, targetPath);
  try {
    await writeFile(targetPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") throw new Error("v1_9_agent_brain_health_evidence_exists");
    throw error;
  }
  return { path: targetPath, record };
}

export function readV1_9AgentBrainHealthEvidence(input: {
  ledgerRoot?: string;
  env?: ProviderLedgerEnv;
  evidenceId: string;
}): unknown {
  const evidenceId = requiredEvidenceId(input.evidenceId);
  const ledgerRoot = resolveProviderLedgerRoot(input.env ?? process.env, input.ledgerRoot);
  const evidenceDirectory = path.resolve(ledgerRoot, "evidence", "provider-adapter-tests");
  const evidencePath = path.resolve(evidenceDirectory, `${evidenceId}.json`);
  assertWithinLedger(evidenceDirectory, evidencePath);
  return JSON.parse(readFileSync(evidencePath, "utf8")) as unknown;
}

export function validateV1_9AgentBrainHealthEvidence(input: {
  value: unknown;
  evidenceId: string;
  providerLock: V1_9AgentBrainProviderLock;
  runtimeContract?: AgentBrainRuntimeContract;
  ledgerRoot?: string;
  env?: ProviderLedgerEnv;
  notBefore?: string;
}): V1_9AgentBrainHealthEvidence {
  const record = parseV1_9AgentBrainHealthEvidence(input.value);
  const evidenceId = requiredEvidenceId(input.evidenceId);
  if (record.evidenceId !== evidenceId) throw new Error("v1_9_agent_brain_health_evidence_id_mismatch");
  assertProviderLockMatch(record, input.providerLock);
  assertEvidencePurposeMatchesRuntimeContract(record, input.runtimeContract ?? resolveAgentBrainRuntimeContract(input));
  if (record.result !== "succeeded" || record.errorCategory !== "none") {
    throw new Error("v1_9_agent_brain_health_evidence_not_healthy");
  }
  if (input.notBefore && Date.parse(record.testedAt) <= Date.parse(input.notBefore)) {
    throw new Error("v1_9_agent_brain_health_evidence_stale");
  }
  return record;
}

export function validateV1_9AgentBrainAuthorizationFailureEvidence(input: {
  value: unknown;
  evidenceId: string;
  providerLock: V1_9AgentBrainProviderLock;
  runtimeContract?: AgentBrainRuntimeContract;
  ledgerRoot?: string;
  env?: ProviderLedgerEnv;
  notBefore?: string;
}) {
  const record = parseV1_9AgentBrainHealthEvidence(input.value);
  if (record.evidenceId !== requiredEvidenceId(input.evidenceId)) throw new Error("v1_9_agent_brain_health_evidence_id_mismatch");
  assertProviderLockMatch(record, input.providerLock);
  assertEvidencePurposeMatchesRuntimeContract(record, input.runtimeContract ?? resolveAgentBrainRuntimeContract(input));
  if (record.result !== "failed" || record.errorCategory !== "authorization") {
    throw new Error("v1_9_agent_brain_authorization_failure_evidence_invalid");
  }
  if (input.notBefore && Date.parse(record.testedAt) <= Date.parse(input.notBefore)) throw new Error("v1_9_agent_brain_health_evidence_stale");
  return record;
}

function assertProviderLockMatch(record: V1_9AgentBrainHealthEvidence, providerLock: V1_9AgentBrainProviderLock) {
  for (const field of ["channel", "model", "endpointCategory", "reasoningEffort", "credentialSource", "configDigest"] as const) {
    if (record[field] !== providerLock[field]) throw new Error("v1_9_agent_brain_health_evidence_provider_lock_mismatch");
  }
}

function parseV1_9AgentBrainHealthEvidence(value: unknown): V1_9AgentBrainHealthEvidence {
  if (!isRecord(value) || value.schemaVersion !== V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_VERSION) throw new Error("v1_9_agent_brain_health_evidence_invalid");
  const evidenceId = requiredEvidenceId(value.evidenceId);
  if (value.providerId !== "agent_brain" || value.capability !== "agent_brain") throw new Error("v1_9_agent_brain_health_evidence_provider_invalid");
  if (!isChannel(value.channel) || !isPurpose(value.purpose) || value.endpointCategory !== "openai_compatible_responses") throw new Error("v1_9_agent_brain_health_evidence_contract_invalid");
  if (!isReasoningEffort(value.reasoningEffort) || !isCredentialSource(value.credentialSource)) throw new Error("v1_9_agent_brain_health_evidence_identity_invalid");
  if (typeof value.model !== "string" || !value.model.trim() || value.model.length > 160 || value.model.includes("://")) throw new Error("v1_9_agent_brain_health_evidence_model_invalid");
  if (typeof value.configDigest !== "string" || !/^[a-f0-9]{64}$/i.test(value.configDigest)) throw new Error("v1_9_agent_brain_health_evidence_digest_invalid");
  if (value.probe !== "single_strict_structured_text" || !["succeeded", "failed"].includes(String(value.result))) throw new Error("v1_9_agent_brain_health_evidence_probe_invalid");
  if (typeof value.testedAt !== "string" || !Number.isFinite(Date.parse(value.testedAt))) throw new Error("v1_9_agent_brain_health_evidence_time_invalid");
  if (value.providerRequestCount !== 1 || value.maxRetries !== 0 || value.retryCount !== 0) throw new Error("v1_9_agent_brain_health_evidence_retry_invalid");
  if (!isErrorCategory(value.errorCategory)) throw new Error("v1_9_agent_brain_health_evidence_error_invalid");
  return {
    schemaVersion: V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_VERSION,
    evidenceId,
    providerId: "agent_brain",
    capability: "agent_brain",
    purpose: value.purpose,
    channel: value.channel,
    model: value.model.trim(),
    endpointCategory: "openai_compatible_responses",
    reasoningEffort: value.reasoningEffort,
    credentialSource: value.credentialSource,
    configDigest: value.configDigest.toLowerCase(),
    probe: "single_strict_structured_text",
    result: value.result as "succeeded" | "failed",
    testedAt: new Date(value.testedAt).toISOString(),
    providerRequestCount: 1,
    maxRetries: 0,
    retryCount: 0,
    errorCategory: value.errorCategory,
  };
}

function requiredEvidenceId(value: unknown) {
  if (typeof value !== "string" || !/^agent-brain-health-[A-Za-z0-9._-]{1,110}$/.test(value)) throw new Error("v1_9_agent_brain_health_evidence_id_invalid");
  return value;
}

function resolveAgentBrainRuntimeContract(input: {
  ledgerRoot?: string;
  env?: ProviderLedgerEnv;
}): AgentBrainRuntimeContract {
  const contract = resolveProviderLedgerRuntimeContract({
    ledgerRoot: input.ledgerRoot,
    capability: "agent_brain",
    ambientEnv: input.env ?? process.env,
  });
  if (contract.kind !== "agent_brain_responses") throw new Error("v1_9_agent_brain_health_evidence_contract_invalid");
  return contract;
}

function assertEvidencePurposeMatchesRuntimeContract(
  record: V1_9AgentBrainHealthEvidence,
  runtimeContract: AgentBrainRuntimeContract,
) {
  let expectedPurpose: ProviderLedgerPurpose;
  try {
    expectedPurpose = resolveAgentBrainPurposeForChannel(runtimeContract, record.channel);
  } catch {
    throw new Error("v1_9_agent_brain_health_evidence_contract_invalid");
  }
  if (record.purpose !== expectedPurpose) throw new Error("v1_9_agent_brain_health_evidence_not_healthy");
}

function isChannel(value: unknown): value is V1_9AgentBrainHealthEvidence["channel"] {
  return value === "primary" || value === "third" || value === "fallback";
}

function isPurpose(value: unknown): value is ProviderLedgerPurpose {
  return value === "main_agent_responses" || value === "critic_responses" || value === "fallback_responses";
}

function isReasoningEffort(value: unknown): value is V1_9AgentBrainHealthEvidence["reasoningEffort"] {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function isCredentialSource(value: unknown): value is ProviderLedgerCredentialSource {
  return value === "ledger_private_env" || value === "deployment_secret";
}

function isErrorCategory(value: unknown): value is V1_9AgentBrainHealthEvidence["errorCategory"] {
  return ["none", "authorization", "rate_limit", "timeout", "transport", "provider", "invalid_response", "unknown"].includes(String(value));
}

function assertWithinLedger(root: string, candidate: string) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("v1_9_provider_evidence_path_escape");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
