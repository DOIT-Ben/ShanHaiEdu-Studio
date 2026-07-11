import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSqliteFileUrl } from "./lib/sqlite-url.mjs";

if (process.env.SHANHAI_DB_INIT_SKIP_DOTENV !== "1") {
  await import("dotenv/config");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArguments(process.argv.slice(2));
const databasePath = resolveSqliteFileUrl(process.env.DATABASE_URL ?? "file:./dev.db", { baseDir: root });
const database = new Database(databasePath);

try {
  database.pragma("foreign_keys = ON");
  const projects = readLifecycleProjects(database);
  if (options.exportPath) {
    fs.writeFileSync(options.exportPath, JSON.stringify(projects, null, 2) + "\n", "utf8");
  }

  if (!options.apply) {
    console.log(JSON.stringify({ mode: "dry-run", affectedCount: projects.length }));
  } else {
    assertApplyConfirmation(options);
    const affectedCount = restoreProjects(database);
    console.log(JSON.stringify({ mode: "apply", affectedCount }));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "M71A lifecycle rollback failed.");
  process.exitCode = 1;
} finally {
  database.close();
}

function parseArguments(args) {
  let apply = false;
  let confirmation = "";
  let exportPath = "";
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (argument === "--confirm") {
      confirmation = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (argument === "--export") {
      exportPath = args[index + 1] ?? "";
      index += 1;
      continue;
    }
    throw new Error(`Unsupported argument: ${argument}`);
  }
  if (!exportPath && args.includes("--export")) throw new Error("--export requires a file path.");
  return { apply, confirmation, exportPath };
}

function readLifecycleProjects(database) {
  return database.prepare(`
    SELECT "id", "archivedAt", "deletedAt", "lifecycleVersion"
    FROM "Project"
    WHERE "archivedAt" IS NOT NULL OR "deletedAt" IS NOT NULL
    ORDER BY "id" ASC
  `).all().map((project) => ({
    id: project.id,
    lifecycleState: project.deletedAt ? "trash" : "archived",
    lifecycleVersion: project.lifecycleVersion,
  }));
}

function assertApplyConfirmation(options) {
  if (options.confirmation !== "RESTORE_ALL_PROJECTS") {
    throw new Error("Apply requires --confirm RESTORE_ALL_PROJECTS.");
  }
  if (process.env.SHANHAI_M71A_BACKUP_CONFIRMED !== "YES") {
    throw new Error("Apply requires SHANHAI_M71A_BACKUP_CONFIRMED=YES.");
  }
}

function restoreProjects(database) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = database.prepare(`
      UPDATE "Project"
      SET "archivedAt" = NULL,
          "deletedAt" = NULL,
          "lifecycleVersion" = "lifecycleVersion" + 1
      WHERE "archivedAt" IS NOT NULL OR "deletedAt" IS NOT NULL
    `).run();
    database.exec("COMMIT");
    return result.changes;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
