import type { JsonSchemaObject } from "./tool-types";

export type JsonSchemaValidationResult = { valid: boolean; issues: string[] };

export function validateJsonSchemaValue(value: unknown, schema: JsonSchemaObject): JsonSchemaValidationResult {
  const issues: string[] = [];
  validateValue(value, schema, "$", issues);
  return { valid: issues.length === 0, issues };
}

function validateValue(value: unknown, schemaValue: unknown, path: string, issues: string[]) {
  if (!isRecord(schemaValue)) return;
  const schema = schemaValue as Record<string, unknown>;
  if (!matchesType(value, schema.type)) {
    issues.push(`${path}:type`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) issues.push(`${path}:enum`);
  if ("const" in schema && !Object.is(schema.const, value)) issues.push(`${path}:const`);

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) issues.push(`${path}:minLength`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) issues.push(`${path}:pattern`);
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) issues.push(`${path}:minItems`);
    if (schema.uniqueItems === true && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) issues.push(`${path}:uniqueItems`);
    value.forEach((entry, index) => validateValue(entry, schema.items, `${path}[${index}]`, issues));
  }

  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.filter((entry): entry is string => typeof entry === "string") : [];
    for (const key of required) if (!(key in value)) issues.push(`${path}.${key}:required`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(key in properties)) issues.push(`${path}.${key}:additionalProperty`);
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value) validateValue(value[key], childSchema, `${path}.${key}`, issues);
    }
  }
}

function matchesType(value: unknown, type: unknown): boolean {
  if (type === undefined) return true;
  const allowed = Array.isArray(type) ? type : [type];
  return allowed.some((candidate) => {
    if (candidate === "null") return value === null;
    if (candidate === "array") return Array.isArray(value);
    if (candidate === "object") return isRecord(value);
    if (candidate === "integer") return Number.isInteger(value);
    if (candidate === "number") return typeof value === "number" && Number.isFinite(value);
    return typeof value === candidate;
  });
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
