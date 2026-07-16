export const M67_FROZEN_APP_MARKER_SCHEMA_VERSION: "m67-frozen-app.v3";

export type M67FrozenRunIdentity = Readonly<{
  mode: "start-new" | "resume";
  runId: string;
  manifestSha256: string;
}>;

export type M67FrozenAppContract = Readonly<{
  requiredDirectories: readonly string[];
  requiredFiles: readonly string[];
  copiedEntries: readonly string[];
  frozenEntries: readonly string[];
}>;

export type M67FrozenAppDependencies = Readonly<{
  fileSystem?: typeof import("node:fs");
  platform?: NodeJS.Platform;
  now?: () => Date;
}>;

export type M67FrozenAppMarker = Readonly<{
  schemaVersion: "m67-frozen-app.v3";
  runId: string;
  manifestSha256: string;
  frozenAt: string;
  copiedEntries: readonly string[];
  sourceEntriesDigest: string;
  copiedEntriesDigest: string;
  frozenEntries: readonly string[];
  frozenEntriesDigest: string;
}>;

export function resolveM67FrozenAppRoot(
  value: unknown,
  runRoot: string,
  dependencies?: M67FrozenAppDependencies,
): string | null;

export function assertM67CanonicalOwnedDescendant(
  ownerRoot: string,
  candidatePath: string,
  allowMissing: boolean,
  dependencies?: M67FrozenAppDependencies,
): string;

export function resolveM67FrozenRunIdentity(
  env: Readonly<Record<string, string | undefined>>,
  frozenRoot: string | null,
): M67FrozenRunIdentity | null;

export function assertM67FrozenRunStorageState(input: Readonly<{
  identity: M67FrozenRunIdentity | null;
  databasePath: string;
  artifactRoot: string;
  appRoot: string;
}>, dependencies?: M67FrozenAppDependencies): void;

export function createM67FrozenAppContract(requestedSpec: string): M67FrozenAppContract;

export function prepareM67FrozenApp(input: Readonly<{
  sourceRoot: string;
  runRoot: string;
  appRoot: string;
  markerPath: string;
  identity: M67FrozenRunIdentity;
  requestedSpec: string;
  nextConfigContents: string;
  assertBaselineCurrent: () => void;
}>, dependencies?: M67FrozenAppDependencies): M67FrozenAppContract;

export type M67FrozenAppVerificationInput = Readonly<{
  sourceRoot: string;
  runRoot: string;
  appRoot: string;
  markerPath: string;
  identity: M67FrozenRunIdentity;
  requestedSpec: string;
  contract?: M67FrozenAppContract;
}>;

export function assertM67FrozenAppIdentity(
  input: M67FrozenAppVerificationInput,
  dependencies?: M67FrozenAppDependencies,
): M67FrozenAppMarker;

export function verifyM67FrozenApp(
  input: M67FrozenAppVerificationInput,
  dependencies?: M67FrozenAppDependencies,
): M67FrozenAppMarker;

export function verifyM67FrozenAppBeforeCacheCleanup(
  input: M67FrozenAppVerificationInput,
  dependencies?: M67FrozenAppDependencies,
): M67FrozenAppMarker;

export function cleanM67OwnedFrozenAppCaches(
  appRoot: string,
  runRoot: string,
  dependencies?: M67FrozenAppDependencies,
): void;

export function resolveM67FrozenPlaywrightSpecPath(spec: string, appRoot: string | null): string;

export function digestM67FrozenAppEntries(
  baseRoot: string,
  frozenEntries: readonly string[],
  dependencies?: M67FrozenAppDependencies,
): string;
