export function createDesktopServerEnvironment(input: {
  baseEnv?: Record<string, string | undefined>;
  port: number | string;
  databaseUrl: string;
  artifactStorageRoot: string;
}): Record<string, string>;

export function createPlaywrightWebServerEnvironment(
  baseEnv?: Record<string, string | undefined>,
): Record<string, string>;

export function createDeployDemoCommandEnvironment(input: {
  baseEnv?: Record<string, string | undefined>;
  databasePath: string;
  artifactRoot: string;
  bootstrapPassword: string;
}): Record<string, string>;
