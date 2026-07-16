import { createHash } from "node:crypto";

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import type { LoadedSkillContractSchema } from "./skill-runtime-types";

const DRAFT_2020_12_SCHEMA = "https://json-schema.org/draft/2020-12/schema";

export function parseSkillContractSchema(input: {
  artifactType: string;
  contractVersion: string;
  content: string;
}): LoadedSkillContractSchema {
  const schema = parseSchemaDocument(input.content);
  if (schema.$schema !== DRAFT_2020_12_SCHEMA) {
    throw new Error("Skill contract Schema must declare JSON Schema Draft 2020-12.");
  }
  const properties = plainObject(schema.properties, "Skill contract Schema properties");
  const schemaVersion = plainObject(properties.schemaVersion, "Skill contract Schema schemaVersion");
  if (schemaVersion.const !== input.contractVersion) {
    throw new Error("Skill contract Schema schemaVersion.const must match registry contract_version.");
  }
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateSchema: true });
    addFormats(ajv);
    if (!ajv.validateSchema(schema)) throw new Error("invalid schema");
    ajv.compile(schema);
  } catch {
    throw new Error("Skill contract Schema is not a valid JSON Schema Draft 2020-12 document.");
  }
  return {
    artifactType: input.artifactType,
    contractVersion: input.contractVersion,
    schema: structuredClone(schema),
    schemaSha256: `sha256:${createHash("sha256").update(input.content, "utf8").digest("hex")}`,
  };
}

function parseSchemaDocument(content: string): Record<string, unknown> {
  try {
    return plainObject(JSON.parse(content), "Skill contract Schema");
  } catch {
    throw new Error("Skill contract Schema is not valid JSON.");
  }
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}
