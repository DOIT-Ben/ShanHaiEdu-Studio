export type V1_9BaselineLock = Readonly<{
  schemaVersion: "v1-9-baseline-lock.v1";
  branch: "main";
  gitHead: string;
  generationIntensity: "standard";
  runtimeSourceDigest: string;
  requirementsBaselineDigest: string;
  registryDigest: string;
  projectionRegistryDigest: string;
  providerLedgerManifestDigest: string;
  projectionId: string;
}>;

export type V1_9BaselineLockField =
  | "branch"
  | "gitHead"
  | "generationIntensity"
  | "runtimeSourceDigest"
  | "requirementsBaselineDigest"
  | "registryDigest"
  | "projectionRegistryDigest"
  | "providerLedgerManifestDigest"
  | "projectionId";

export type V1_9BaselineLockInput = {
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
};

export type V1_9BaselineLockComparison = Readonly<{
  isCurrent: boolean;
  driftedFields: readonly V1_9BaselineLockField[];
}>;

export const V1_9_BASELINE_LOCK_VERSION: "v1-9-baseline-lock.v1";

export class V1_9BaselineLockDriftError extends Error {
  readonly reasonCode: "v1_9_baseline_lock_drift";
  readonly driftedFields: readonly V1_9BaselineLockField[];
  constructor(driftedFields: readonly V1_9BaselineLockField[]);
}

export function createV1_9BaselineLock(input?: V1_9BaselineLockInput): V1_9BaselineLock;

export function compareV1_9BaselineLock(
  expected: V1_9BaselineLock,
  current: V1_9BaselineLock,
): V1_9BaselineLockComparison;

export function assertCurrentV1_9BaselineLock(
  expected: V1_9BaselineLock,
  input?: V1_9BaselineLockInput,
): V1_9BaselineLock;
