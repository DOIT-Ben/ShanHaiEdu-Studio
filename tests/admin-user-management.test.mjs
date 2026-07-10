import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);

test("admin user management lists sanitized users and disables accounts with session revocation", async () => {
  const db = createFakeAdminUsersDb();
  const service = loadAdminUserManagementModule(db);
  const now = new Date("2026-07-11T00:00:00.000Z");

  const users = await service.listManagedUsers({ query: "teacher" }, { db, now: () => now });
  assert.deepEqual(users.items, [
    {
      id: "teacher_1",
      email: "teacher@example.test",
      displayName: "王老师",
      role: "teacher",
      authMode: "password",
      status: "active",
      disabledAt: null,
      lastLoginAt: null,
      createdAt: db.localUsers[1].createdAt,
      updatedAt: db.localUsers[1].updatedAt,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(users), /passwordHash|sessionToken|plain-password/);

  const result = await service.updateManagedUserStatus(
    { userId: "teacher_1", disabled: true, reason: "内测暂停", actorUserId: "admin_1" },
    { db, now: () => now },
  );

  assert.equal(result.status, "disabled");
  assert.equal(db.localUsers[1].disabledAt?.toISOString(), now.toISOString());
  assert.equal(db.authSessions.every((entry) => entry.userId !== "teacher_1" || entry.revokedAt?.toISOString() === now.toISOString()), true);
  assert.equal(db.csrfTokens.every((entry) => entry.userId !== "teacher_1" || entry.consumedAt?.toISOString() === now.toISOString()), true);
  assert.equal(db.auditLogs.at(-1).action, "auth.user.disabled");
  assert.doesNotMatch(JSON.stringify(db.auditLogs.at(-1)), /passwordHash|plain-password|session_token/i);
});

test("admin user management resets passwords without returning the raw secret", async () => {
  const db = createFakeAdminUsersDb();
  const service = loadAdminUserManagementModule(db);
  const now = new Date("2026-07-11T00:00:00.000Z");

  const result = await service.resetManagedUserPassword(
    {
      userId: "teacher_1",
      newPassword: "M69 reset passphrase 2026!",
      actorUserId: "admin_1",
    },
    { db, now: () => now, passwordHashOptions: testScryptOptions() },
  );

  assert.deepEqual(result, { userId: "teacher_1", status: "password_reset" });
  assert.equal(db.localUsers[1].passwordResetAt?.toISOString(), now.toISOString());
  assert.doesNotMatch(db.localUsers[1].passwordHash, /M69 reset passphrase/);
  assert.equal(db.authSessions.every((entry) => entry.userId !== "teacher_1" || entry.revokedAt?.toISOString() === now.toISOString()), true);
  assert.doesNotMatch(JSON.stringify(result), /M69 reset passphrase|passwordHash|sessionToken/i);
});

test("admin user management prevents disabling or demoting the current admin", async () => {
  const db = createFakeAdminUsersDb();
  const service = loadAdminUserManagementModule(db);

  const disableSelf = await captureRejection(() =>
    service.updateManagedUserStatus({ userId: "admin_1", disabled: true, actorUserId: "admin_1" }, { db }),
  );
  assert.equal(disableSelf.status, 400);
  assert.equal(db.localUsers[0].disabledAt, null);

  const demoteSelf = await captureRejection(() =>
    service.updateManagedUserRole({ userId: "admin_1", role: "teacher", actorUserId: "admin_1" }, { db }),
  );
  assert.equal(demoteSelf.status, 400);
  assert.equal(db.localUsers[0].role, "admin");
});

function createFakeAdminUsersDb() {
  const createdAt = new Date("2026-07-10T00:00:00.000Z");
  const localUsers = [
    {
      id: "admin_1",
      email: "admin@example.test",
      displayName: "管理员",
      role: "admin",
      authMode: "password",
      passwordHash: "hash-admin",
      disabledAt: null,
      disabledReason: null,
      lastLoginAt: null,
      passwordResetAt: null,
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: "teacher_1",
      email: "teacher@example.test",
      displayName: "王老师",
      role: "teacher",
      authMode: "password",
      passwordHash: "hash-teacher",
      disabledAt: null,
      disabledReason: null,
      lastLoginAt: null,
      passwordResetAt: null,
      createdAt,
      updatedAt: createdAt,
    },
  ];
  const authSessions = [
    { id: "session_1", userId: "teacher_1", revokedAt: null, updatedAt: createdAt },
    { id: "session_2", userId: "admin_1", revokedAt: null, updatedAt: createdAt },
  ];
  const csrfTokens = [
    { id: "csrf_1", sessionId: "session_1", userId: "teacher_1", consumedAt: null },
    { id: "csrf_2", sessionId: "session_2", userId: "admin_1", consumedAt: null },
  ];
  const auditLogs = [];
  const db = {
    localUsers,
    authSessions,
    csrfTokens,
    auditLogs,
    localUser: {
      async findMany({ where, orderBy } = {}) {
        let rows = [...localUsers];
        const query = where?.OR?.[0]?.email?.contains ?? where?.OR?.[1]?.displayName?.contains;
        if (query) {
          rows = rows.filter((user) => `${user.email} ${user.displayName}`.toLowerCase().includes(query.toLowerCase()));
        }
        if (orderBy?.createdAt === "asc") rows.sort((left, right) => left.createdAt - right.createdAt);
        return rows;
      },
      async findUnique({ where }) {
        return localUsers.find((user) => user.id === where.id || user.email === where.email) ?? null;
      },
      async update({ where, data }) {
        const user = localUsers.find((entry) => entry.id === where.id);
        if (!user) throw new Error("LocalUser not found");
        Object.assign(user, data);
        return user;
      },
    },
    authSession: {
      async updateMany({ where, data }) {
        let count = 0;
        for (const entry of authSessions) {
          if (entry.userId === where.userId && entry.revokedAt === where.revokedAt) {
            Object.assign(entry, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    csrfToken: {
      async updateMany({ where, data }) {
        let count = 0;
        for (const entry of csrfTokens) {
          if (entry.userId === where.userId && entry.consumedAt === where.consumedAt) {
            Object.assign(entry, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    auditLog: {
      async create({ data }) {
        auditLogs.push(data);
        return data;
      },
    },
    async $transaction(callback) {
      return callback(db);
    },
  };
  return db;
}

function testScryptOptions() {
  return { cost: 16, blockSize: 1, parallelization: 1, keyLength: 32, saltBytes: 8 };
}

async function captureRejection(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail("Expected operation to reject");
}

function loadAdminUserManagementModule(db) {
  const auditLog = loadTsModule(path.join(root, "src", "server", "auth", "audit-log.ts"), {});
  const password = loadTsModule(path.join(root, "src", "server", "auth", "password.ts"), {
    "node:crypto": require("node:crypto"),
  });
  return loadTsModule(path.join(root, "src", "server", "auth", "admin-user-management.ts"), {
    "@/server/auth/audit-log": auditLog,
    "@/server/auth/password": password,
    "@/server/db/client": { prisma: db },
  });
}

function loadTsModule(sourcePath, imports) {
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  const requireShim = (specifier) => {
    if (imports[specifier]) return imports[specifier];
    throw new Error(`Unexpected import in admin user management test: ${specifier}`);
  };
  new Function("require", "exports", "module", compiled.outputText)(requireShim, module.exports, module);
  return module.exports;
}
