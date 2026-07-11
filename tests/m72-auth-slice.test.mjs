import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { provisionSqlitePasswordUser } from "../scripts/bootstrap-admin.mjs";
import { provisionAndBindUser, runProvisionAndBindUser } from "../scripts/provision-and-bind-user.mjs";

function database() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE LocalUser (id TEXT PRIMARY KEY, displayName TEXT, role TEXT, authMode TEXT, email TEXT UNIQUE, passwordHash TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT);
    CREATE TABLE Project (id TEXT PRIMARY KEY, title TEXT, ownerUserId TEXT, updatedAt TEXT);
    CREATE TABLE ProjectMembership (id TEXT PRIMARY KEY, projectId TEXT, userId TEXT, role TEXT, createdAt TEXT, updatedAt TEXT, UNIQUE(projectId, userId));
    CREATE TABLE AuditLog (id TEXT PRIMARY KEY, actorUserId TEXT, action TEXT, targetType TEXT, targetId TEXT, projectId TEXT, metadataJson TEXT);
  `);
  return db;
}

test("existing password user without a hash is activated instead of reported as already_exists", async () => {
  const db = database();
  db.prepare("INSERT INTO LocalUser VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run("u1", "教师", "teacher", "password", "teacher@example.test", null);
  const result = await provisionSqlitePasswordUser({ db, email: "teacher@example.test", displayName: "教师", initialPassword: "not-logged-test-password", role: "teacher", source: "test", hashPassword: async () => "scrypt$redacted" });
  assert.equal(result.status, "activated");
  assert.equal(db.prepare("SELECT passwordHash FROM LocalUser WHERE id = ?").get("u1").passwordHash, "scrypt$redacted");
  db.close();
});

test("project binding is dry-run by default and refuses an unbounded selector", () => {
  const db = database();
  assert.throws(() => provisionAndBindUser({ db, userId: "u1" }), /禁止盲绑全库/);
  db.prepare("INSERT INTO Project VALUES (?, ?, ?, CURRENT_TIMESTAMP)").run("p1", "课例", "legacy");
  const result = provisionAndBindUser({ db, userId: "u1", projectId: "p1" });
  assert.deepEqual(result, { dryRun: true, matchedProjects: 1, updatedProjects: 0, createdMemberships: 0, deletedOwnerMemberships: 0 });
  assert.equal(db.prepare("SELECT ownerUserId FROM Project WHERE id = ?").get("p1").ownerUserId, "legacy");
  db.close();
});

test("binding leaves exactly one target owner membership and preserves non-owner roles", () => {
  const db = database();
  db.prepare("INSERT INTO Project VALUES (?, ?, ?, CURRENT_TIMESTAMP)").run("p1", "课例", "legacy");
  db.prepare("INSERT INTO ProjectMembership VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run("m1", "p1", "legacy", "owner");
  db.prepare("INSERT INTO ProjectMembership VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run("m2", "p1", "viewer", "viewer");
  provisionAndBindUser({ db, userId: "target", projectId: "p1", apply: true });
  assert.deepEqual(db.prepare("SELECT userId, role FROM ProjectMembership WHERE projectId = ? ORDER BY role").all("p1"), [{ userId: "target", role: "owner" }, { userId: "viewer", role: "viewer" }]);
  db.close();
});

test("provision-and-bind creates a safe account without returning its credential", async () => {
  const db = database();
  db.prepare("INSERT INTO Project VALUES (?, ?, ?, CURRENT_TIMESTAMP)").run("p1", "课例", "legacy");
  const result = await runProvisionAndBindUser({ db, account: "Teacher_02", displayName: "教师", password: "test-only-password-value", projectId: "p1", apply: true, hashPassword: async () => "scrypt$redacted" });
  assert.equal(db.prepare("SELECT email FROM LocalUser").get().email, "teacher_02");
  assert.doesNotMatch(JSON.stringify(result), /test-only-password-value|scrypt\$redacted/);
  assert.equal(result.userStatus, "created");
  db.close();
});

test("explicit apply binds owner and membership transactionally with redacted audit metadata", () => {
  const db = database();
  db.prepare("INSERT INTO Project VALUES (?, ?, ?, CURRENT_TIMESTAMP)").run("p1", "课例", "legacy");
  const result = provisionAndBindUser({ db, userId: "u1", ownerUserId: "legacy", apply: true });
  assert.equal(result.updatedProjects, 1);
  assert.equal(result.createdMemberships, 1);
  assert.equal(db.prepare("SELECT role FROM ProjectMembership").get().role, "owner");
  const audit = db.prepare("SELECT metadataJson FROM AuditLog").get().metadataJson;
  assert.doesNotMatch(audit, /password|email/i);
  db.close();
});
