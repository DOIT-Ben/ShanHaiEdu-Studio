import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";

const root = process.cwd();

test("M71A lifecycle rollback is dry-run by default and restores only after explicit confirmation", () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "shanhai-lifecycle-rollback-"));
  const databasePath = path.join(temporaryRoot, "rollback.sqlite");
  const exportPath = path.join(temporaryRoot, "lifecycle-export.json");
  const env = { ...process.env, DATABASE_URL: `file:${databasePath}`, SHANHAI_DB_INIT_SKIP_DOTENV: "1" };

  try {
    const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], { cwd: root, env, encoding: "utf8" });
    assert.equal(initialized.status, 0, initialized.stderr);
    const database = new Database(databasePath);
    database.prepare('INSERT INTO "Project" ("id", "title", "currentNodeKey", "archivedAt", "deletedAt", "lifecycleVersion", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      "rollback-project",
      "不应导出的项目名称",
      "requirement_spec",
      "2026-07-11T00:00:00.000Z",
      null,
      4,
      "2026-07-11T00:00:00.000Z",
    );
    database.close();

    const dryRun = runRollback([], env);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.deepEqual(JSON.parse(dryRun.stdout), { mode: "dry-run", affectedCount: 1 });
    assert.equal(readProject(databasePath).archivedAt, "2026-07-11T00:00:00.000Z");

    const exported = runRollback(["--export", exportPath], env);
    assert.equal(exported.status, 0, exported.stderr);
    assert.deepEqual(JSON.parse(readFileSync(exportPath, "utf8")), [{ id: "rollback-project", lifecycleState: "archived", lifecycleVersion: 4 }]);

    const missingConfirmation = runRollback(["--apply", "--confirm", "RESTORE_ALL_PROJECTS"], env);
    assert.notEqual(missingConfirmation.status, 0);
    assert.equal(readProject(databasePath).archivedAt, "2026-07-11T00:00:00.000Z");

    const applied = runRollback(["--apply", "--confirm", "RESTORE_ALL_PROJECTS"], { ...env, SHANHAI_M71A_BACKUP_CONFIRMED: "YES" });
    assert.equal(applied.status, 0, applied.stderr);
    assert.deepEqual(JSON.parse(applied.stdout), { mode: "apply", affectedCount: 1 });
    assert.deepEqual(readProject(databasePath), { archivedAt: null, deletedAt: null, lifecycleVersion: 5 });

    const repeated = runRollback(["--apply", "--confirm", "RESTORE_ALL_PROJECTS"], { ...env, SHANHAI_M71A_BACKUP_CONFIRMED: "YES" });
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.deepEqual(JSON.parse(repeated.stdout), { mode: "apply", affectedCount: 0 });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

function runRollback(args, env) {
  return spawnSync(process.execPath, ["scripts/m71a-project-lifecycle-rollback.mjs", ...args], {
    cwd: root,
    env,
    encoding: "utf8",
  });
}

function readProject(databasePath) {
  const database = new Database(databasePath, { readonly: true });
  try {
    return database.prepare('SELECT "archivedAt", "deletedAt", "lifecycleVersion" FROM "Project" WHERE "id" = ?').get("rollback-project");
  } finally {
    database.close();
  }
}
