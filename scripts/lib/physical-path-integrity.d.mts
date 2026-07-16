export type PhysicalPathIntegrityOptions = Readonly<{
  allowMissing?: boolean;
  fileSystem?: typeof import("node:fs");
  platform?: NodeJS.Platform;
}>;

export function assertCanonicalExistingPathChain(
  targetPath: string,
  options?: PhysicalPathIntegrityOptions,
): string;
