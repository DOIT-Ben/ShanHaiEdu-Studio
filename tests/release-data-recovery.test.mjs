import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";

import {
  createReleaseDataBackup,
  restoreReleaseDataBackup,
  verifyReleaseDataBackup,
} from "../scripts/release-data-recovery.mjs";

const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("release data backup captures WAL commits and restores database plus artifacts", async () => {
  const fixture = makeFixture();
  const backupRoot = path.join(fixture.root, "backup");
  const result = await createReleaseDataBackup({
    databasePath: fixture.databasePath,
    artifactRoot: fixture.artifactRoot,
    backupRoot,
    releaseId: "test-release",
    offlineConfirmed: true,
  });

  assert.deepEqual(result, { operation: "backup", ok: true, releaseId: "test-release", databaseIntegrity: "ok", artifactFileCount: 2 });
  assert.deepEqual(await verifyReleaseDataBackup({ backupRoot }), {
    operation: "verify",
    ok: true,
    releaseId: "test-release",
    databaseIntegrity: "ok",
    artifactFileCount: 2,
  });

  const restoredDatabase = path.join(fixture.root, "restored", "production.db");
  const restoredArtifacts = path.join(fixture.root, "restored-artifacts");
  const restored = await restoreReleaseDataBackup({
    backupRoot,
    databaseTarget: restoredDatabase,
    artifactTarget: restoredArtifacts,
    offlineConfirmed: true,
  });
  assert.deepEqual(restored, { operation: "restore", ok: true, releaseId: "test-release", databaseIntegrity: "ok", artifactFileCount: 2 });

  const db = new Database(restoredDatabase, { readonly: true });
  assert.deepEqual(db.prepare("SELECT value FROM RecoveryProbe ORDER BY value").all(), [{ value: "committed-in-wal" }]);
  db.close();
  assert.equal(readFileSync(path.join(restoredArtifacts, "ppt", "deck.pptx"), "utf8"), "ppt-bytes");
  assert.equal(readFileSync(path.join(restoredArtifacts, "video", "intro.mp4"), "utf8"), "video-bytes");
});

test("release data verification rejects tampering and restore refuses existing targets", async () => {
  const fixture = makeFixture();
  const backupRoot = path.join(fixture.root, "backup");
  await createReleaseDataBackup({
    databasePath: fixture.databasePath,
    artifactRoot: fixture.artifactRoot,
    backupRoot,
    releaseId: "test-release",
    offlineConfirmed: true,
  });

  writeFileSync(path.join(backupRoot, "artifacts", "ppt", "deck.pptx"), "tampered");
  await assert.rejects(() => verifyReleaseDataBackup({ backupRoot }), /verification failed/i);

  const existingDatabase = path.join(fixture.root, "existing.db");
  writeFileSync(existingDatabase, "do-not-overwrite");
  await assert.rejects(() => restoreReleaseDataBackup({
    backupRoot,
    databaseTarget: existingDatabase,
    artifactTarget: path.join(fixture.root, "restored-artifacts"),
    offlineConfirmed: true,
  }), /verification failed|refusing to overwrite/i);
  assert.equal(readFileSync(existingDatabase, "utf8"), "do-not-overwrite");
});

test("release data verification rejects files outside the signed manifest set", async () => {
  const fixture = makeFixture();
  const backupRoot = path.join(fixture.root, "backup-extra-file");
  await createReleaseDataBackup({
    databasePath: fixture.databasePath,
    artifactRoot: fixture.artifactRoot,
    backupRoot,
    releaseId: "test-release",
    offlineConfirmed: true,
  });
  writeFileSync(path.join(backupRoot, "unsigned-extra.txt"), "unsigned");
  await assert.rejects(() => verifyReleaseDataBackup({ backupRoot }), /verification failed/i);
});

test("release data operations require explicit offline confirmation", async () => {
  const fixture = makeFixture();
  await assert.rejects(() => createReleaseDataBackup({
    databasePath: fixture.databasePath,
    artifactRoot: fixture.artifactRoot,
    backupRoot: path.join(fixture.root, "backup"),
    releaseId: "test-release",
    offlineConfirmed: false,
  }), /offline confirmation/i);
});

test("release data backup rejects symbolic links in the artifact tree", async () => {
  const fixture = makeFixture();
  const external = path.join(fixture.root, "external-assets");
  mkdirSync(external);
  writeFileSync(path.join(external, "outside.txt"), "outside");
  symlinkSync(external, path.join(fixture.artifactRoot, "linked-assets"), "junction");

  await assert.rejects(() => createReleaseDataBackup({
    databasePath: fixture.databasePath,
    artifactRoot: fixture.artifactRoot,
    backupRoot: path.join(fixture.root, "backup"),
    releaseId: "test-release",
    offlineConfirmed: true,
  }), /unsafe entry/i);
});

test("package exposes release data backup, verify, and restore commands", () => {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  assert.equal(pkg.scripts?.["release:data:backup"], "node scripts/release-data-recovery.mjs backup");
  assert.equal(pkg.scripts?.["release:data:verify"], "node scripts/release-data-recovery.mjs verify");
  assert.equal(pkg.scripts?.["release:data:restore"], "node scripts/release-data-recovery.mjs restore");
});

test("release data CLI completes backup, verify, and restore without printing local paths", () => {
  const fixture = makeFixture();
  const script = path.join(process.cwd(), "scripts", "release-data-recovery.mjs");
  const backupRoot = path.join(fixture.root, "cli-backup");
  const restoredDatabase = path.join(fixture.root, "cli-restored", "production.db");
  const restoredArtifacts = path.join(fixture.root, "cli-restored-artifacts");

  const commands = [
    ["backup", "--database", fixture.databasePath, "--artifacts", fixture.artifactRoot, "--backup", backupRoot, "--release-id", "test-release", "--confirm-offline"],
    ["verify", "--backup", backupRoot],
    ["restore", "--backup", backupRoot, "--database-target", restoredDatabase, "--artifacts-target", restoredArtifacts, "--confirm-offline"],
  ];
  for (const args of commands) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(escapeRegExp(fixture.root), "i"));
  }
});

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "shanhai-recovery-"));
  roots.push(root);
  const databasePath = path.join(root, "production.db");
  const artifactRoot = path.join(root, "artifacts");
  mkdirSync(path.join(artifactRoot, "ppt"), { recursive: true });
  mkdirSync(path.join(artifactRoot, "video"), { recursive: true });
  writeFileSync(path.join(artifactRoot, "ppt", "deck.pptx"), "ppt-bytes");
  writeFileSync(path.join(artifactRoot, "video", "intro.mp4"), "video-bytes");

  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE RecoveryProbe (value TEXT NOT NULL)");
  db.prepare("INSERT INTO RecoveryProbe (value) VALUES (?)").run("committed-in-wal");
  db.close();
  return { root, databasePath, artifactRoot };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
