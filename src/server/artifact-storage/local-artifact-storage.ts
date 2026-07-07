import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export type LocalArtifactCategory = "coze-ppt-artifacts" | "image-artifacts" | "video-artifacts";

type LocalArtifactEnv = {
  [key: string]: string | undefined;
  ARTIFACT_STORAGE_ROOT?: string;
};

export type WriteLocalArtifactInput = {
  category: LocalArtifactCategory;
  fileName: string;
  buffer: Buffer;
  env?: LocalArtifactEnv;
};

const logicalStoragePrefix = "artifact-storage";

export function writeLocalArtifact(input: WriteLocalArtifactInput) {
  const env = input.env ?? process.env;
  const fileName = safeFileName(input.fileName);
  const configuredRoot = configuredStorageRoot(env);
  const storageRoot = configuredRoot ?? defaultStorageRoot();
  const outputPath = path.join(storageRoot, input.category, fileName);

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, input.buffer);

  return {
    absolutePath: outputPath,
    localOutput: configuredRoot
      ? `${logicalStoragePrefix}/${input.category}/${fileName}`
      : path.relative(/*turbopackIgnore: true*/ process.cwd(), outputPath).replaceAll("\\", "/"),
  };
}

export function resolveLocalArtifactOutput(localOutput: string, env: LocalArtifactEnv = process.env) {
  const normalized = normalizeLocalOutput(localOutput);
  if (!normalized) return null;

  if (normalized.startsWith(".tmp/")) {
    const relativeUnderTmp = normalized.slice(".tmp/".length);
    if (!isSafeRelativePath(relativeUnderTmp)) return null;
    return path.join(defaultStorageRoot(), ...relativeUnderTmp.split("/"));
  }

  if (normalized.startsWith(`${logicalStoragePrefix}/`)) {
    const relativeUnderStorage = normalized.slice(logicalStoragePrefix.length + 1);
    if (!isSafeRelativePath(relativeUnderStorage)) return null;
    return path.join(configuredStorageRoot(env) ?? defaultStorageRoot(), ...relativeUnderStorage.split("/"));
  }

  return null;
}

function configuredStorageRoot(env: LocalArtifactEnv) {
  const configured = env.ARTIFACT_STORAGE_ROOT?.trim();
  if (!configured) return null;
  return path.resolve(configured);
}

function defaultStorageRoot() {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), ".tmp");
}

function normalizeLocalOutput(localOutput: string) {
  if (typeof localOutput !== "string") return null;
  const trimmed = localOutput.trim().replaceAll("\\", "/");
  if (!trimmed || path.isAbsolute(trimmed) || /^[A-Za-z]:\//.test(trimmed)) return null;
  return trimmed.replace(/^\.\//, "");
}

function isSafeRelativePath(value: string) {
  if (!value || path.isAbsolute(value) || /^[A-Za-z]:\//.test(value)) return false;
  return value.split("/").every((segment) => Boolean(segment) && segment !== "." && segment !== "..");
}

function safeFileName(value: string) {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-").trim();
  return cleaned || `artifact-${Date.now()}`;
}
