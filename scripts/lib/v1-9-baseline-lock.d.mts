export type V1_9LegacyBaselineLock = Readonly<{
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

export type V1_9BaselineLock = Readonly<Omit<V1_9LegacyBaselineLock, "schemaVersion"> & {
  schemaVersion: "v1-9-baseline-lock.v2";
  verificationManifestSha256: string;
  workingTreeDigest: string;
  policySha256: string;
  stageSha256: string;
  providerContinuityManifestSha256: string;
  providerContinuityReceiptSha256: string;
  providerContinuityEvidenceRootDigest: string;
  providerContinuitySubjectDigest: string;
}>;

export type V1_9BaselineStaticInputs = Readonly<Omit<V1_9LegacyBaselineLock, "schemaVersion">>;

export type V1_9BaselineLockField =
  | "schemaVersion"
  | "branch"
  | "gitHead"
  | "generationIntensity"
  | "runtimeSourceDigest"
  | "requirementsBaselineDigest"
  | "registryDigest"
  | "projectionRegistryDigest"
  | "providerLedgerManifestDigest"
  | "projectionId"
  | "verificationManifestSha256"
  | "workingTreeDigest"
  | "policySha256"
  | "stageSha256"
  | "providerContinuityManifestSha256"
  | "providerContinuityReceiptSha256"
  | "providerContinuityEvidenceRootDigest"
  | "providerContinuitySubjectDigest";

export type V1_9BaselineLockInput = {
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
  now?: Date | string | number;
};

export type V1_9BaselineLockComparison = Readonly<{
  isCurrent: boolean;
  driftedFields: readonly V1_9BaselineLockField[];
}>;

export const V1_9_BASELINE_LOCK_VERSION: "v1-9-baseline-lock.v2";
export const V1_9_LEGACY_BASELINE_LOCK_VERSION: "v1-9-baseline-lock.v1";

export class V1_9BaselineLockDriftError extends Error {
  readonly reasonCode: "v1_9_baseline_lock_drift";
  readonly driftedFields: readonly V1_9BaselineLockField[];
  constructor(driftedFields: readonly V1_9BaselineLockField[]);
}

export function createV1_9BaselineLock(input?: V1_9BaselineLockInput): V1_9BaselineLock;
export function collectV1_9BaselineStaticInputs(input?: V1_9BaselineLockInput): V1_9BaselineStaticInputs;

export function compareV1_9BaselineLock(
  expected: V1_9BaselineLock | V1_9LegacyBaselineLock,
  current: V1_9BaselineLock | V1_9LegacyBaselineLock,
): V1_9BaselineLockComparison;

export function assertCurrentV1_9BaselineLock(
  expected: V1_9BaselineLock | V1_9LegacyBaselineLock,
  input?: V1_9BaselineLockInput,
): V1_9BaselineLock;
