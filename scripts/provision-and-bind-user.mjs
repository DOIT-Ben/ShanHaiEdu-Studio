import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { openSqliteDatabase, provisionSqlitePasswordUser } from "./bootstrap-admin.mjs";

// Deliberately requires an explicit project or owner selector. It never reads passwords.
export function provisionAndBindUser(options) {
  const { db, userId, projectId, ownerUserId, apply = false, actorUserId = null } = options;
  if (!db || !userId) throw new Error("db and userId are required.");
  if (!projectId && !ownerUserId) throw new Error("请显式提供 projectId 或 ownerUserId，禁止盲绑全库。");
  const where = projectId ? 'WHERE "id" = ?' : 'WHERE "ownerUserId" = ?';
  const selector = projectId ?? ownerUserId;
  const projects = db.prepare(`SELECT "id" FROM "Project" ${where} ORDER BY "id"`).all(selector);
  const result = { dryRun: !apply, matchedProjects: projects.length, updatedProjects: 0, createdMemberships: 0, deletedOwnerMemberships: 0 };
  if (!apply || projects.length === 0) return result;
  const now = new Date().toISOString();
  db.transaction(() => {
    const update = db.prepare('UPDATE "Project" SET "ownerUserId" = ?, "updatedAt" = ? WHERE "id" = ?');
    const membership = db.prepare('INSERT OR IGNORE INTO "ProjectMembership" ("id", "projectId", "userId", "role", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)');
    for (const project of projects) {
      update.run(userId, now, project.id);
      result.updatedProjects += 1;
      result.createdMemberships += membership.run(randomUUID(), project.id, userId, "owner", now, now).changes;
      db.prepare('UPDATE "ProjectMembership" SET "role" = ?, "updatedAt" = ? WHERE "projectId" = ? AND "userId" = ?').run("owner", now, project.id, userId);
      result.deletedOwnerMemberships += db.prepare('DELETE FROM "ProjectMembership" WHERE "projectId" = ? AND "role" = ? AND "userId" <> ?').run(project.id, "owner", userId).changes;
      db.prepare('INSERT INTO "AuditLog" ("id", "actorUserId", "action", "targetType", "targetId", "projectId", "metadataJson") VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), actorUserId, "auth.project.bound", "user", userId, project.id, JSON.stringify({ source: "provision_and_bind_cli", role: "owner" }));
    }
  })();
  const consistent = projects.every((project) => {
    const owner = db.prepare('SELECT "ownerUserId" FROM "Project" WHERE "id" = ?').get(project.id);
    const memberships = db.prepare('SELECT "userId" FROM "ProjectMembership" WHERE "projectId" = ? AND "role" = ?').all(project.id, "owner");
    return owner?.ownerUserId === userId && memberships.length === 1 && memberships[0].userId === userId;
  });
  if (!consistent) throw new Error("绑定计数校验失败，ownerUserId 与 owner membership 不一致。");
  return result;
}

export async function runProvisionAndBindUser(options) {
  const account = typeof options.account === "string" ? options.account.trim().toLowerCase() : null;
  const existing = account ? options.db.prepare('SELECT "id" FROM "LocalUser" WHERE "email" = ?').get(account) : null;
  if (!options.apply) {
    return provisionAndBindUser({ ...options, userId: existing?.id ?? options.userId ?? "dry-run-new-user", apply: false });
  }
  const provisioned = await provisionSqlitePasswordUser({
    db: options.db, email: options.account, displayName: options.displayName, initialPassword: options.password,
    role: "teacher", source: "provision_and_bind_cli", actorUserId: options.actorUserId,
    hashPassword: options.hashPassword,
  });
  const binding = provisionAndBindUser({ ...options, userId: provisioned.userId, apply: true });
  return { ...binding, userId: provisioned.userId, userStatus: provisioned.status };
}

async function readPasswordFromStdin() {
  if (process.stdin.isTTY) throw new Error("请通过标准输入或 SHANHAI_BIND_USER_PASSWORD 提供密码。");
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value.replace(/[\r\n]+$/, "");
}

function isMainModule() { return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href; }
if (isMainModule()) {
  await import("dotenv/config");
  const args = new Set(process.argv.slice(2));
  const value = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
  try {
    const db = openSqliteDatabase(process.env.DATABASE_URL);
    const apply = args.has("--apply");
    const password = apply ? (process.env.SHANHAI_BIND_USER_PASSWORD ?? await readPasswordFromStdin()) : undefined;
    const result = await runProvisionAndBindUser({ db, account: process.env.SHANHAI_BIND_USER_ACCOUNT, displayName: process.env.SHANHAI_BIND_USER_DISPLAY_NAME, password, userId: process.env.SHANHAI_BIND_USER_ID, projectId: value("--project-id"), ownerUserId: value("--owner-user-id"), apply, actorUserId: process.env.SHANHAI_BIND_ACTOR_USER_ID ?? null });
    console.log(JSON.stringify(result));
    db.close();
  } catch (error) { console.error(JSON.stringify({ status: "error", error: error instanceof Error ? error.message : "绑定失败。" })); process.exitCode = 1; }
}
