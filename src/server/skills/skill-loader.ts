import { readFile as defaultReadFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import type { SkillRegistry } from "./skill-registry";
import {
  toSkillDescriptor,
  type LoadedSkillContractSchema,
  type SkillDescriptor,
} from "./skill-runtime-types";

type SkillLoaderDependencies = {
  readFile?: (filePath: string, encoding: BufferEncoding) => Promise<string>;
};

export type LoadedSkill = {
  descriptor: SkillDescriptor;
  instructions: string;
  references: Record<string, string>;
  contractSchemas?: LoadedSkillContractSchema[];
  provenance: {
    entrypointSha256: string;
    referenceSha256: Record<string, string>;
  };
};

export class SkillLoader {
  private readonly readFile: (filePath: string, encoding: BufferEncoding) => Promise<string>;

  constructor(
    private readonly registry: Pick<SkillRegistry, "get"> &
      Partial<Pick<SkillRegistry, "verifyIntegrity" | "loadContractSchemasForLoader">>,
    dependencies: SkillLoaderDependencies = {},
  ) {
    this.readFile = dependencies.readFile ?? ((filePath, encoding) => defaultReadFile(filePath, encoding));
  }

  async loadSelected(input: {
    selectedBy: "main_agent";
    skillName: string;
    referencePaths?: string[];
  }): Promise<LoadedSkill> {
    if (input.selectedBy !== "main_agent") {
      throw new Error("Only the Main Agent may select and load a ShanHai Skill.");
    }
    const skill = this.registry.get(input.skillName);
    const references: Record<string, string> = {};
    const referenceSha256: Record<string, string> = {};
    const instructions = await this.readVerifiedFile(skill.name, skill.entrypointPath);
    for (const referencePath of unique(input.referencePaths ?? [])) {
      const normalized = referencePath.replace(/\\/g, "/");
      if (!normalized.startsWith("references/") || normalized.includes("..")) {
        throw new Error(`Invalid Skill reference path: ${referencePath}`);
      }
      const absolutePath = safeReferencePath(skill.skillRoot, normalized);
      const content = await this.readVerifiedFile(skill.name, absolutePath);
      references[normalized] = content;
      referenceSha256[normalized] = digest(content);
    }
    if (!this.registry.loadContractSchemasForLoader) {
      throw new Error("Skill Registry contract Schema loader is unavailable.");
    }
    const contractSchemas = await this.registry.loadContractSchemasForLoader(skill.name);
    return {
      descriptor: toSkillDescriptor(skill),
      instructions,
      references,
      contractSchemas,
      provenance: {
        entrypointSha256: digest(instructions),
        referenceSha256,
      },
    };
  }

  private async readVerifiedFile(skillName: string, filePath: string): Promise<string> {
    await this.registry.verifyIntegrity?.(skillName);
    const content = await this.readFile(filePath, "utf8");
    await this.registry.verifyIntegrity?.(skillName);
    return content;
  }
}

function digest(content: string) {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}

function safeReferencePath(skillRoot: string, referencePath: string) {
  const referencesRoot = path.resolve(skillRoot, "references");
  const resolved = path.resolve(skillRoot, referencePath);
  const relative = path.relative(referencesRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Skill reference must remain inside references/: ${referencePath}`);
  }
  return resolved;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
