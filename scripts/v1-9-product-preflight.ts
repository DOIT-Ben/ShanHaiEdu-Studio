import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  preflightBusinessToolSkillRuntime,
} from "../src/server/skills/business-tool-skill-runtime";
import {
  assertV1_9RunManifestV2Digest,
  normalizeV1_9RunManifestV2,
  normalizeV1_9RunState,
  type V1_9ProviderLock,
  type V1_9RunManifestV2,
  type V1_9RunState,
  type V1_9SkillLock,
} from "./lib/v1-9-e2e-contract.mjs";
import {
  assertCurrentV1_9BaselineLock,
  type V1_9BaselineLock,
  type V1_9LegacyBaselineLock,
} from "./lib/v1-9-baseline-lock.mjs";
import {
  probeV1_9InstalledTree,
  type V1_9InstalledTreeProbeResult,
} from "./lib/v1-9-installed-tree.mjs";
import {
  resolveProviderLedgerRuntimeContract,
  resolveProviderLedgerValueBag,
  type ProviderLedgerEnv,
  type ProviderLedgerPurpose,
  type ProviderLedgerValueBag,
} from "../src/server/provider-ledger/provider-ledger-adapter";
import type {
  AgentBrainRuntimeContract,
  MiniMaxImageRuntimeContract,
  MiniMaxTtsRuntimeContract,
  ProviderRuntimeContract,
} from "../src/server/provider-ledger/provider-ledger-contract.mjs";
import { createOpenAICompatibleConfigDigest } from "../src/server/openai-compatible-config";
import { resolveGenerationIntensityStrategy } from "../src/server/generation-intensity/generation-intensity-policy";
import {
  readV1_9AgentBrainHealthEvidence,
  validateV1_9AgentBrainHealthEvidence,
} from "../src/server/provider-ledger/v1-9-agent-brain-health-evidence";

const PREFLIGHT_SCHEMA_VERSION = "v1-9-product-preflight.v1";
const ACTIVE_POINTER_SCHEMA_VERSION = "v1-9-active-run.v2";
const ACTIVE_POINTER_FIELDS = [
  "schemaVersion",
  "runId",
  "relativeRunRoot",
  "manifestPath",
  "manifestSha256",
  "statePath",
] as const;

const deterministicFlags = [
  "M67_E2E_DETERMINISTIC",
  "SHANHAI_E2E_DETERMINISTIC_MAIN_AGENT",
  "SHANHAI_E2E_DETERMINISTIC_RUNTIME",
] as const;

const binaryContracts = [
  { command: "ffmpeg", args: ["-version"] },
  { command: "ffprobe", args: ["-version"] },
  { command: "soffice", args: ["--version"] },
  { command: "pdfinfo", args: ["-v"] },
  { command: "pdftoppm", args: ["-v"] },
  { command: "fc-match", args: ["Noto Sans CJK SC"] },
] as const;

export type V1_9ProductPreflightReason =
  | "v1_9_deterministic_runtime_forbidden"
  | "v1_9_installed_tree_invalid"
  | "skill_runtime_config_missing"
  | "skill_runtime_config_partial"
  | "skill_runtime_config_ambiguous"
  | "skill_runtime_registry_invalid"
  | "skill_runtime_lock_digest_mismatch"
  | "skill_runtime_binding_missing_or_inactive"
  | "skill_runtime_version_incompatible"
  | "v1_9_provider_ledger_invalid"
  | "v1_9_agent_brain_channel_invalid"
  | "v1_9_provider_lock_mismatch"
  | "v1_9_agent_brain_health_evidence_required"
  | "v1_9_agent_brain_health_evidence_invalid"
  | "v1_9_binary_unavailable"
  | "v1_9_run_manifest_identity_invalid"
  | "v1_9_baseline_lock_drift"
  | "v1_9_skill_lock_invalid"
  | "v1_9_runtime_storage_invalid";

export type V1_9ProductPreflightCheck = {
  id: string;
  ok: boolean;
  reasonCode?: V1_9ProductPreflightReason;
  allowedOptionalExtraneousCount?: number;
};

export type V1_9ProductPreflightReport = {
  schemaVersion: typeof PREFLIGHT_SCHEMA_VERSION;
  stage: "v1_9_product_preflight";
  ok: boolean;
  providerRequestCount: 0;
  failureReasonCodes: V1_9ProductPreflightReason[];
  checks: V1_9ProductPreflightCheck[];
};

export type V1_9ProviderRuntimeLock = {
  capability: "agent_brain" | "coze_ppt" | "image_generation" | "video_generation" | "tts_minimax" | "text_llm";
  credentialSource: "ledger_private_env" | "deployment_secret";
  configDigest: string;
};

export type V1_9ResolvedExecutionLocks = {
  skillLock: V1_9SkillLock;
  providerLock: V1_9ProviderLock;
  providerRuntimeLocks: V1_9ProviderRuntimeLock[];
  checkedBindingCount: number;
};

type V1_9ProductPreflightEnv = Partial<NodeJS.ProcessEnv> & Record<string, string | undefined>;

type SkillPreflight = (input: {
  mode: "required";
  env: V1_9ProductPreflightEnv;
}) => Promise<{
  status: "ready" | "optional_not_configured";
  activeSkillNames: string[];
  activeSkills: Array<{ name: string; version: string }>;
  checkedBindingCount: number;
  bindingPolicyDigest: string | null;
  projectionLockDigest: string | null;
}>;

export type V1_9ProductPreflightDependencies = {
  preflightSkills: SkillPreflight;
  resolveProviderValueBag(input: {
    capability: string;
    ambientEnv: ProviderLedgerEnv;
  }): ProviderLedgerValueBag;
  resolveProviderRuntimeContract(input: {
    capability: string;
    ambientEnv: ProviderLedgerEnv;
  }): ProviderRuntimeContract;
  probeInstalledTree(input: {
    cwd: string;
    env: V1_9ProductPreflightEnv;
  }): V1_9InstalledTreeProbeResult | Promise<V1_9InstalledTreeProbeResult>;
  probeBinary(command: string, args: readonly string[], env: V1_9ProductPreflightEnv): boolean | Promise<boolean>;
  probeRunStorage(input: {
    runRoot: string;
    databasePath: string;
    artifactRoot: string;
  }): boolean | Promise<boolean>;
  readJson(filePath: string): unknown | Promise<unknown>;
  readBytes(filePath: string): Buffer | Promise<Buffer>;
  assertCurrentBaselineLock(
    expected: V1_9BaselineLock | V1_9LegacyBaselineLock,
    input: { cwd: string; env: V1_9ProductPreflightEnv },
  ): unknown | Promise<unknown>;
  readProviderHealthEvidence(input: {
    evidenceId: string;
    env: V1_9ProductPreflightEnv;
  }): unknown | Promise<unknown>;
};

export async function resolveV1_9ExecutionLocks(input: {
  env?: V1_9ProductPreflightEnv;
  dependencies?: Partial<V1_9ProductPreflightDependencies>;
} = {}): Promise<V1_9ResolvedExecutionLocks> {
  const env = input.env ?? process.env;
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const skills = await dependencies.preflightSkills({ mode: "required", env });
  if (!isReadySkillPreflight(skills)) throw stableFailure("skill_runtime_registry_invalid");
  const providers = validateProviderLedgerContracts(
    env,
    dependencies.resolveProviderValueBag,
    dependencies.resolveProviderRuntimeContract,
  );
  const providerFailure = providers.checks.find((item) => !item.ok)?.reasonCode;
  if (providerFailure) throw stableFailure(providerFailure);
  if (!providers.providerLock || providers.providerRuntimeLocks.length === 0) {
    throw stableFailure("v1_9_provider_ledger_invalid");
  }
  return {
    skillLock: {
      schemaVersion: "v1-9-skill-lock.v1",
      projectionLockDigest: skills.projectionLockDigest,
      bindingPolicyDigest: skills.bindingPolicyDigest,
      activeSkills: skills.activeSkills,
    },
    providerLock: providers.providerLock,
    providerRuntimeLocks: providers.providerRuntimeLocks,
    checkedBindingCount: skills.checkedBindingCount,
  };
}

export async function runV1_9ProductPreflight(input: {
  cwd?: string;
  env?: V1_9ProductPreflightEnv;
  manifestPath?: string;
  runStatePath?: string;
  activePointerPath?: string;
  dependencies?: Partial<V1_9ProductPreflightDependencies>;
} = {}): Promise<V1_9ProductPreflightReport> {
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const env = input.env ?? process.env;
  const dependencies = { ...defaultDependencies, ...input.dependencies };
  const checks: V1_9ProductPreflightCheck[] = [];

  const deterministicDisabled = deterministicFlags.every((name) => env[name]?.trim() !== "1");
  checks.push(check(
    "profile-deterministic-disabled",
    deterministicDisabled,
    "v1_9_deterministic_runtime_forbidden",
  ));
  if (!deterministicDisabled) return report(checks);

  const activePointerPath = path.resolve(input.activePointerPath
    ?? path.join(cwd, "test-results", "v1-9-product-e2e-active.json"));

  let identity: RunIdentity;
  try {
    const pointer = await dependencies.readJson(activePointerPath);
    const configuredManifestPath = input.manifestPath ?? env.V1_9_E2E_MANIFEST_PATH?.trim() ?? (
      isRecord(pointer) && typeof pointer.manifestPath === "string" ? pointer.manifestPath : undefined
    );
    const manifestPath = configuredManifestPath
      ? path.resolve(cwd, configuredManifestPath)
      : path.resolve(cwd, ...normalizeRelativeRunRoot(isRecord(pointer) ? pointer.relativeRunRoot : undefined).split("/"), "run-manifest.json");
    const configuredRunStatePath = input.runStatePath ?? env.V1_9_E2E_STATE_PATH?.trim() ?? (
      isRecord(pointer) && typeof pointer.statePath === "string" ? pointer.statePath : undefined
    );
    const runStatePath = configuredRunStatePath
      ? path.resolve(cwd, configuredRunStatePath)
      : path.resolve(cwd, ...normalizeRelativeRunRoot(isRecord(pointer) ? pointer.relativeRunRoot : undefined).split("/"), "run-state.json");
    const manifestBytes = await dependencies.readBytes(manifestPath);
    identity = validateRunIdentity({
      cwd,
      manifestPath,
      runStatePath,
      activePointerPath,
      manifest: JSON.parse(manifestBytes.toString("utf8")) as unknown,
      manifestBytes,
      state: await dependencies.readJson(runStatePath),
      pointer,
    });
    checks.push(check("run-manifest-identity", true));
  } catch {
    checks.push(check("run-manifest-identity", false, "v1_9_run_manifest_identity_invalid"));
    return report(checks);
  }

  try {
    await dependencies.assertCurrentBaselineLock(identity.manifest.baselineLock, { cwd, env });
    checks.push(check("run-baseline-current", true));
  } catch {
    checks.push(check("run-baseline-current", false, "v1_9_baseline_lock_drift"));
    return report(checks);
  }

  let installedTree: V1_9InstalledTreeProbeResult = {
    ok: false,
    allowedOptionalExtraneousCount: 0,
  };
  try {
    installedTree = normalizeInstalledTreeProbeResult(
      await dependencies.probeInstalledTree({ cwd, env }),
    );
  } catch {
    // Raw npm errors can contain local paths. The report keeps only this stable result.
  }
  checks.push({
    ...check("runtime-installed-tree", installedTree.ok, "v1_9_installed_tree_invalid"),
    allowedOptionalExtraneousCount: installedTree.allowedOptionalExtraneousCount,
  });
  if (!installedTree.ok) return report(checks);

  let skillLock: V1_9SkillLock;
  try {
    const skills = await dependencies.preflightSkills({ mode: "required", env });
    if (!isReadySkillPreflight(skills)) throw stableFailure("skill_runtime_registry_invalid");
    skillLock = {
      schemaVersion: "v1-9-skill-lock.v1",
      projectionLockDigest: skills.projectionLockDigest,
      bindingPolicyDigest: skills.bindingPolicyDigest,
      activeSkills: skills.activeSkills,
    };
    checks.push(check("skill-runtime-required", true));
  } catch (error) {
    checks.push(check("skill-runtime-required", false, skillReason(error)));
    return report(checks);
  }

  const providerContracts = validateProviderLedgerContracts(
    env,
    dependencies.resolveProviderValueBag,
    dependencies.resolveProviderRuntimeContract,
  );
  checks.push(...providerContracts.checks);
  if (providerContracts.checks.some((item) => item.reasonCode === "v1_9_agent_brain_channel_invalid")) {
    return report(checks);
  }

  for (const contract of binaryContracts) {
    let ok = false;
    try {
      ok = await dependencies.probeBinary(contract.command, contract.args, env);
    } catch {
      ok = false;
    }
    checks.push(check(`binary-${contract.command}`, ok, "v1_9_binary_unavailable"));
  }

  if (providerContracts.checks.some((item) => !item.ok) ||
      !providerContracts.providerLock ||
      providerContracts.providerRuntimeLocks.length === 0) {
    return report(checks);
  }

  if (sameJson(identity.manifest.skillLock, normalizedSkillLock(skillLock))) {
    checks.push(check("run-manifest-skill-lock", true));
  } else {
    checks.push(check("run-manifest-skill-lock", false, "v1_9_skill_lock_invalid"));
    return report(checks);
  }

  if (sameJson(identity.manifest.agentBrain.providerLock, providerContracts.providerLock) &&
      sameJson(identity.manifest.providerRuntimeLocks, providerContracts.providerRuntimeLocks)) {
    checks.push(check("run-manifest-provider-locks", true));
  } else {
    checks.push(check("run-manifest-provider-locks", false, "v1_9_provider_lock_mismatch"));
    return report(checks);
  }

  let storageReady = false;
  try {
    storageReady = await dependencies.probeRunStorage({
      runRoot: identity.runRoot,
      databasePath: identity.databasePath,
      artifactRoot: identity.artifactRoot,
    });
  } catch {
    storageReady = false;
  }
  checks.push(check("runtime-storage", storageReady, "v1_9_runtime_storage_invalid"));
  if (checks.some((item) => !item.ok)) return report(checks);

  if (identity.state.status === "paused_recovery" || identity.state.status === "failed") {
    const evidenceId = env.V1_9_AGENT_BRAIN_HEALTH_EVIDENCE_ID?.trim();
    if (!evidenceId) {
      checks.push(check("agent-brain-health-evidence", false, "v1_9_agent_brain_health_evidence_required"));
      return report(checks);
    }
    try {
      const evidence = await dependencies.readProviderHealthEvidence({ evidenceId, env });
      validateV1_9AgentBrainHealthEvidence({
        value: evidence,
        evidenceId,
        providerLock: providerContracts.providerLock!,
        runtimeContract: providerContracts.agentBrainRuntimeContract!,
        notBefore: identity.state.updatedAt,
      });
      checks.push(check("agent-brain-health-evidence", true));
    } catch {
      checks.push(check("agent-brain-health-evidence", false, "v1_9_agent_brain_health_evidence_invalid"));
      return report(checks);
    }
  }

  return report(checks);
}

export function serializeV1_9ProductPreflight(reportValue: V1_9ProductPreflightReport): string {
  return `${JSON.stringify(reportValue, null, 2)}\n`;
}

function validateProviderLedgerContracts(
  env: V1_9ProductPreflightEnv,
  resolveValueBag: V1_9ProductPreflightDependencies["resolveProviderValueBag"],
  resolveRuntimeContract: V1_9ProductPreflightDependencies["resolveProviderRuntimeContract"],
): {
  checks: V1_9ProductPreflightCheck[];
  providerLock: V1_9ProviderLock | null;
  providerRuntimeLocks: V1_9ProviderRuntimeLock[];
  agentBrainRuntimeContract: AgentBrainRuntimeContract | null;
} {
  let providerLock: V1_9ProviderLock | null = null;
  let agentBrainRuntimeContract: AgentBrainRuntimeContract | null = null;
  const contracts: Array<{
    id: string;
    capability: V1_9ProviderRuntimeLock["capability"];
    validate(bag: ProviderLedgerValueBag): V1_9ProviderRuntimeLock;
  }> = [
    {
      id: "agent-brain",
      capability: "agent_brain",
      validate: (bag) => {
        const runtimeContract = requireRuntimeContractKind(
          resolveRuntimeContract({ capability: "agent_brain", ambientEnv: env as ProviderLedgerEnv }),
          "agent_brain_responses",
        );
        providerLock = validateAgentBrain(bag, runtimeContract, env);
        agentBrainRuntimeContract = runtimeContract;
        return {
          capability: "agent_brain",
          credentialSource: providerLock.credentialSource,
          configDigest: providerLock.configDigest,
        };
      },
    },
    { id: "coze-ppt", capability: "coze_ppt", validate: validateCozePpt },
    {
      id: "image-generation",
      capability: "image_generation",
      validate: (bag) => validateImageProvider(bag, requireRuntimeContractKind(
        resolveRuntimeContract({ capability: "image_generation", ambientEnv: env as ProviderLedgerEnv }),
        "minimax_image",
      )),
    },
    { id: "video-generation", capability: "video_generation", validate: validateVideoProvider },
    {
      id: "tts-minimax",
      capability: "tts_minimax",
      validate: (bag) => validateTtsProvider(bag, requireRuntimeContractKind(
        resolveRuntimeContract({ capability: "tts_minimax", ambientEnv: env as ProviderLedgerEnv }),
        "minimax_tts",
      )),
    },
  ];
  if (env.AGENT_TOOL_MODEL_CHANNEL?.trim().toLowerCase() === "deepseek") {
    contracts.push({ id: "text-llm", capability: "text_llm", validate: validateDeepSeekToolModel });
  }

  const checks: V1_9ProductPreflightCheck[] = [];
  const providerRuntimeLocks: V1_9ProviderRuntimeLock[] = [];
  for (const contract of contracts) {
    try {
      const bag = resolveValueBag({ capability: contract.capability, ambientEnv: env as ProviderLedgerEnv });
      providerRuntimeLocks.push(contract.validate(bag));
      checks.push(check(`provider-ledger-${contract.id}`, true));
    } catch (error) {
      const reason = isStableFailure(error, "v1_9_agent_brain_channel_invalid")
        ? "v1_9_agent_brain_channel_invalid"
        : "v1_9_provider_ledger_invalid";
      checks.push(check(`provider-ledger-${contract.id}`, false, reason));
      if (reason === "v1_9_agent_brain_channel_invalid") break;
    }
  }
  return {
    checks,
    providerLock,
    providerRuntimeLocks: providerRuntimeLocks.sort((left, right) => left.capability.localeCompare(right.capability)),
    agentBrainRuntimeContract,
  };
}

function validateAgentBrain(
  bag: ProviderLedgerValueBag,
  runtimeContract: AgentBrainRuntimeContract,
  env: V1_9ProductPreflightEnv,
): V1_9ProviderLock {
  const channel = optionalDeclared(bag, runtimeContract.selectedChannelEnv)?.toLowerCase();
  const purposeEntry = (Object.entries(runtimeContract.purposeChannels) as Array<[
    ProviderLedgerPurpose,
    AgentBrainRuntimeContract["purposeChannels"][ProviderLedgerPurpose],
  ]>).find(([, entry]) => entry.channel === channel);
  if (!purposeEntry) throw stableFailure("v1_9_agent_brain_channel_invalid");
  const [, selected] = purposeEntry;
  const credential = requireDeclared(bag, selected.credentialEnv);
  const baseURL = requireDeclared(bag, selected.baseUrlEnv);
  const model = requireDeclared(bag, selected.modelEnv);
  const generationIntensity = env.V1_9_E2E_GENERATION_INTENSITY?.trim() || "standard";
  if (generationIntensity !== "standard") throw stableFailure("v1_9_provider_ledger_invalid");
  const strategy = resolveGenerationIntensityStrategy(generationIntensity);
  const configuredReasoningEffort = resolveReasoningEffort(bag, runtimeContract);
  if (model !== strategy.model ||
      strategy.reasoningEffort !== "medium" ||
      configuredReasoningEffort !== strategy.reasoningEffort ||
      !runtimeContract.reasoning.allowed.includes(strategy.reasoningEffort)) {
    throw stableFailure("v1_9_provider_ledger_invalid");
  }
  const reasoningEffort = strategy.reasoningEffort;
  const identity = {
    credential,
    channel: selected.channel,
    baseURL,
    model,
    reasoningEffort,
    credentialSource: bag.source,
    endpointCategory: "openai_compatible_responses" as const,
  };
  return {
    schemaVersion: "v1-9-provider-lock.v1",
    channel: selected.channel,
    model,
    endpointCategory: identity.endpointCategory,
    reasoningEffort,
    credentialSource: bag.source,
    configDigest: createOpenAICompatibleConfigDigest(identity),
  };
}

function resolveReasoningEffort(
  bag: ProviderLedgerValueBag,
  runtimeContract: AgentBrainRuntimeContract,
): V1_9ProviderLock["reasoningEffort"] {
  const value = optionalDeclared(bag, runtimeContract.reasoning.env)?.toLowerCase() || runtimeContract.reasoning.default;
  if (runtimeContract.reasoning.allowed.includes(value as V1_9ProviderLock["reasoningEffort"])) {
    return value as V1_9ProviderLock["reasoningEffort"];
  }
  throw stableFailure("v1_9_provider_ledger_invalid");
}

function validateCozePpt(bag: ProviderLedgerValueBag): V1_9ProviderRuntimeLock {
  requireDeclared(bag, "COZE_API_TOKEN");
  if (!optionalDeclared(bag, "COZE_PPT_RUN_URL") && !optionalDeclared(bag, "COZE_PPT_BOT_ID")) {
    throw stableFailure("v1_9_provider_ledger_invalid");
  }
  return createProviderRuntimeLock("coze_ppt", bag, ["COZE_API_TOKEN", "COZE_PPT_RUN_URL", "COZE_PPT_BOT_ID"]);
}

function validateImageProvider(bag: ProviderLedgerValueBag, runtimeContract: MiniMaxImageRuntimeContract): V1_9ProviderRuntimeLock {
  const mode = optionalDeclared(bag, runtimeContract.selectedChannelEnv)?.toLowerCase();
  if (mode !== runtimeContract.requiredChannel) throw stableFailure("v1_9_provider_ledger_invalid");
  requireDeclared(bag, runtimeContract.credentialEnv);
  requireDeclared(bag, runtimeContract.baseUrlEnv);
  requireDeclared(bag, runtimeContract.modelEnv);
  return createProviderRuntimeLock("image_generation", bag, [
    runtimeContract.selectedChannelEnv,
    runtimeContract.credentialEnv,
    runtimeContract.baseUrlEnv,
    runtimeContract.modelEnv,
  ]);
}

function validateVideoProvider(bag: ProviderLedgerValueBag): V1_9ProviderRuntimeLock {
  const mode = optionalDeclared(bag, "VIDEO_PROVIDER_MODE");
  const wantsEvolink = mode === "evolink" || Boolean(optionalDeclared(bag, "EVOLINK_API_KEY"));
  if (wantsEvolink) {
    requireDeclared(bag, "EVOLINK_API_KEY");
    return createProviderRuntimeLock("video_generation", bag, [
      "VIDEO_PROVIDER_MODE", "EVOLINK_API_KEY", "EVOLINK_BASE_URL", "EVOLINK_VIDEO_MODEL",
    ]);
  }
  requireDeclared(bag, "OCTO_API_KEY");
  requireDeclared(bag, "OCTO_BASE_URL");
  return createProviderRuntimeLock("video_generation", bag, [
    "VIDEO_PROVIDER_MODE", "OCTO_API_KEY", "OCTO_BASE_URL", "OCTO_VIDEO_MODEL",
  ]);
}

function validateTtsProvider(bag: ProviderLedgerValueBag, runtimeContract: MiniMaxTtsRuntimeContract): V1_9ProviderRuntimeLock {
  const mode = optionalDeclared(bag, runtimeContract.selectedModeEnv)?.toLowerCase();
  if (mode !== runtimeContract.requiredMode) throw stableFailure("v1_9_provider_ledger_invalid");
  requireDeclared(bag, runtimeContract.credentialEnv);
  requireDeclared(bag, runtimeContract.baseUrlEnv);
  requireDeclared(bag, runtimeContract.modelEnv);
  requireDeclared(bag, "MINIMAX_TTS_VOICE_ID");
  return createProviderRuntimeLock("tts_minimax", bag, [
    runtimeContract.selectedModeEnv,
    runtimeContract.credentialEnv,
    runtimeContract.baseUrlEnv,
    runtimeContract.modelEnv,
    "MINIMAX_TTS_VOICE_ID",
  ]);
}

function requireRuntimeContractKind<TKind extends ProviderRuntimeContract["kind"]>(
  runtimeContract: ProviderRuntimeContract,
  kind: TKind,
): Extract<ProviderRuntimeContract, { kind: TKind }> {
  if (runtimeContract.kind !== kind) throw stableFailure("v1_9_provider_ledger_invalid");
  return runtimeContract as Extract<ProviderRuntimeContract, { kind: TKind }>;
}

function validateDeepSeekToolModel(bag: ProviderLedgerValueBag): V1_9ProviderRuntimeLock {
  requireDeclared(bag, "DEEPSEEK_API_KEY");
  requireDeclared(bag, "DEEPSEEK_BASE_URL");
  requireDeclared(bag, "DEEPSEEK_MODEL");
  return createProviderRuntimeLock("text_llm", bag, ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL"]);
}

function createProviderRuntimeLock(
  capability: V1_9ProviderRuntimeLock["capability"],
  bag: ProviderLedgerValueBag,
  keys: string[],
): V1_9ProviderRuntimeLock {
  const values = [...new Set(keys)].sort().flatMap((key) => {
    const value = optionalDeclared(bag, key);
    return value ? [{ key, valueDigest: sha256(value) }] : [];
  });
  if (values.length === 0) throw stableFailure("v1_9_provider_ledger_invalid");
  return {
    capability,
    credentialSource: bag.source,
    configDigest: sha256(JSON.stringify({ capability, credentialSource: bag.source, values })),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requireDeclared(bag: ProviderLedgerValueBag, key: string): string {
  if (!bag.has(key)) throw stableFailure("v1_9_provider_ledger_invalid");
  const value = bag.require(key)?.trim();
  if (!value) throw stableFailure("v1_9_provider_ledger_invalid");
  return value;
}

function optionalDeclared(bag: ProviderLedgerValueBag, key: string): string | undefined {
  if (!bag.has(key)) return undefined;
  return bag.get(key)?.trim() || undefined;
}

type RunIdentity = {
  runRoot: string;
  databasePath: string;
  artifactRoot: string;
  manifestPath: string;
  runStatePath: string;
  manifest: V1_9RunManifestV2;
  state: V1_9RunState;
};

function validateRunIdentity(input: {
  cwd: string;
  manifestPath: string;
  runStatePath: string;
  activePointerPath: string;
  manifest: unknown;
  manifestBytes: Buffer;
  state: unknown;
  pointer: unknown;
}): RunIdentity {
  if (!isRecord(input.pointer)) throw new Error("invalid");
  const manifest = normalizeV1_9RunManifestV2(input.manifest);
  const state = normalizeV1_9RunState(input.state);
  const pointer = input.pointer;
  assertExactFields(pointer, ACTIVE_POINTER_FIELDS);
  if (pointer.schemaVersion !== ACTIVE_POINTER_SCHEMA_VERSION) {
    throw new Error("invalid");
  }
  const runId = requiredIdentityText(manifest.runId);
  const pointerRunId = requiredIdentityText(pointer.runId);
  const relativeRunRoot = normalizeRelativeRunRoot(manifest.relativeRunRoot);
  const pointerRunRoot = normalizeRelativeRunRoot(pointer.relativeRunRoot);
  if (runId !== pointerRunId ||
      runId !== state.runId ||
      relativeRunRoot !== pointerRunRoot ||
      path.posix.basename(relativeRunRoot) !== runId) {
    throw new Error("invalid");
  }
  if (!["prepared", "running", "paused_pending_decision", "paused_recovery", "failed", "external_acceptance_repair_required"].includes(state.status)) {
    throw new Error("invalid");
  }
  if (state.ledger.taskSubmissionCount > 1 ||
      state.ledger.externalCodexOrchestrationCount !== 0 ||
      state.ledger.violations.length !== 0) {
    throw new Error("invalid");
  }

  const canonicalManifestDigest = createHash("sha256")
    .update(`${JSON.stringify(manifest, null, 2)}\n`)
    .digest("hex");
  const rawManifestDigest = createHash("sha256").update(input.manifestBytes).digest("hex");
  if (rawManifestDigest !== canonicalManifestDigest ||
      rawManifestDigest !== state.manifestSha256 ||
      rawManifestDigest !== requiredDigest(pointer.manifestSha256)) {
    throw new Error("invalid");
  }
  assertV1_9RunManifestV2Digest(manifest, rawManifestDigest);

  const testResultsRoot = path.resolve(input.cwd, "test-results");
  const runRoot = path.resolve(input.cwd, ...relativeRunRoot.split("/"));
  const expectedManifestRelativePath = `${relativeRunRoot}/run-manifest.json`;
  const expectedStateRelativePath = `${relativeRunRoot}/run-state.json`;
  if (!isOwnedChild(testResultsRoot, runRoot)) throw new Error("invalid");
  if (path.resolve(input.manifestPath) !== path.join(runRoot, "run-manifest.json")) throw new Error("invalid");
  if (path.resolve(input.runStatePath) !== path.join(runRoot, "run-state.json")) throw new Error("invalid");
  if (normalizeRelativeFilePath(pointer.manifestPath) !== expectedManifestRelativePath ||
      normalizeRelativeFilePath(pointer.statePath) !== expectedStateRelativePath) {
    throw new Error("invalid");
  }
  if (path.resolve(input.activePointerPath) !== path.join(testResultsRoot, "v1-9-product-e2e-active.json")) throw new Error("invalid");

  return {
    runRoot,
    databasePath: path.join(runRoot, "m67.sqlite"),
    artifactRoot: path.join(runRoot, "artifact-storage"),
    manifestPath: path.resolve(input.manifestPath),
    runStatePath: path.resolve(input.runStatePath),
    manifest,
    state,
  };
}

function defaultProbeBinary(command: string, args: readonly string[], env: V1_9ProductPreflightEnv): boolean {
  const configured = command === "ffmpeg"
    ? env.FFMPEG_PATH?.trim()
    : command === "ffprobe"
      ? env.FFPROBE_PATH?.trim()
      : command === "soffice"
        ? env.LIBREOFFICE_BIN?.trim()
        : undefined;
  const executable = configured || command;
  const result = spawnSync(executable, [...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000,
    env: env as NodeJS.ProcessEnv,
  });
  return result.status === 0;
}

function normalizeInstalledTreeProbeResult(value: V1_9InstalledTreeProbeResult): V1_9InstalledTreeProbeResult {
  if (!value || typeof value.ok !== "boolean" ||
      !Number.isSafeInteger(value.allowedOptionalExtraneousCount) || value.allowedOptionalExtraneousCount < 0 ||
      (!value.ok && value.allowedOptionalExtraneousCount !== 0)) {
    return { ok: false, allowedOptionalExtraneousCount: 0 };
  }
  return {
    ok: value.ok,
    allowedOptionalExtraneousCount: value.allowedOptionalExtraneousCount,
  };
}

function defaultProbeRunStorage(input: RunIdentity): boolean {
  try {
    const runStat = lstatSync(input.runRoot);
    if (!runStat.isDirectory() || runStat.isSymbolicLink()) return false;
    const realRunRoot = realpathSync(input.runRoot);
    accessSync(realRunRoot, constants.R_OK | constants.W_OK);
    if (!isOwnedChild(realRunRoot, input.databasePath) || !isOwnedChild(realRunRoot, input.artifactRoot)) return false;
    if (path.basename(input.databasePath) !== "m67.sqlite" || path.basename(input.artifactRoot) !== "artifact-storage") return false;
    if (existsSync(input.databasePath)) {
      const databaseStat = lstatSync(input.databasePath);
      if (!databaseStat.isFile() || databaseStat.isSymbolicLink()) return false;
      accessSync(input.databasePath, constants.R_OK | constants.W_OK);
    }
    if (existsSync(input.artifactRoot)) {
      const artifactStat = lstatSync(input.artifactRoot);
      if (!artifactStat.isDirectory() || artifactStat.isSymbolicLink()) return false;
      const realArtifactRoot = realpathSync(input.artifactRoot);
      if (!isOwnedChild(realRunRoot, realArtifactRoot)) return false;
      accessSync(realArtifactRoot, constants.R_OK | constants.W_OK);
    }
    return true;
  } catch {
    return false;
  }
}

const defaultDependencies: V1_9ProductPreflightDependencies = {
  preflightSkills: (input) => preflightBusinessToolSkillRuntime({
    mode: input.mode,
    env: input.env as NodeJS.ProcessEnv,
  }),
  resolveProviderValueBag: ({ capability, ambientEnv }) => resolveProviderLedgerValueBag({ capability, ambientEnv }),
  resolveProviderRuntimeContract: ({ capability, ambientEnv }) => resolveProviderLedgerRuntimeContract({ capability, ambientEnv }),
  assertCurrentBaselineLock: (expected, input) => assertCurrentV1_9BaselineLock(expected, input),
  probeInstalledTree: probeV1_9InstalledTree,
  probeBinary: defaultProbeBinary,
  probeRunStorage: defaultProbeRunStorage,
  readJson: (filePath) => JSON.parse(readFileSync(filePath, "utf8")) as unknown,
  readBytes: (filePath) => readFileSync(filePath),
  readProviderHealthEvidence: ({ evidenceId, env }) => readV1_9AgentBrainHealthEvidence({ evidenceId, env }),
};

function isReadySkillPreflight(
  value: Awaited<ReturnType<SkillPreflight>>,
): value is Awaited<ReturnType<SkillPreflight>> & {
  status: "ready";
  bindingPolicyDigest: string;
  projectionLockDigest: string;
} {
  return value.status === "ready" && value.checkedBindingCount > 0 && value.activeSkillNames.length > 0 &&
    value.activeSkills.length > 0 && Boolean(value.bindingPolicyDigest?.match(/^[a-f0-9]{64}$/i)) &&
    Boolean(value.projectionLockDigest?.match(/^[a-f0-9]{64}$/i));
}

function skillReason(error: unknown): V1_9ProductPreflightReason {
  if (isRecord(error) && typeof error.reasonCode === "string" && isSkillReason(error.reasonCode)) {
    return error.reasonCode;
  }
  return "skill_runtime_registry_invalid";
}

function isSkillReason(value: string): value is Extract<V1_9ProductPreflightReason, `skill_${string}`> {
  return [
    "skill_runtime_config_missing",
    "skill_runtime_config_partial",
    "skill_runtime_config_ambiguous",
    "skill_runtime_registry_invalid",
    "skill_runtime_lock_digest_mismatch",
    "skill_runtime_binding_missing_or_inactive",
    "skill_runtime_version_incompatible",
  ].includes(value);
}

function check(
  id: string,
  ok: boolean,
  reasonCode?: V1_9ProductPreflightReason,
): V1_9ProductPreflightCheck {
  return ok || !reasonCode ? { id, ok } : { id, ok, reasonCode };
}

function report(checks: V1_9ProductPreflightCheck[]): V1_9ProductPreflightReport {
  const failureReasonCodes = [...new Set(checks.flatMap((item) => item.ok || !item.reasonCode ? [] : [item.reasonCode]))];
  return {
    schemaVersion: PREFLIGHT_SCHEMA_VERSION,
    stage: "v1_9_product_preflight",
    ok: failureReasonCodes.length === 0 && checks.every((item) => item.ok),
    providerRequestCount: 0,
    failureReasonCodes,
    checks,
  };
}

function stableFailure(reasonCode: V1_9ProductPreflightReason) {
  return Object.assign(new Error(reasonCode), { reasonCode });
}

function isStableFailure(error: unknown, reasonCode: V1_9ProductPreflightReason) {
  return isRecord(error) && error.reasonCode === reasonCode;
}

function requiredIdentityText(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error("invalid");
  return normalized;
}

function normalizeRelativeRunRoot(value: unknown): string {
  const normalized = requiredIdentityText(value).replaceAll("\\", "/");
  if (!/^test-results\/v1-9-[a-z0-9._-]+$/i.test(normalized) || normalized.includes("..")) throw new Error("invalid");
  return normalized;
}

function normalizeRelativeFilePath(value: unknown): string {
  const normalized = requiredIdentityText(value).replaceAll("\\", "/");
  if (!/^test-results\/v1-9-[a-z0-9._-]+\/(?:run-manifest|run-state)\.json$/i.test(normalized) ||
      normalized.includes("..")) {
    throw new Error("invalid");
  }
  return normalized;
}

function requiredDigest(value: unknown): string {
  const normalized = requiredIdentityText(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error("invalid");
  return normalized;
}

function normalizedSkillLock(value: V1_9SkillLock): V1_9SkillLock {
  return {
    schemaVersion: "v1-9-skill-lock.v1",
    projectionLockDigest: value.projectionLockDigest.toLowerCase(),
    bindingPolicyDigest: value.bindingPolicyDigest.toLowerCase(),
    activeSkills: [...value.activeSkills]
      .map((skill) => ({ name: skill.name, version: skill.version }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isOwnedChild(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function assertExactFields(value: Record<string, unknown>, expectedFields: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("invalid");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMainModule(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  void runMain();
}

async function runMain() {
  await import("dotenv/config");
  const result = await runV1_9ProductPreflight();
  process.stdout.write(serializeV1_9ProductPreflight(result));
  if (!result.ok) process.exitCode = 2;
}
