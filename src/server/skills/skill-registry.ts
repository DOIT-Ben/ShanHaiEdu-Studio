import { createHash } from "node:crypto";
import { access, readFile as defaultReadFile, readdir } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

import { parseSkillContractSchema } from "./skill-contract-schema";
import {
  SHANHAI_SKILL_PROTOCOL_VERSION,
  SHANHAI_SKILL_REGISTRY_VERSION,
  toSkillDescriptor,
  type LoadedSkillContractSchema,
  type RegisteredSkill,
  type SkillContractRef,
  type SkillDescriptor,
  type SkillHumanGateCondition,
  type SkillSideEffect,
} from "./skill-runtime-types";

const SKILL_NAME_PATTERN = /^shanhai-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_PATTERN = /^\d+\.\d+$/;
const SKILL_DIRECTORY_PATTERN = /^shanhai-[a-z0-9]+(?:-[a-z0-9]+)*-\d+\.\d+$/;
const ARTIFACT_TYPE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/i;
const registryFields = new Set([
  "schema_version",
  "protocol_version",
  "suite_name",
  "suite_version",
  "language",
  "skills",
]);
const skillFields = new Set([
  "name",
  "version",
  "directory",
  "entrypoint",
  "display_name",
  "responsibility",
  "triggers",
  "input_artifacts",
  "output_artifacts",
  "contracts",
  "capabilities",
  "side_effects",
  "human_gate_conditions",
  "upstream",
  "downstream",
  "status",
]);
const contractFields = new Set(["artifact_type", "contract_version"]);
const producedContractFields = new Set(["artifact_type", "contract_version", "schema_path"]);
const contractsFields = new Set(["consumes", "produces"]);
const capabilitiesFields = new Set(["required", "optional"]);
const skillStatuses = new Set(["active", "disabled"] as const);
const sideEffects = new Set<SkillSideEffect>([
  "artifact_write",
  "external_generation",
  "external_publish",
  "destructive_write",
]);
const humanGateConditions = new Set<SkillHumanGateCondition>([
  "business_choice",
  "missing_authorization",
  "paid_external_generation",
  "external_publish",
  "destructive_write",
]);
const runtimeLockFields = new Set(["schemaVersion", "protocolVersion", "suiteVersion", "skills"]);
const runtimeLockEntryFields = new Set([
  "name",
  "version",
  "sourceDirectory",
  "runtimeDirectory",
  "contentDigest",
]);

export type SkillRegistryConfig =
  | { kind: "projection"; projectionRoot: string }
  | { kind: "registry"; registryPath: string; skillsRoot: string };

type RegistryDependencies = {
  readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
  access?: (filePath: string) => Promise<void>;
  contentDigest?: (root: string) => Promise<string>;
};

type RuntimeLockEntry = {
  name: string;
  version: string;
  sourceDirectory: string;
  runtimeDirectory: string;
  contentDigest: string;
};

type RuntimeProjectionLock = {
  suiteVersion: string;
  entries: Map<string, RuntimeLockEntry>;
};

type RegistrySource = {
  registryPath: string;
  skillsRoot: string;
  lock?: RuntimeProjectionLock;
};

type ContractSchemaBinding = {
  artifactType: string;
  contractVersion: string;
  schemaFilePath: string;
};

export type SkillRegistryConfigurationReason =
  | "skill_runtime_config_partial"
  | "skill_runtime_config_ambiguous";

export class SkillRegistryConfigurationError extends Error {
  constructor(readonly reasonCode: SkillRegistryConfigurationReason) {
    super(reasonCode === "skill_runtime_config_partial"
      ? "Skill Runtime configuration is incomplete."
      : "Skill Runtime configuration has multiple sources.");
    this.name = "SkillRegistryConfigurationError";
  }
}

export class SkillRegistryIntegrityError extends Error {
  readonly reasonCode = "skill_runtime_lock_digest_mismatch" as const;

  constructor() {
    super("Skill Runtime projection integrity check failed.");
    this.name = "SkillRegistryIntegrityError";
  }
}

export class SkillRegistry {
  private constructor(
    private readonly skills: RegisteredSkill[],
    private readonly projectionLockDigest: string | null,
    private readonly checkAccess: (filePath: string) => Promise<void>,
    private readonly projectionLockEntries: Map<string, RuntimeLockEntry> | null,
    private readonly computeDigest: (root: string) => Promise<string>,
    private readonly contractSchemaBindings: Map<string, ContractSchemaBinding[]>,
    private readonly readTextFile: (filePath: string, encoding: BufferEncoding) => Promise<string>,
  ) {}

  static async open(config: SkillRegistryConfig, dependencies: RegistryDependencies = {}): Promise<SkillRegistry> {
    const readFile = dependencies.readFile ?? ((filePath, encoding) => defaultReadFile(filePath, encoding));
    const checkAccess = dependencies.access ?? access;
    const source = await resolveRegistrySource(config, readFile);
    if (source.lock) {
      await verifyProjectionLock(
        source.skillsRoot,
        source.lock.entries,
        dependencies.contentDigest ?? computeContentDigest,
      );
    }
    const raw = parse(await readFile(source.registryPath, "utf8"));
    const parsedRegistry = parseRegistry(raw, source);
    for (const skill of parsedRegistry.skills) {
      await checkAccess(skill.entrypointPath);
      for (const binding of parsedRegistry.contractSchemaBindings.get(skill.name) ?? []) {
        await checkAccess(binding.schemaFilePath);
      }
    }
    return new SkillRegistry(
      parsedRegistry.skills,
      source.lock ? digestProjectionLock(source.lock) : null,
      checkAccess,
      source.lock ? new Map(source.lock.entries) : null,
      dependencies.contentDigest ?? computeContentDigest,
      parsedRegistry.contractSchemaBindings,
      readFile,
    );
  }

  discoverActive(): SkillDescriptor[] {
    return this.skills.map(toSkillDescriptor);
  }

  listActive(): RegisteredSkill[] {
    return this.skills.map((skill) => structuredClone(skill));
  }

  get(skillName: string): RegisteredSkill {
    const skill = this.skills.find((candidate) => candidate.name === skillName);
    if (!skill) throw new Error(`Unknown or inactive ShanHai Skill: ${skillName}`);
    return structuredClone(skill);
  }

  getProjectionLockDigest(): string | null {
    return this.projectionLockDigest;
  }

  async verifyIntegrity(skillName: string): Promise<void> {
    if (!this.projectionLockEntries) return;
    const skill = this.get(skillName);
    const lock = this.projectionLockEntries.get(skillName);
    if (!lock) throw new SkillRegistryIntegrityError();
    let actual: string;
    try {
      actual = `sha256:${await this.computeDigest(skill.skillRoot)}`.toLowerCase();
    } catch {
      throw new SkillRegistryIntegrityError();
    }
    if (actual !== lock.contentDigest) throw new SkillRegistryIntegrityError();
  }

  async loadContractSchemasForLoader(skillName: string): Promise<LoadedSkillContractSchema[]> {
    this.get(skillName);
    const loaded: LoadedSkillContractSchema[] = [];
    for (const binding of this.contractSchemaBindings.get(skillName) ?? []) {
      await this.verifyIntegrity(skillName);
      const content = await this.readTextFile(binding.schemaFilePath, "utf8");
      await this.verifyIntegrity(skillName);
      loaded.push(parseSkillContractSchema({
        artifactType: binding.artifactType,
        contractVersion: binding.contractVersion,
        content,
      }));
    }
    return loaded.map((schema) => structuredClone(schema));
  }

  async validateReferencePaths(skillName: string, referencePaths: readonly string[]): Promise<void> {
    const skill = this.get(skillName);
    for (const referencePath of [...new Set(referencePaths)]) {
      const normalized = referencePath.replaceAll("\\", "/");
      if (!normalized.startsWith("references/") || normalized.includes("..")) {
        throw new Error("Skill reference path is invalid.");
      }
      const referencesRoot = safeChild(skill.skillRoot, "references", `${skillName} references root`);
      const resolved = safeChild(skill.skillRoot, normalized, `${skillName} reference`);
      const relative = path.relative(referencesRoot, resolved);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Skill reference path escapes references root.");
      }
      await this.checkAccess(resolved);
    }
  }
}

export function skillRegistryConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SkillRegistryConfig | null {
  const projectionRoot = env.SHANHAI_SKILLS_RUNTIME_ROOT?.trim();
  const registryPath = env.SHANHAI_SKILLS_REGISTRY_PATH?.trim();
  const skillsRoot = env.SHANHAI_SKILLS_ROOT?.trim();
  if (projectionRoot && (registryPath || skillsRoot)) {
    throw new SkillRegistryConfigurationError("skill_runtime_config_ambiguous");
  }
  if (projectionRoot) return { kind: "projection", projectionRoot };
  if (registryPath && skillsRoot) return { kind: "registry", registryPath, skillsRoot };
  if (registryPath || skillsRoot) {
    throw new SkillRegistryConfigurationError("skill_runtime_config_partial");
  }
  return null;
}

async function resolveRegistrySource(
  config: SkillRegistryConfig,
  readFile: (filePath: string, encoding: BufferEncoding) => Promise<string>,
): Promise<RegistrySource> {
  if (config.kind === "registry") {
    return {
      registryPath: path.resolve(config.registryPath),
      skillsRoot: path.resolve(config.skillsRoot),
    };
  }
  const projectionRoot = path.resolve(config.projectionRoot);
  const lockPath = path.join(projectionRoot, "shanhai-skills.lock.json");
  const lock = parseRuntimeLock(JSON.parse(await readFile(lockPath, "utf8")));
  return {
    registryPath: path.join(projectionRoot, "shanhai-suite", "assets", "registry.yaml"),
    skillsRoot: projectionRoot,
    lock,
  };
}

function parseRegistry(
  value: unknown,
  source: RegistrySource,
): { skills: RegisteredSkill[]; contractSchemaBindings: Map<string, ContractSchemaBinding[]> } {
  const registry = object(value, "registry");
  requireOnlyFields(registry, registryFields, "registry");
  requireExact(registry.schema_version, SHANHAI_SKILL_REGISTRY_VERSION, "registry schema_version");
  requireExact(registry.protocol_version, SHANHAI_SKILL_PROTOCOL_VERSION, "registry protocol_version");
  requireExact(registry.suite_name, "shanhai-suite", "registry suite_name");
  const suiteVersion = requireVersion(registry.suite_version, "registry suite_version");
  if (source.lock && source.lock.suiteVersion !== suiteVersion) {
    throw new Error("Runtime projection lock suiteVersion must match registry suite_version.");
  }
  const suiteLock = source.lock?.entries.get("shanhai-suite");
  if (source.lock && (
    !suiteLock ||
    suiteLock.version !== suiteVersion ||
    suiteLock.sourceDirectory !== "shanhai-suite"
  )) {
    throw new Error("Runtime projection lock must bind the active suite version and sourceDirectory.");
  }
  const language = text(registry.language, "registry language");
  if (language.length < 2) throw new Error("registry language must contain at least two characters.");
  const entries = nonEmptyArray(registry.skills, "registry skills");
  const activeNames = new Set<string>();
  const contractSchemaBindings = new Map<string, ContractSchemaBinding[]>();

  const skills = entries.flatMap((entry, index) => {
    const skill = object(entry, `registry skills[${index}]`);
    requireOnlyFields(skill, skillFields, `registry skills[${index}]`);
    const status = enumValue(skill.status, skillStatuses, `registry skills[${index}] status`);
    const name = text(skill.name, "name");
    if (!SKILL_NAME_PATTERN.test(name)) throw new Error(`Invalid ShanHai Skill name: ${name}`);
    const version = requireVersion(skill.version, `${name} version`);
    const directory = text(skill.directory, `${name} directory`);
    if (!SKILL_DIRECTORY_PATTERN.test(directory)) throw new Error(`Invalid directory for ${name}: ${directory}`);
    const entrypoint = text(skill.entrypoint, `${name} entrypoint`);
    if (entrypoint !== "SKILL.md") throw new Error(`${name} entrypoint must be SKILL.md.`);
    const parsed = {
      displayName: text(skill.display_name, `${name} display_name`),
      responsibility: text(skill.responsibility, `${name} responsibility`),
      triggers: textArray(skill.triggers, `${name} triggers`, 1),
      inputArtifacts: textArray(skill.input_artifacts, `${name} input_artifacts`, 1),
      outputArtifacts: textArray(skill.output_artifacts, `${name} output_artifacts`, 1),
      contracts: parseContracts(skill.contracts, name),
      capabilities: parseCapabilities(skill.capabilities, name),
      sideEffects: enumArray(skill.side_effects, sideEffects, `${name} side_effects`),
      humanGateConditions: enumArray(
        skill.human_gate_conditions,
        humanGateConditions,
        `${name} human_gate_conditions`,
      ),
      upstream: skillNameArray(skill.upstream, `${name} upstream`),
      downstream: skillNameArray(skill.downstream, `${name} downstream`),
    };
    if (status === "disabled") return [];
    if (activeNames.has(name)) throw new Error(`Duplicate active ShanHai Skill: ${name}`);
    activeNames.add(name);
    const lock = source.lock?.entries.get(name);
    if (source.lock && (!lock || lock.version !== version)) {
      throw new Error(`Runtime projection lock does not bind ${name}@${version}.`);
    }
    if (lock && lock.sourceDirectory !== directory) {
      throw new Error(`Runtime projection lock sourceDirectory does not match ${name} directory.`);
    }
    const runtimeDirectory = lock?.runtimeDirectory ?? directory;
    const skillRoot = safeChild(source.skillsRoot, runtimeDirectory, `${name} runtime directory`);
    const entrypointPath = safeChild(skillRoot, entrypoint, `${name} entrypoint`);
    contractSchemaBindings.set(name, parsed.contracts.produces.map((contract) => ({
      artifactType: contract.artifactType,
      contractVersion: contract.contractVersion,
      schemaFilePath: resolveContractSchemaFile({
        skillName: name,
        skillRoot,
        sourceDirectory: directory,
        schemaPath: contract.schemaPath,
      }),
    })));

    return [{
      name,
      version,
      directory,
      entrypoint,
      skillRoot,
      entrypointPath,
      ...parsed,
      status: "active" as const,
    }];
  });
  return { skills, contractSchemaBindings };
}

function parseRuntimeLock(value: unknown): RuntimeProjectionLock {
  const lock = object(value, "runtime projection lock");
  requireOnlyFields(lock, runtimeLockFields, "runtime projection lock");
  requireExact(lock.schemaVersion, "shanhai-runtime-projection-lock/v1", "runtime lock schemaVersion");
  requireExact(lock.protocolVersion, SHANHAI_SKILL_PROTOCOL_VERSION, "runtime lock protocolVersion");
  const suiteVersion = requireVersion(lock.suiteVersion, "runtime lock suiteVersion");
  const result = new Map<string, RuntimeLockEntry>();
  for (const [index, rawEntry] of array(lock.skills, "runtime lock skills").entries()) {
    const entry = object(rawEntry, `runtime lock skills[${index}]`);
    requireOnlyFields(entry, runtimeLockEntryFields, `runtime lock skills[${index}]`);
    const name = text(entry.name, "runtime lock skill name");
    const version = requireVersion(entry.version, `${name} lock version`);
    const sourceDirectory = safeRelativeDirectory(entry.sourceDirectory, `${name} sourceDirectory`);
    const runtimeDirectory = safeRelativeDirectory(entry.runtimeDirectory, `${name} runtimeDirectory`);
    const contentDigest = text(entry.contentDigest, `${name} contentDigest`);
    if (!SKILL_NAME_PATTERN.test(name) || !DIGEST_PATTERN.test(contentDigest)) {
      throw new Error(`Invalid runtime lock entry for ${name}.`);
    }
    if (result.has(name)) throw new Error(`Duplicate runtime lock Skill: ${name}`);
    result.set(name, {
      name,
      version,
      sourceDirectory,
      runtimeDirectory,
      contentDigest: contentDigest.toLowerCase(),
    });
  }
  return { suiteVersion, entries: result };
}

function digestProjectionLock(lock: RuntimeProjectionLock): string {
  const skills = [...lock.entries.values()]
    .sort((left, right) => compareText(left.name, right.name))
    .map(({ name, version, sourceDirectory, runtimeDirectory, contentDigest }) => ({
      name,
      version,
      sourceDirectory,
      runtimeDirectory,
      contentDigest,
    }));
  return createHash("sha256").update(JSON.stringify({ suiteVersion: lock.suiteVersion, skills })).digest("hex");
}

async function verifyProjectionLock(
  projectionRoot: string,
  lockEntries: Map<string, RuntimeLockEntry>,
  contentDigest: (root: string) => Promise<string>,
) {
  const sourceDirectories = new Set<string>();
  const runtimeDirectories = new Set<string>();
  for (const entry of lockEntries.values()) {
    if (sourceDirectories.has(entry.sourceDirectory)) throw new SkillRegistryIntegrityError();
    if (runtimeDirectories.has(entry.runtimeDirectory)) throw new SkillRegistryIntegrityError();
    sourceDirectories.add(entry.sourceDirectory);
    runtimeDirectories.add(entry.runtimeDirectory);
    const runtimeRoot = safeChild(projectionRoot, entry.runtimeDirectory, "runtime lock directory");
    let actual: string;
    try {
      actual = `sha256:${await contentDigest(runtimeRoot)}`.toLowerCase();
    } catch {
      throw new SkillRegistryIntegrityError();
    }
    if (actual !== entry.contentDigest) throw new SkillRegistryIntegrityError();
  }
}

async function computeContentDigest(root: string) {
  const digest = createHash("sha256");
  const files = await listReleaseFiles(root);
  for (const filePath of files) {
    const relative = path.relative(root, filePath).replaceAll("\\", "/");
    const relativeBytes = Buffer.from(relative, "utf8");
    const content = await defaultReadFile(filePath);
    digest.update(uint64(relativeBytes.length));
    digest.update(relativeBytes);
    digest.update(uint64(content.length));
    digest.update(content);
  }
  return digest.digest("hex");
}

async function listReleaseFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (["__pycache__", ".pytest_cache", "output", "dist", "build"].includes(entry.name)) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && isReleaseFile(entry.name)) {
        files.push(entryPath);
      }
    }
  }
  await visit(root);
  return files.sort((left, right) => compareText(
    path.relative(root, left).replaceAll("\\", "/"),
    path.relative(root, right).replaceAll("\\", "/"),
  ));
}

function isReleaseFile(fileName: string) {
  if (fileName === ".env" || fileName === ".env.local") return false;
  if (fileName.startsWith(".env.") && fileName !== ".env.example") return false;
  return !/\.(?:pyc|pyo)$/i.test(fileName);
}

function uint64(value: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseContracts(value: unknown, skillName: string) {
  const contracts = object(value, `${skillName} contracts`);
  requireOnlyFields(contracts, contractsFields, `${skillName} contracts`);
  return {
    consumes: contractArray(contracts.consumes, `${skillName} consumes`, false),
    produces: contractArray(contracts.produces, `${skillName} produces`, true),
  };
}

function contractArray(value: unknown, label: string, produced: boolean): SkillContractRef[] {
  const values = produced ? nonEmptyArray(value, label) : array(value, label);
  const contracts = values.map((raw, index) => {
    const contract = object(raw, `${label}[${index}]`);
    requireOnlyFields(
      contract,
      produced ? producedContractFields : contractFields,
      `${label}[${index}]`,
    );
    const artifactType = text(contract.artifact_type, `${label} artifact_type`);
    if (!ARTIFACT_TYPE_PATTERN.test(artifactType)) {
      throw new Error(`Invalid artifact_type in ${label}: ${artifactType}`);
    }
    return {
      artifactType,
      contractVersion: text(contract.contract_version, `${label} contract_version`),
      ...(produced ? { schemaPath: text(contract.schema_path, `${label} schema_path`) } : {}),
    };
  });
  requireUnique(contracts.map((contract) => JSON.stringify(contract)), label);
  return contracts;
}

function parseCapabilities(value: unknown, skillName: string) {
  const capabilities = object(value, `${skillName} capabilities`);
  requireOnlyFields(capabilities, capabilitiesFields, `${skillName} capabilities`);
  const required = textArray(capabilities.required, `${skillName} required capabilities`);
  const optional = textArray(capabilities.optional, `${skillName} optional capabilities`);
  for (const capability of [...required, ...optional]) {
    if (!CAPABILITY_PATTERN.test(capability)) throw new Error(`Invalid capability for ${skillName}: ${capability}`);
  }
  return { required, optional };
}

function resolveContractSchemaFile(input: {
  skillName: string;
  skillRoot: string;
  sourceDirectory: string;
  schemaPath: string | undefined;
}) {
  const schemaPath = text(input.schemaPath, `${input.skillName} schema_path`);
  if (path.isAbsolute(schemaPath) || schemaPath.includes("\\")) {
    throw new Error(`${input.skillName} schema_path must be a portable relative path.`);
  }
  const segments = schemaPath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${input.skillName} schema_path escapes its Skill root.`);
  }
  if (segments[0] !== input.sourceDirectory || segments.length < 2) {
    throw new Error(`${input.skillName} schema_path must be rooted at its registered source directory.`);
  }
  return safeChild(input.skillRoot, segments.slice(1).join("/"), `${input.skillName} contract Schema`);
}

function safeRelativeDirectory(value: unknown, label: string) {
  const directory = text(value, label);
  if (path.isAbsolute(directory) || directory.includes("\\")) {
    throw new Error(`${label} must be a portable relative directory.`);
  }
  const segments = directory.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} escapes the projection root.`);
  }
  return directory;
}

function safeChild(root: string, relativePath: string, label: string) {
  if (path.isAbsolute(relativePath)) throw new Error(`${label} must be relative.`);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes its configured root.`);
  }
  return resolved;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function nonEmptyArray(value: unknown, label: string): unknown[] {
  const values = array(value, label);
  if (values.length === 0) throw new Error(`${label} must contain at least one item.`);
  return values;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty text.`);
  return value.trim();
}

function textArray(value: unknown, label: string, minimumItems = 0): string[] {
  const values = minimumItems > 0 ? nonEmptyArray(value, label) : array(value, label);
  const parsed = values.map((item) => text(item, label));
  requireUnique(parsed, label);
  return parsed;
}

function skillNameArray(value: unknown, label: string): string[] {
  const values = textArray(value, label);
  for (const name of values) {
    if (!SKILL_NAME_PATTERN.test(name)) throw new Error(`Invalid Skill name in ${label}: ${name}`);
  }
  return values;
}

function enumArray<T extends string>(value: unknown, allowed: Set<T>, label: string): T[] {
  return textArray(value, label).map((item) => {
    if (!allowed.has(item as T)) throw new Error(`Unsupported ${label}: ${item}`);
    return item as T;
  });
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, label: string): T {
  const parsed = text(value, label);
  if (!allowed.has(parsed as T)) throw new Error(`Unsupported ${label}: ${parsed}`);
  return parsed as T;
}

function requireOnlyFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string) {
  const unknownFields = Object.keys(value).filter((field) => !allowed.has(field));
  if (unknownFields.length > 0) {
    throw new Error(`${label} contains unknown field: ${unknownFields.join(", ")}`);
  }
}

function requireUnique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate items.`);
}

function requireExact(value: unknown, expected: string, label: string) {
  if (value !== expected) throw new Error(`${label} must be ${expected}.`);
}

function requireVersion(value: unknown, label: string): string {
  const version = text(value, label);
  if (!VERSION_PATTERN.test(version)) throw new Error(`${label} must use MAJOR.MINOR.`);
  return version;
}
