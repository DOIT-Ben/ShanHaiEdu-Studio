import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);

test("password hashing stores only salted scrypt verifier and verifies passphrases", async () => {
  const password = loadPasswordModule();
  const passphrase = "M40B sample passphrase 2026!";

  const first = await password.hashPassword(passphrase, testScryptOptions());
  const second = await password.hashPassword(passphrase, testScryptOptions());

  assert.match(first, /^scrypt\$v=1\$/);
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /M40B sample passphrase/);
  assert.equal(await password.verifyPassword(passphrase, first), true);
  assert.equal(await password.verifyPassword("M40B different passphrase", first), false);
});

test("password auth service registers, logs in, and logs out without persisting raw session token", async () => {
  const db = createFakeAuthDb();
  const auth = loadPasswordAuthModule(db);
  const passphrase = "M40B service passphrase 2026!";

  const registered = await auth.registerPasswordUser(
    {
      email: " Teacher@Example.Test ",
      displayName: " 王老师 ",
      password: passphrase,
    },
    serviceOptions(db),
  );

  assert.equal(registered.user.email, "teacher@example.test");
  assert.equal(registered.user.displayName, "王老师");
  assert.equal(registered.user.authMode, "password");
  assert.equal(db.localUsers[0].authMode, "password");
  assert.equal(db.localUsers[0].email, "teacher@example.test");
  assert.doesNotMatch(db.localUsers[0].passwordHash, /M40B service passphrase/);
  assert.equal(db.authSessions.length, 1);
  assert.notEqual(db.authSessions[0].sessionTokenHash, registered.session.id);
  assert.match(registered.setCookieHeader, /^shanhai_session=/);
  assert.match(registered.setCookieHeader, /HttpOnly/);
  assert.equal(registered.user.passwordHash, undefined);

  const loggedIn = await auth.loginPasswordUser(
    {
      email: "teacher@example.test",
      password: passphrase,
    },
    serviceOptions(db),
  );
  assert.equal(loggedIn.user.id, registered.user.id);
  assert.match(loggedIn.setCookieHeader, /^shanhai_session=/);
  assert.equal(db.authSessions.length, 2);

  const missingUserError = await captureRejection(() =>
    auth.loginPasswordUser({ email: "missing@example.test", password: "M40B bad passphrase" }, serviceOptions(db)),
  );
  const wrongSecretError = await captureRejection(() =>
    auth.loginPasswordUser({ email: "teacher@example.test", password: "M40B bad passphrase" }, serviceOptions(db)),
  );
  assert.equal(missingUserError.message, wrongSecretError.message);
  assert.equal(missingUserError.status, 401);

  const logout = await auth.logoutPasswordSession(cookieRequest(loggedIn.setCookieHeader), serviceOptions(db));
  assert.equal(logout.revoked, true);
  assert.match(logout.clearCookieHeader, /^shanhai_session=;/);
  assert.ok(db.authSessions.some((entry) => entry.revokedAt instanceof Date));
});

test("current password user resolves only active non-expired sessions", async () => {
  const db = createFakeAuthDb();
  const auth = loadPasswordAuthModule(db);
  const registered = await auth.registerPasswordUser(
    {
      email: "current@example.test",
      displayName: "当前教师",
      password: "M40B current passphrase 2026!",
    },
    serviceOptions(db),
  );

  const active = await auth.getCurrentPasswordUser(cookieRequest(registered.setCookieHeader), serviceOptions(db));
  assert.equal(active.authenticated, true);
  assert.equal(active.user.email, "current@example.test");
  assert.equal(active.user.passwordHash, undefined);

  db.authSessions[0].expiresAt = new Date(Date.now() - 1000);
  const expired = await auth.getCurrentPasswordUser(cookieRequest(registered.setCookieHeader), serviceOptions(db));
  assert.deepEqual(expired, { authenticated: false, user: null });
});

function serviceOptions(db) {
  return {
    db,
    now: () => new Date("2026-07-08T00:00:00.000Z"),
    passwordHashOptions: testScryptOptions(),
    generateSessionToken: nextSessionToken,
    generateUserId: nextUserId,
  };
}

function testScryptOptions() {
  return { cost: 16, blockSize: 1, parallelization: 1, keyLength: 32, saltBytes: 8 };
}

let sessionCounter = 0;
function nextSessionToken() {
  sessionCounter += 1;
  return `m40b_session_token_${String(sessionCounter).padStart(2, "0")}`;
}

let userCounter = 0;
function nextUserId() {
  userCounter += 1;
  return `m40b_user_${String(userCounter).padStart(2, "0")}`;
}

function cookieRequest(setCookieHeader) {
  const cookie = setCookieHeader.split(";")[0];
  return new Request("https://localhost/api/auth/me", {
    headers: { cookie },
  });
}

async function captureRejection(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail("Expected operation to reject");
}

function createFakeAuthDb() {
  const localUsers = [];
  const authSessions = [];
  const auditLogs = [];
  const csrfTokens = [];
  return {
    localUsers,
    authSessions,
    auditLogs,
    csrfTokens,
    localUser: {
      async findUnique({ where }) {
        if (where.email) return localUsers.find((entry) => entry.email === where.email) ?? null;
        if (where.id) return localUsers.find((entry) => entry.id === where.id) ?? null;
        return null;
      },
      async create({ data }) {
        if (localUsers.some((entry) => entry.email === data.email)) {
          const error = new Error("Unique constraint failed");
          error.code = "P2002";
          throw error;
        }
        const entry = { ...data, createdAt: new Date(), updatedAt: new Date() };
        localUsers.push(entry);
        return entry;
      },
    },
    authSession: {
      async create({ data }) {
        const entry = { id: `db_session_${authSessions.length + 1}`, ...data, createdAt: new Date(), updatedAt: new Date() };
        authSessions.push(entry);
        return entry;
      },
      async findFirst({ where, include }) {
        const entry =
          authSessions.find(
            (candidate) =>
              candidate.sessionTokenHash === where.sessionTokenHash &&
              candidate.revokedAt === null &&
              (!where.expiresAt || candidate.expiresAt > where.expiresAt.gt),
          ) ?? null;
        if (!entry) return null;
        const user = localUsers.find((candidate) => candidate.id === entry.userId) ?? null;
        return include?.user ? { ...entry, user } : entry;
      },
      async update({ where, data }) {
        const entry = authSessions.find((candidate) => candidate.id === where.id);
        if (!entry) throw new Error("AuthSession not found");
        Object.assign(entry, data);
        return entry;
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const entry of authSessions) {
          if (entry.sessionTokenHash === where.sessionTokenHash && entry.revokedAt === null) {
            Object.assign(entry, data);
            count += 1;
          }
        }
        return { count };
      },
    },
    csrfToken: {
      async create({ data }) {
        const entry = { id: `csrf_${csrfTokens.length + 1}`, ...data, consumedAt: data.consumedAt ?? null, createdAt: new Date() };
        csrfTokens.push(entry);
        return entry;
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const entry of csrfTokens) {
          if (entry.sessionId === where.sessionId && entry.consumedAt === where.consumedAt) {
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
  };
}

function loadPasswordModule() {
  return loadTsModule(path.join(root, "src", "server", "auth", "password.ts"), {
    "node:crypto": require("node:crypto"),
  });
}

function loadPasswordAuthModule(db) {
  const actor = loadTsModule(path.join(root, "src", "server", "auth", "actor.ts"), {});
  const password = loadPasswordModule();
  const session = loadTsModule(path.join(root, "src", "server", "auth", "session.ts"), {
    "@/server/auth/actor": actor,
    "@/server/auth/local-session": loadTsModule(path.join(root, "src", "server", "auth", "local-session.ts"), {
      "node:crypto": require("node:crypto"),
      "@/server/auth/actor": actor,
    }),
    "@/server/db/client": { prisma: db },
    "node:crypto": require("node:crypto"),
  });
  const auditLog = loadTsModule(path.join(root, "src", "server", "auth", "audit-log.ts"), {});
  const csrf = loadTsModule(path.join(root, "src", "server", "auth", "csrf.ts"), {
    "node:crypto": require("node:crypto"),
    "@/server/auth/actor": actor,
    "@/server/db/client": { prisma: db },
  });
  return loadTsModule(path.join(root, "src", "server", "auth", "password-auth.ts"), {
    "@/server/auth/audit-log": auditLog,
    "@/server/auth/csrf": csrf,
    "@/server/auth/password": password,
    "@/server/auth/session": session,
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
    throw new Error(`Unexpected import in password auth test: ${specifier}`);
  };
  new Function("require", "exports", "module", compiled.outputText)(requireShim, module.exports, module);
  return module.exports;
}
