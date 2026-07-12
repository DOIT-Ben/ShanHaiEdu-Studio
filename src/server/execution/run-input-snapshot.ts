import { createHash } from "node:crypto";

export function canonicalizeRunInput(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function hashRunInput(value: unknown): string {
  return createHash("sha256").update(canonicalizeRunInput(value), "utf8").digest("hex");
}

function normalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Run input cannot contain non-finite numbers.");
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, normalize(record[key])]),
    );
  }
  throw new Error(`Unsupported run input value: ${typeof value}`);
}
