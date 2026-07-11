import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";

const root = process.cwd();

test("SQLite initialization upgrades legacy projects with lifecycle fields and index", () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "shanhai-project-lifecycle-"));
  const databasePath = path.join(temporaryRoot, "legacy.sqlite");
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE "Project" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'active',
      "currentNodeKey" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
  `);
  database.prepare('INSERT INTO "Project" ("id", "title", "currentNodeKey", "updatedAt") VALUES (?, ?, ?, ?)').run(
    "legacy-project",
    "旧项目",
    "requirement_spec",
    "2026-07-11T00:00:00.000Z",
  );
  database.close();

  let upgraded;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
        cwd: root,
        env: {
          ...process.env,
          DATABASE_URL: `file:${databasePath}`,
          SHANHAI_DB_INIT_SKIP_DOTENV: "1",
        },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
    }

    upgraded = new Database(databasePath, { readonly: true });
    const columns = upgraded.prepare('PRAGMA table_info("Project")').all().map((column) => column.name);
    const indexes = upgraded.prepare('PRAGMA index_list("Project")').all().map((index) => index.name);
    const project = upgraded.prepare('SELECT "archivedAt", "deletedAt", "lifecycleVersion" FROM "Project" WHERE "id" = ?').get("legacy-project");
    assert.deepEqual(columns.filter((column) => ["archivedAt", "deletedAt", "lifecycleVersion"].includes(column)), ["archivedAt", "deletedAt", "lifecycleVersion"]);
    assert.equal(project.archivedAt, null);
    assert.equal(project.deletedAt, null);
    assert.equal(project.lifecycleVersion, 0);
    assert.equal(indexes.includes("Project_archivedAt_deletedAt_updatedAt_idx"), true);
  } finally {
    upgraded?.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
