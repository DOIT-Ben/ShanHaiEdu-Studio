import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";

import { SkillLoader } from "@/server/skills/skill-loader";
import { SkillRegistry } from "@/server/skills/skill-registry";

const cleanup: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  const { rm } = await import("node:fs/promises");
  await Promise.all(cleanup.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ShanHai Skill registry and lazy loader", () => {
  it("discovers active skills from a structured registry without loading SKILL.md bodies", async () => {
    const fixture = await createSourceRegistryFixture();
    const readFile = vi.fn(async (filePath: string, encoding: BufferEncoding) => {
      const fs = await import("node:fs/promises");
      return fs.readFile(filePath, encoding);
    });

    const registry = await SkillRegistry.open({
      kind: "registry",
      registryPath: fixture.registryPath,
      skillsRoot: fixture.root,
    }, { readFile });

    expect(registry.discoverActive().map((skill) => skill.name)).toEqual([
      "shanhai-jiaoan",
      "shanhai-ppt",
    ]);
    expect(readFile.mock.calls.map(([filePath]) => path.basename(String(filePath)))).toEqual(["registry.yaml"]);
    expect(registry.discoverActive()[0]).not.toHaveProperty("entrypointPath");
  });

  it("discovers the same active version through a runtime projection lock", async () => {
    const fixture = await createProjectionFixture();
    const registry = await SkillRegistry.open({ kind: "projection", projectionRoot: fixture.root });

    expect(registry.discoverActive().map((skill) => [skill.name, skill.version])).toEqual([
      ["shanhai-jiaoan", "1.1"],
      ["shanhai-ppt", "1.0"],
    ]);
  });

  it("maps versioned schema_path values through sourceDirectory -> runtimeDirectory without exposing absolute paths", async () => {
    const fixture = await createProjectionFixture();
    const registry = await SkillRegistry.open({ kind: "projection", projectionRoot: fixture.root });
    const loader = new SkillLoader(registry);

    const descriptor = registry.discoverActive().find((skill) => skill.name === "shanhai-ppt");
    const loaded = await loader.loadSelected({
      selectedBy: "main_agent",
      skillName: "shanhai-ppt",
      referencePaths: [],
    });

    expect(descriptor?.contracts.produces[0].schemaPath).toBe("shanhai-ppt-1.0/assets/schema.json");
    expect(path.isAbsolute(descriptor?.contracts.produces[0].schemaPath ?? "")).toBe(false);
    expect(loaded.contractSchemas).toEqual([{
      artifactType: "ppt-package",
      contractVersion: "1.0",
      schema: expect.objectContaining({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        properties: expect.objectContaining({ schemaVersion: { const: "1.0" } }),
      }),
      schemaSha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    }]);
    expect(JSON.stringify(loaded.contractSchemas)).not.toContain(path.resolve(fixture.root));
  });

  it("rejects a runtime projection whose content no longer matches the lock digest", async () => {
    const fixture = await createProjectionFixture();
    await writeFile(path.join(fixture.root, "shanhai-ppt", "SKILL.md"), "TAMPERED", "utf8");

    await expect(SkillRegistry.open({ kind: "projection", projectionRoot: fixture.root }))
      .rejects.toMatchObject({ reasonCode: "skill_runtime_lock_digest_mismatch" });
  });

  it("revalidates the projection lock when lazily reading a Skill after Registry open", async () => {
    const fixture = await createProjectionFixture();
    const registry = await SkillRegistry.open({ kind: "projection", projectionRoot: fixture.root });
    const loader = new SkillLoader(registry);
    await writeFile(path.join(fixture.root, "shanhai-ppt", "references", "ppt-rules.md"), "TAMPERED AFTER OPEN", "utf8");

    await expect(loader.loadSelected({
      selectedBy: "main_agent",
      skillName: "shanhai-ppt",
      referencePaths: ["references/ppt-rules.md"],
    })).rejects.toMatchObject({ reasonCode: "skill_runtime_lock_digest_mismatch" });
  });

  it("revalidates the projection lock after reading a contract Schema", async () => {
    const fixture = await createProjectionFixture();
    let tamperDuringSchemaRead = false;
    const registry = await SkillRegistry.open({ kind: "projection", projectionRoot: fixture.root }, {
      readFile: async (filePath, encoding) => {
        const content = await readFile(filePath, encoding);
        if (tamperDuringSchemaRead && path.basename(filePath) === "schema.json") {
          tamperDuringSchemaRead = false;
          await writeFile(path.join(fixture.root, "shanhai-ppt", "SKILL.md"), "TAMPERED DURING SCHEMA READ", "utf8");
        }
        return content;
      },
    });
    const loader = new SkillLoader(registry);
    tamperDuringSchemaRead = true;

    await expect(loader.loadSelected({
      selectedBy: "main_agent",
      skillName: "shanhai-ppt",
      referencePaths: [],
    })).rejects.toMatchObject({ reasonCode: "skill_runtime_lock_digest_mismatch" });
  });

  it("loads only the Main Agent selected skill and explicitly requested references", async () => {
    const fixture = await createSourceRegistryFixture();
    const registry = await SkillRegistry.open({
      kind: "registry",
      registryPath: fixture.registryPath,
      skillsRoot: fixture.root,
    });
    const readFile = vi.fn(async (filePath: string, encoding: BufferEncoding) => {
      const fs = await import("node:fs/promises");
      return fs.readFile(filePath, encoding);
    });
    const loader = new SkillLoader(registry, { readFile });

    const loaded = await loader.loadSelected({
      selectedBy: "main_agent",
      skillName: "shanhai-ppt",
      referencePaths: ["references/ppt-rules.md"],
    });

    expect(loaded.instructions).toContain("PPT ONLY");
    expect(loaded.references).toEqual({ "references/ppt-rules.md": "PPT RULES" });
    expect(readFile.mock.calls.map(([filePath]) => path.normalize(String(filePath)))).toEqual([
      path.join(fixture.root, "shanhai-ppt-1.0", "SKILL.md"),
      path.join(fixture.root, "shanhai-ppt-1.0", "references", "ppt-rules.md"),
    ]);
    expect(readFile.mock.calls.some(([filePath]) => String(filePath).includes("shanhai-jiaoan"))).toBe(false);
  });

  it("fails closed when the Registry surface cannot supply bound contract Schemas", async () => {
    const fixture = await createSourceRegistryFixture();
    const registry = await SkillRegistry.open({
      kind: "registry",
      registryPath: fixture.registryPath,
      skillsRoot: fixture.root,
    });
    const loader = new SkillLoader({ get: registry.get.bind(registry) });

    await expect(loader.loadSelected({
      selectedBy: "main_agent",
      skillName: "shanhai-ppt",
      referencePaths: [],
    })).rejects.toThrow(/Schema loader is unavailable/i);
  });

  it("rejects non-Main-Agent loading and reference traversal", async () => {
    const fixture = await createSourceRegistryFixture();
    const registry = await SkillRegistry.open({
      kind: "registry",
      registryPath: fixture.registryPath,
      skillsRoot: fixture.root,
    });
    const loader = new SkillLoader(registry);

    await expect(loader.loadSelected({
      selectedBy: "compatibility_layer" as "main_agent",
      skillName: "shanhai-ppt",
      referencePaths: [],
    })).rejects.toThrow(/Main Agent/i);
    await expect(loader.loadSelected({
      selectedBy: "main_agent",
      skillName: "shanhai-ppt",
      referencePaths: ["../shanhai-jiaoan-1.1/SKILL.md"],
    })).rejects.toThrow(/reference/i);
  });
});

describe("ShanHai Skill registry schema boundary", () => {
  it("rejects a produced contract without its required schema_path", async () => {
    await expectRegistryRejected((registry) => {
      const produced = producedContracts(firstSkill(registry));
      delete produced[0].schema_path;
    }, /schema_path/i);
  });

  it.each([
    ["suite_name", (registry: RegistryDocument) => { registry.suite_name = "another-suite"; }],
    ["language", (registry: RegistryDocument) => { registry.language = "x"; }],
  ])("rejects an invalid registry %s", async (_field, mutate) => {
    await expectRegistryRejected(mutate, new RegExp(String(_field), "i"));
  });

  it.each([
    ["registry", (registry: RegistryDocument) => { registry.unexpected = true; }],
    ["skill", (registry: RegistryDocument) => { firstSkill(registry).unexpected = true; }],
    ["contracts", (registry: RegistryDocument) => {
      record(firstSkill(registry).contracts, "contracts").unexpected = true;
    }],
    ["produced contract", (registry: RegistryDocument) => {
      producedContracts(firstSkill(registry))[0].unexpected = true;
    }],
    ["capabilities", (registry: RegistryDocument) => {
      record(firstSkill(registry).capabilities, "capabilities").unexpected = true;
    }],
  ])("rejects unknown fields on %s objects", async (_scope, mutate) => {
    await expectRegistryRejected(mutate, /unknown field/i);
  });

  it.each([
    ["skills", (registry: RegistryDocument) => { registry.skills = []; }],
    ["triggers", (registry: RegistryDocument) => { firstSkill(registry).triggers = []; }],
    ["input_artifacts", (registry: RegistryDocument) => { firstSkill(registry).input_artifacts = []; }],
    ["output_artifacts", (registry: RegistryDocument) => { firstSkill(registry).output_artifacts = []; }],
    ["contracts.produces", (registry: RegistryDocument) => {
      record(firstSkill(registry).contracts, "contracts").produces = [];
    }],
  ])("rejects an empty required %s array", async (_field, mutate) => {
    await expectRegistryRejected(mutate, /at least one item/i);
  });

  it("rejects a status outside the authoritative active/disabled enum", async () => {
    await expectRegistryRejected((registry) => {
      firstSkill(registry).status = "inactive";
    }, /status/i);
  });

  it.each([
    ["directory", (registry: RegistryDocument) => { firstSkill(registry).directory = "shanhai-jiaoan"; }],
    ["artifact_type", (registry: RegistryDocument) => {
      producedContracts(firstSkill(registry))[0].artifact_type = "Lesson_Plan";
    }],
    ["duplicate trigger", (registry: RegistryDocument) => {
      firstSkill(registry).triggers = ["生成教案", "生成教案"];
    }],
  ])("rejects a registry that violates the %s constraint", async (_constraint, mutate) => {
    await expectRegistryRejected(mutate, /invalid|duplicate/i);
  });

  it.each([
    ["registry", "missing file", "shanhai-ppt-1.0/assets/missing.schema.json"],
    ["registry", "another Skill root", "shanhai-jiaoan-1.1/assets/schema.json"],
    ["registry", "parent traversal", "shanhai-ppt-1.0/../shanhai-jiaoan-1.1/assets/schema.json"],
    ["projection", "missing file", "shanhai-ppt-1.0/assets/missing.schema.json"],
    ["projection", "another Skill root", "shanhai-jiaoan-1.1/assets/schema.json"],
    ["projection", "parent traversal", "shanhai-ppt-1.0/../shanhai-jiaoan-1.1/assets/schema.json"],
  ] as const)("rejects a %s schema_path with %s", async (mode, _case, schemaPath) => {
    await expectSchemaPathRejected(mode, schemaPath);
  });

  it.each(["registry", "projection"] as const)(
    "rejects an invalid Draft 2020-12 Schema in %s mode",
    async (mode) => {
      await expectSchemaRejected(mode, (schema) => {
        schema.$schema = "http://json-schema.org/draft-07/schema#";
      }, /Draft 2020-12/i);
    },
  );

  it("rejects a document that fails the Draft 2020-12 meta-schema", async () => {
    await expectSchemaRejected("registry", (schema) => {
      schema.required = "schemaVersion";
    }, /valid JSON Schema Draft 2020-12/i);
  });

  it.each(["registry", "projection"] as const)(
    "rejects schemaVersion.const drift from contract_version in %s mode",
    async (mode) => {
      await expectSchemaRejected(mode, (schema) => {
        record(record(schema.properties, "properties").schemaVersion, "schemaVersion").const = "wrong-version";
      }, /schemaVersion\.const|contract_version/i);
    },
  );

  it("rejects a projection lock whose suiteVersion drifts from the registry", async () => {
    const fixture = await createProjectionFixture();
    const lockPath = path.join(fixture.root, "shanhai-skills.lock.json");
    const lock = record(JSON.parse(await readFile(lockPath, "utf8")), "runtime lock");
    lock.suiteVersion = "9.9";
    await writeFile(lockPath, JSON.stringify(lock), "utf8");

    await expect(SkillRegistry.open({ kind: "projection", projectionRoot: fixture.root }))
      .rejects.toThrow(/suiteVersion|suite_version/i);
  });

  it("requires projection lock sourceDirectory to bind the registry directory", async () => {
    const fixture = await createProjectionFixture();
    const lockPath = path.join(fixture.root, "shanhai-skills.lock.json");
    const lock = record(JSON.parse(await readFile(lockPath, "utf8")), "runtime lock");
    const skills = lock.skills;
    if (!Array.isArray(skills)) throw new Error("runtime lock skills must be an array");
    record(skills.find((entry) => record(entry, "lock entry").name === "shanhai-ppt"), "ppt lock").sourceDirectory = "shanhai-ppt-9.9";
    await writeFile(lockPath, JSON.stringify(lock), "utf8");

    await expect(SkillRegistry.open({ kind: "projection", projectionRoot: fixture.root }))
      .rejects.toThrow(/sourceDirectory|directory/i);
  });
});

type RegistryDocument = Record<string, unknown>;

async function expectRegistryRejected(
  mutate: (registry: RegistryDocument) => void,
  expected: RegExp,
) {
  const fixture = await createSourceRegistryFixture();
  const registry = record(parse(await readFile(fixture.registryPath, "utf8")), "registry");
  mutate(registry);
  await writeFile(fixture.registryPath, stringify(registry), "utf8");

  await expect(SkillRegistry.open({
    kind: "registry",
    registryPath: fixture.registryPath,
    skillsRoot: fixture.root,
  })).rejects.toThrow(expected);
}

function firstSkill(registry: RegistryDocument) {
  const skills = registry.skills;
  if (!Array.isArray(skills) || skills.length === 0) throw new Error("fixture registry must contain a Skill");
  return record(skills[0], "skill");
}

function skillByName(registry: RegistryDocument, name: string) {
  const skills = registry.skills;
  if (!Array.isArray(skills)) throw new Error("fixture registry must contain Skills");
  const skill = skills.find((candidate) => record(candidate, "skill").name === name);
  return record(skill, `${name} Skill`);
}

function producedContracts(skill: RegistryDocument) {
  const contracts = record(skill.contracts, "contracts");
  if (!Array.isArray(contracts.produces) || contracts.produces.length === 0) {
    throw new Error("fixture Skill must contain a produced contract");
  }
  return contracts.produces.map((contract) => record(contract, "produced contract"));
}

function record(value: unknown, label: string): RegistryDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as RegistryDocument;
}

async function createSourceRegistryFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "shanhai-skill-registry-"));
  cleanup.push(root);
  const suiteAssets = path.join(root, "shanhai-suite", "assets");
  await mkdir(suiteAssets, { recursive: true });
  await createSkill(root, "shanhai-jiaoan-1.1", "shanhai-jiaoan/v2", "JIAOAN ONLY", "references/jiaoan-rules.md", "JIAOAN RULES");
  await createSkill(root, "shanhai-ppt-1.0", "1.0", "PPT ONLY", "references/ppt-rules.md", "PPT RULES");
  await createSkill(root, "shanhai-disabled-1.0", "1.0", "DISABLED", "references/disabled.md", "DISABLED RULES");
  const registryPath = path.join(suiteAssets, "registry.yaml");
  await writeFile(registryPath, registryYaml(), "utf8");
  return { root, registryPath };
}

async function createProjectionFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "shanhai-skill-projection-"));
  cleanup.push(root);
  const suiteAssets = path.join(root, "shanhai-suite", "assets");
  const registryPath = path.join(suiteAssets, "registry.yaml");
  await mkdir(suiteAssets, { recursive: true });
  await createSkill(root, "shanhai-jiaoan", "shanhai-jiaoan/v2", "JIAOAN ONLY", "references/jiaoan-rules.md", "JIAOAN RULES");
  await createSkill(root, "shanhai-ppt", "1.0", "PPT ONLY", "references/ppt-rules.md", "PPT RULES");
  await writeFile(registryPath, registryYaml(), "utf8");
  await writeFile(path.join(root, "shanhai-skills.lock.json"), JSON.stringify({
    schemaVersion: "shanhai-runtime-projection-lock/v1",
    protocolVersion: "shanhai-skill-protocol/v1",
    suiteVersion: "1.0",
    skills: [
      await lockEntry(root, "shanhai-jiaoan", "1.1"),
      await lockEntry(root, "shanhai-ppt", "1.0"),
      await lockEntry(root, "shanhai-suite", "1.0"),
    ],
  }), "utf8");
  return { root, registryPath };
}

async function createSkill(
  root: string,
  directory: string,
  contractVersion: string,
  body: string,
  reference: string,
  referenceBody: string,
) {
  const skillRoot = path.join(root, directory);
  await mkdir(path.join(skillRoot, "references"), { recursive: true });
  await mkdir(path.join(skillRoot, "assets"), { recursive: true });
  await writeFile(path.join(skillRoot, "SKILL.md"), `---\nname: ${directory.replace(/-\d+\.\d+$/, "")}\ndescription: fixture\n---\n${body}`, "utf8");
  await writeFile(path.join(skillRoot, reference), referenceBody, "utf8");
  await writeFile(path.join(skillRoot, "assets", "schema.json"), JSON.stringify(contractSchema(contractVersion)), "utf8");
}

function contractSchema(contractVersion: string): RegistryDocument {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://shanhai.test/${encodeURIComponent(contractVersion)}.schema.json`,
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion"],
    properties: {
      schemaVersion: { const: contractVersion },
    },
  };
}

async function expectSchemaRejected(
  mode: "registry" | "projection",
  mutate: (schema: RegistryDocument) => void,
  expected: RegExp,
) {
  const fixture = mode === "registry" ? await createSourceRegistryFixture() : await createProjectionFixture();
  const skillDirectory = mode === "registry" ? "shanhai-ppt-1.0" : "shanhai-ppt";
  const schemaPath = path.join(fixture.root, skillDirectory, "assets", "schema.json");
  const schema = record(JSON.parse(await readFile(schemaPath, "utf8")), "contract Schema");
  mutate(schema);
  await writeFile(schemaPath, JSON.stringify(schema), "utf8");
  if (mode === "projection") await refreshProjectionLock(fixture.root);
  const registry = await SkillRegistry.open(mode === "registry"
    ? { kind: "registry", registryPath: fixture.registryPath, skillsRoot: fixture.root }
    : { kind: "projection", projectionRoot: fixture.root });

  await expect(new SkillLoader(registry).loadSelected({
    selectedBy: "main_agent",
    skillName: "shanhai-ppt",
    referencePaths: [],
  })).rejects.toThrow(expected);
}

async function expectSchemaPathRejected(mode: "registry" | "projection", schemaPath: string) {
  const fixture = mode === "registry" ? await createSourceRegistryFixture() : await createProjectionFixture();
  const registry = record(parse(await readFile(fixture.registryPath, "utf8")), "registry");
  producedContracts(skillByName(registry, "shanhai-ppt"))[0].schema_path = schemaPath;
  await writeFile(fixture.registryPath, stringify(registry), "utf8");
  if (mode === "projection") await refreshProjectionLock(fixture.root);

  await expect(SkillRegistry.open(mode === "registry"
    ? { kind: "registry", registryPath: fixture.registryPath, skillsRoot: fixture.root }
    : { kind: "projection", projectionRoot: fixture.root }))
    .rejects.toThrow(/schema|root|escape|ENOENT/i);
}

async function refreshProjectionLock(root: string) {
  const lockPath = path.join(root, "shanhai-skills.lock.json");
  const lock = record(JSON.parse(await readFile(lockPath, "utf8")), "runtime lock");
  if (!Array.isArray(lock.skills)) throw new Error("runtime lock skills must be an array");
  for (const rawEntry of lock.skills) {
    const entry = record(rawEntry, "runtime lock entry");
    entry.contentDigest = `sha256:${await contentDigest(path.join(root, String(entry.runtimeDirectory)))}`;
  }
  await writeFile(lockPath, JSON.stringify(lock), "utf8");
}

async function lockEntry(root: string, name: string, version: string) {
  return {
    name,
    version,
    sourceDirectory: name === "shanhai-suite" ? name : `${name}-${version}`,
    runtimeDirectory: name,
    contentDigest: `sha256:${await contentDigest(path.join(root, name))}`,
  };
}

async function contentDigest(root: string) {
  const digest = createHash("sha256");
  const files = await releaseFiles(root);
  for (const filePath of files) {
    const relative = path.relative(root, filePath).replaceAll("\\", "/");
    const relativeBytes = Buffer.from(relative, "utf8");
    const content = await readFile(filePath);
    digest.update(uint64(relativeBytes.length));
    digest.update(relativeBytes);
    digest.update(uint64(content.length));
    digest.update(content);
  }
  return digest.digest("hex");
}

async function releaseFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (["__pycache__", ".pytest_cache", "output", "dist", "build"].includes(entry.name)) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile() && ![".env", ".env.local"].includes(entry.name) && !/^\.env\.(?!example$)/.test(entry.name) && !/\.(?:pyc|pyo)$/i.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }
  await visit(root);
  return files.sort((left, right) => {
    const leftRelative = path.relative(root, left).replaceAll("\\", "/");
    const rightRelative = path.relative(root, right).replaceAll("\\", "/");
    return leftRelative < rightRelative ? -1 : leftRelative > rightRelative ? 1 : 0;
  });
}

function uint64(value: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}

function registryYaml() {
  return `
schema_version: shanhai-skill-registry/v1
protocol_version: shanhai-skill-protocol/v1
suite_name: shanhai-suite
suite_version: "1.0"
language: zh-CN
skills:
  - name: shanhai-jiaoan
    version: "1.1"
    directory: shanhai-jiaoan-1.1
    entrypoint: SKILL.md
    display_name: 山海教案
    responsibility: 生成教案
    triggers: [生成教案, 修改教案]
    input_artifacts: [教材]
    output_artifacts: [lesson-plan.json]
    contracts:
      consumes: []
      produces:
        - artifact_type: lesson-plan
          contract_version: shanhai-jiaoan/v2
          schema_path: shanhai-jiaoan-1.1/assets/schema.json
    capabilities:
      required: [source.read, artifact.write, quality.validate]
      optional: [human.request_decision]
    side_effects: [artifact_write]
    human_gate_conditions: [business_choice, missing_authorization]
    upstream: []
    downstream: [shanhai-ppt]
    status: active
  - name: shanhai-ppt
    version: "1.0"
    directory: shanhai-ppt-1.0
    entrypoint: SKILL.md
    display_name: 山海课件
    responsibility: 生成课堂PPT
    triggers: [制作课堂PPT, 修改PPT]
    input_artifacts: [lesson-plan.json, 原始材料]
    output_artifacts: [ppt-package.json]
    contracts:
      consumes:
        - artifact_type: lesson-plan
          contract_version: shanhai-jiaoan/v2
      produces:
        - artifact_type: ppt-package
          contract_version: "1.0"
          schema_path: shanhai-ppt-1.0/assets/schema.json
    capabilities:
      required: [source.read, artifact.read, artifact.write, quality.validate]
      optional: [image.generate, human.request_decision]
    side_effects: [artifact_write, external_generation]
    human_gate_conditions: [business_choice, missing_authorization, paid_external_generation]
    upstream: [shanhai-jiaoan]
    downstream: []
    status: active
  - name: shanhai-disabled
    version: "1.0"
    directory: shanhai-disabled-1.0
    entrypoint: SKILL.md
    display_name: 已停用
    responsibility: 不得发现
    triggers: [停用]
    input_artifacts: [disabled-input]
    output_artifacts: [disabled-output.json]
    contracts:
      consumes: []
      produces:
        - artifact_type: disabled-output
          contract_version: "1.0"
          schema_path: shanhai-disabled-1.0/assets/schema.json
    capabilities: { required: [], optional: [] }
    side_effects: []
    human_gate_conditions: []
    upstream: []
    downstream: []
    status: disabled
`;
}
