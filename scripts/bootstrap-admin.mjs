import Database from "better-sqlite3";
import { randomBytes, randomUUID, scrypt as nodeScrypt } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveSqliteFileUrl } from "./lib/sqlite-url.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function runBootstrapAdmin(options = {}) {
  const env = options.env ?? process.env;
  const ownsDb = !options.db;
  const db = options.db ?? openSqliteDatabase(env.DATABASE_URL);
  try {
    const existingAdmin = db
      .prepare('SELECT "id" FROM "LocalUser" WHERE "authMode" = ? AND "role" = ? ORDER BY "createdAt", "id" LIMIT 1')
      .get("password", "admin");
    if (existingAdmin) {
      return { userId: existingAdmin.id, status: "already_initialized" };
    }
    if (env.SHANHAI_BOOTSTRAP_ADMIN_CONFIRM !== "CREATE_ADMIN") {
      throw new Error("Set SHANHAI_BOOTSTRAP_ADMIN_CONFIRM=CREATE_ADMIN to create the first administrator.");
    }

    return await provisionSqlitePasswordUser({
      db,
      email: env.SHANHAI_BOOTSTRAP_ADMIN_EMAIL,
      displayName: env.SHANHAI_BOOTSTRAP_ADMIN_DISPLAY_NAME,
      initialPassword: env.SHANHAI_BOOTSTRAP_ADMIN_INITIAL_PASSWORD,
      role: "admin",
      source: "bootstrap_cli",
      hashPassword: options.hashPassword,
      generateUserId: options.generateUserId,
      generateAuditId: options.generateAuditId,
      now: options.now,
    });
  } finally {
    if (ownsDb) db.close();
  }
}

export async function provisionSqlitePasswordUser(options) {
  const normalized = normalizeProvisioningInput(options);
    const existing = options.db.prepare('SELECT "id", "authMode", "role", "passwordHash" FROM "LocalUser" WHERE "email" = ?').get(normalized.email);
  if (existing) {
    if (existing.authMode === "password" && existing.role === normalized.role && existing.passwordHash?.trim()) {
      return { userId: existing.id, status: "already_exists" };
    }
    if (existing.authMode === "password" && existing.role === normalized.role) {
      const passwordHash = await (options.hashPassword ?? hashInitialPassword)(normalized.initialPassword);
      const now = (options.now?.() ?? new Date()).toISOString();
      options.db.transaction(() => {
        options.db.prepare('UPDATE "LocalUser" SET "passwordHash" = ?, "updatedAt" = ? WHERE "id" = ?').run(passwordHash, now, existing.id);
      })();
      return { userId: existing.id, status: "activated" };
    }
    if (existing.authMode === "pending" && existing.role === "teacher" && normalized.role === "teacher") {
      return activatePendingSqliteUser({ ...options, normalized, existing });
    }
    throw new Error("该邮箱已被其他账号使用。");
  }

  const passwordHash = await (options.hashPassword ?? hashInitialPassword)(normalized.initialPassword);
  const userId = options.generateUserId?.() ?? randomUUID();
  const auditId = options.generateAuditId?.() ?? randomUUID();
  const now = (options.now?.() ?? new Date()).toISOString();
  const actorUserId = options.actorUserId ?? userId;
  const action = normalized.role === "admin" ? "auth.admin.bootstrapped" : "auth.user.invited";
  const metadataJson = JSON.stringify({ authMode: "password", role: normalized.role, source: options.source });

  const writeUserAndAudit = options.db.transaction(() => {
    options.db
      .prepare(
        'INSERT INTO "LocalUser" ("id", "displayName", "role", "authMode", "email", "passwordHash", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(userId, normalized.displayName, normalized.role, "password", normalized.email, passwordHash, now);
    options.db
      .prepare(
        'INSERT INTO "AuditLog" ("id", "actorUserId", "action", "targetType", "targetId", "projectId", "metadataJson") VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(auditId, actorUserId, action, "user", userId, null, metadataJson);
  });
  writeUserAndAudit();
  return { userId, status: "created" };
}

async function activatePendingSqliteUser(options) {
  const passwordHash = await (options.hashPassword ?? hashInitialPassword)(options.normalized.initialPassword);
  const auditId = options.generateAuditId?.() ?? randomUUID();
  const now = (options.now?.() ?? new Date()).toISOString();
  const metadataJson = JSON.stringify({ authMode: "password", role: "teacher", source: options.source, status: "activated" });
  const activateUserAndAudit = options.db.transaction(() => {
    options.db
      .prepare('UPDATE "LocalUser" SET "displayName" = ?, "authMode" = ?, "passwordHash" = ?, "updatedAt" = ? WHERE "id" = ?')
      .run(options.normalized.displayName, "password", passwordHash, now, options.existing.id);
    options.db
      .prepare(
        'INSERT INTO "AuditLog" ("id", "actorUserId", "action", "targetType", "targetId", "projectId", "metadataJson") VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(auditId, options.actorUserId, "auth.user.activated", "user", options.existing.id, null, metadataJson);
  });
  activateUserAndAudit();
  return { userId: options.existing.id, status: "activated" };
}

export function openSqliteDatabase(databaseUrl) {
  const databasePath = resolveSqliteFileUrl(databaseUrl, { baseDir: root });
  return new Database(databasePath);
}

export async function hashInitialPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt);
  return ["scrypt", "v=1", "N=16384", "r=8", "p=1", "keylen=64", salt.toString("base64url"), hash.toString("base64url")].join("$");
}

function normalizeProvisioningInput(options) {
  const email = typeof options.email === "string" ? options.email.trim().toLowerCase() : "";
  const displayName = typeof options.displayName === "string" ? options.displayName.trim().slice(0, 80) : "";
  const initialPassword = typeof options.initialPassword === "string" ? options.initialPassword : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !/^[a-z0-9_]{3,64}$/.test(email)) throw new Error("请配置有效的账号。");
  if (!displayName) throw new Error("请配置用户名称。");
  if (initialPassword.length < 8 || initialPassword.length > 256) throw new Error("初始密码长度必须为 8 到 256 个字符。");
  if (options.role !== "admin" && options.role !== "teacher") throw new Error("用户角色无效。");
  return { email, displayName, initialPassword, role: options.role };
}

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  await import("dotenv/config");
  try {
    const result = await runBootstrapAdmin();
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ status: "error", error: error instanceof Error ? error.message : "管理员初始化失败。" }));
    process.exitCode = 1;
  }
}
