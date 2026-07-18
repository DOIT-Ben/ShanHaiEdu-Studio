import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "../../src/generated/prisma/client";
import { readOrchestrationAuthoritySummary } from "../../src/server/conversation/orchestration-authority-summary";

export async function readV1_9OrchestrationAuthoritySummaryFromSqlite(input: {
  databasePath: string;
  projectId: string;
  actorUserId: string;
}) {
  const databasePath = await requireReadonlyDatabasePath(input.databasePath);
  const projectId = requiredText(input.projectId, "projectId");
  const actorUserId = requiredText(input.actorUserId, "actorUserId");
  const client = new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: `file:${databasePath.replaceAll("\\", "/")}`,
      readonly: true,
      fileMustExist: true,
      timeout: 15_000,
    }),
  });
  try {
    return await readOrchestrationAuthoritySummary({ projectId, actor: { userId: actorUserId } }, client);
  } finally {
    await client.$disconnect();
  }
}

async function requireReadonlyDatabasePath(value: unknown) {
  if (typeof value !== "string" || !value.trim() || !path.isAbsolute(value)) {
    throw new Error("v1_9_orchestration_authority_database_path_invalid");
  }
  const databasePath = path.normalize(value);
  if (databasePath !== value) throw new Error("v1_9_orchestration_authority_database_path_invalid");
  const metadata = await lstat(databasePath).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    throw new Error("v1_9_orchestration_authority_database_invalid");
  }
  return databasePath;
}

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`v1_9_orchestration_authority_${field}_invalid`);
  }
  return value.trim();
}

async function runCli() {
  const [databasePath, projectId, actorUserId, ...unexpected] = process.argv.slice(2);
  if (unexpected.length > 0) throw new Error("v1_9_orchestration_authority_cli_arguments_invalid");
  const summary = await readV1_9OrchestrationAuthoritySummaryFromSqlite({
    databasePath: databasePath ?? "",
    projectId: projectId ?? "",
    actorUserId: actorUserId ?? "",
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void runCli();
}
