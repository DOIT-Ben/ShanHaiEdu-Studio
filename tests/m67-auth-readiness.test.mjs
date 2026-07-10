import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);

test("production auth mode fails closed while development compatibility stays explicit", () => {
  const session = loadSessionModule();

  withEnv({ NODE_ENV: "production", SHANHAI_AUTH_MODE: undefined }, () => {
    assert.throws(() => session.resolveAuthMode(), /SHANHAI_AUTH_MODE/);
  });
  withEnv({ NODE_ENV: "production", SHANHAI_AUTH_MODE: "invalid" }, () => {
    assert.throws(() => session.resolveAuthMode(), /SHANHAI_AUTH_MODE/);
  });
  withEnv({ NODE_ENV: "production", SHANHAI_AUTH_MODE: "password" }, () => {
    assert.equal(session.resolveAuthMode(), "password");
  });
  withEnv({ NODE_ENV: "development", SHANHAI_AUTH_MODE: undefined }, () => {
    assert.equal(session.resolveAuthMode(), "local");
  });
  withEnv({ NODE_ENV: "test", SHANHAI_AUTH_MODE: "local" }, () => {
    assert.equal(session.resolveAuthMode(), "local");
  });
  withEnv({ NODE_ENV: "development", SHANHAI_AUTH_MODE: "invalid" }, () => {
    assert.throws(() => session.resolveAuthMode(), /SHANHAI_AUTH_MODE/);
  });
});

test("feedback management requires a non-empty password administrator actor", () => {
  const authorization = loadTsModule(path.join(root, "src", "server", "auth", "authorization.ts"), {
    "@/server/auth/actor": loadTsModule(path.join(root, "src", "server", "auth", "actor.ts"), {}),
  });
  const actor = (overrides = {}) => ({
    userId: "admin-1",
    displayName: "管理员",
    role: "admin",
    authMode: "password",
    isAdmin: true,
    projectRoles: {},
    ...overrides,
  });

  assert.equal(authorization.canManageFeedback(actor()), true);
  assert.equal(authorization.canManageFeedback(), false);
  assert.equal(authorization.canManageFeedback(actor({ userId: "" })), false);
  assert.equal(authorization.canManageFeedback(actor({ userId: "   " })), false);
  assert.equal(authorization.canManageFeedback(actor({ authMode: "local" })), false);
  assert.equal(authorization.canManageFeedback(actor({ isAdmin: false, role: "teacher" })), false);
});

test("single-instance auth rate limiter blocks excess attempts and can reset in tests", () => {
  const limiter = loadTsModule(path.join(root, "src", "server", "auth", "rate-limit.ts"), {});
  limiter.resetRateLimits();

  assert.equal(limiter.checkRateLimit({ scope: "login", key: "client-a", limit: 2, windowMs: 60_000, now: 1_000 }).allowed, true);
  assert.equal(limiter.checkRateLimit({ scope: "login", key: "client-a", limit: 2, windowMs: 60_000, now: 2_000 }).allowed, true);
  const blocked = limiter.checkRateLimit({ scope: "login", key: "client-a", limit: 2, windowMs: 60_000, now: 3_000 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 58);

  limiter.resetRateLimits();
  assert.equal(limiter.checkRateLimit({ scope: "login", key: "client-a", limit: 2, windowMs: 60_000, now: 4_000 }).allowed, true);
});

test("rate limit client identity trusts proxy headers only when explicitly configured", () => {
  const limiter = loadTsModule(path.join(root, "src", "server", "auth", "rate-limit.ts"), {});
  const request = new Request("https://localhost/api/auth/login", {
    headers: { "x-forwarded-for": "203.0.113.9, 127.0.0.1", "x-real-ip": "203.0.113.10" },
  });

  withEnv({ SHANHAI_TRUST_PROXY: undefined }, () => assert.equal(limiter.rateLimitKeyFromRequest(request), "unknown-client"));
  withEnv({ SHANHAI_TRUST_PROXY: "0" }, () => assert.equal(limiter.rateLimitKeyFromRequest(request), "unknown-client"));
  withEnv({ SHANHAI_TRUST_PROXY: "1" }, () => assert.equal(limiter.rateLimitKeyFromRequest(request), "203.0.113.9"));
});

test("single-instance auth rate limiter keeps a bounded number of client buckets", () => {
  const limiter = loadTsModule(path.join(root, "src", "server", "auth", "rate-limit.ts"), {});
  limiter.resetRateLimits();
  limiter.checkRateLimit({ scope: "login", key: "oldest-client", limit: 1, windowMs: 60_000, now: 1_000 });
  for (let index = 0; index < 10_001; index += 1) {
    limiter.checkRateLimit({ scope: "login", key: `rotating-client-${index}`, limit: 1, windowMs: 60_000, now: 1_000 });
  }
  assert.equal(
    limiter.checkRateLimit({ scope: "login", key: "oldest-client", limit: 1, windowMs: 60_000, now: 2_000 }).allowed,
    true,
  );
});

test("public registration is closed with a safe 403 unless explicitly enabled", async () => {
  let registrations = 0;
  const route = loadRoute("src/app/api/auth/register/route.ts", {
    "@/server/auth/password-auth": {
      PasswordAuthError: class PasswordAuthError extends Error {},
      async registerPasswordUser() {
        registrations += 1;
        return authResult("registered-user");
      },
    },
    "@/server/auth/rate-limit": allowRateLimitStub(),
  });

  await withEnv({ SHANHAI_PUBLIC_REGISTRATION_ENABLED: "0" }, async () => {
    const response = await route.POST(jsonRequest("/api/auth/register", validCredentials()));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "公开注册未开放。" });
  });
  assert.equal(registrations, 0);

  await withEnv({ NODE_ENV: "production", SHANHAI_PUBLIC_REGISTRATION_ENABLED: "1" }, async () => {
    const response = await route.POST(jsonRequest("/api/auth/register", validCredentials()));
    assert.equal(response.status, 403);
  });
  assert.equal(registrations, 0);

  await withEnv({ NODE_ENV: "test", SHANHAI_PUBLIC_REGISTRATION_ENABLED: "1" }, async () => {
    const response = await route.POST(jsonRequest("/api/auth/register", validCredentials()));
    assert.equal(response.status, 201);
  });
  assert.equal(registrations, 1);
});

test("login applies the client gate before reading the request body", async () => {
  let jsonCalls = 0;
  const route = loadRoute("src/app/api/auth/login/route.ts", {
    "@/server/auth/password-auth": {
      PasswordAuthError: class PasswordAuthError extends Error {},
      async loginPasswordUser() {
        throw new Error("login must not run");
      },
    },
    "@/server/auth/rate-limit": {
      checkRateLimit() {
        return { allowed: false, remaining: 0, retryAfterSeconds: 42 };
      },
      rateLimitKeyFromRequest() {
        return "unknown-client";
      },
      resetRateLimit() {},
    },
  });

  const request = new Request("https://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validCredentials()),
  });
  request.json = async () => {
    jsonCalls += 1;
    return validCredentials();
  };
  const response = await route.POST(request);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "42");
  assert.equal(jsonCalls, 0);
});

test("login rejects declared and streamed request bodies larger than 16 KiB", async () => {
  let loginCalls = 0;
  const route = loadRoute("src/app/api/auth/login/route.ts", {
    "@/server/auth/password-auth": {
      PasswordAuthError: class PasswordAuthError extends Error {},
      async loginPasswordUser() {
        loginCalls += 1;
        return authResult("teacher-1");
      },
    },
    "@/server/auth/rate-limit": allowRateLimitStub(),
  });
  const declared = await route.POST(
    new Request("https://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "16385" },
      body: JSON.stringify(validCredentials()),
    }),
  );
  assert.equal(declared.status, 413);
  const streamed = await route.POST(
    new Request("https://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validCredentials(), padding: "x".repeat(17 * 1024) }),
    }),
  );
  assert.equal(streamed.status, 413);
  assert.equal(loginCalls, 0);
});

test("login limits each trusted client-account pair before password verification", async () => {
  class PasswordAuthError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }
  const limiter = loadTsModule(path.join(root, "src", "server", "auth", "rate-limit.ts"), {});
  limiter.resetRateLimits();
  let verificationCalls = 0;
  const route = loadRoute("src/app/api/auth/login/route.ts", {
    "@/server/auth/password-auth": {
      PasswordAuthError,
      async loginPasswordUser(input) {
        verificationCalls += 1;
        if (input.password !== "M67 correct password!") throw new PasswordAuthError("账号或密码不正确。", 401);
        return authResult("teacher-1");
      },
    },
    "@/server/auth/rate-limit": limiter,
  });

  await withEnv(
    {
      SHANHAI_TRUST_PROXY: "1",
      SHANHAI_LOGIN_CLIENT_RATE_LIMIT: "100",
      SHANHAI_LOGIN_CLIENT_ACCOUNT_RATE_LIMIT: "5",
    },
    async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await route.POST(loginRequest("M67 wrong password!", "203.0.113.10"));
      assert.equal(failed.status, 401);
    }
    const blocked = await route.POST(loginRequest("M67 wrong password!", "203.0.113.10"));
    assert.equal(blocked.status, 429);
    assert.equal(verificationCalls, 5);

    const otherClient = await route.POST(loginRequest("M67 correct password!", "203.0.113.11"));
    assert.equal(otherClient.status, 200);
    assert.equal(verificationCalls, 6);

    const firstClientStillBlocked = await route.POST(loginRequest("M67 correct password!", "203.0.113.10"));
    assert.equal(firstClientStillBlocked.status, 429);
    assert.equal(verificationCalls, 6);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await route.POST(loginRequest("M67 wrong password!", "203.0.113.11"));
      assert.equal(failed.status, 401);
    }
    const blockedFailure = await route.POST(loginRequest("M67 wrong password!", "203.0.113.11"));
    assert.equal(blockedFailure.status, 429);
    assert.equal(verificationCalls, 11);
    },
  );
});

test("non-production direct mode uses a high short-window guard instead of the client threshold", async () => {
  const limiter = loadTsModule(path.join(root, "src", "server", "auth", "rate-limit.ts"), {});
  limiter.resetRateLimits();
  const route = loadRoute("src/app/api/auth/login/route.ts", {
    "@/server/auth/password-auth": {
      PasswordAuthError: class PasswordAuthError extends Error {},
      async loginPasswordUser() {
        throw new Error("invalid bodies must not reach password verification");
      },
    },
    "@/server/auth/rate-limit": limiter,
  });

  await withEnv({ NODE_ENV: "development", SHANHAI_TRUST_PROXY: undefined }, async () => {
    for (let attempt = 0; attempt < 101; attempt += 1) {
      const response = await route.POST(jsonRequest("/api/auth/login", {}));
      assert.equal(response.status, 400);
    }
  });
});

test("invite API requires password admin and CSRF and never echoes the initial password", async () => {
  const initialPassword = "M67 initial password never echo!";
  let sessionActor = adminActor();
  let csrfValid = true;
  const provisionCalls = [];
  const route = loadRoute("src/app/api/admin/users/invite/route.ts", {
    "@/server/auth/session": {
      async resolveWorkbenchSession() {
        return {
          actor: sessionActor,
          authMode: sessionActor?.authMode ?? "password",
          isNewSession: false,
          publicSession: { id: "session-db-id", userId: sessionActor?.userId, expiresAt: new Date(Date.now() + 60_000) },
        };
      },
    },
    "@/server/auth/authorization": {
      canManageFeedback(actor) {
        return Boolean(actor?.userId?.trim() && actor.authMode === "password" && actor.isAdmin === true);
      },
    },
    "@/server/auth/csrf": {
      publicCsrfHeaderName: "x-shanhai-csrf",
      async validateCsrfToken(input) {
        return csrfValid && input.sessionId === "session-db-id" && input.userId === "admin-1" && input.token === "valid-csrf-token";
      },
    },
    "@/server/auth/rate-limit": allowRateLimitStub(),
    "@/server/auth/user-provisioning": {
      UserProvisioningError: class UserProvisioningError extends Error {},
      async provisionPasswordUser(input) {
        provisionCalls.push(input);
        return { userId: "teacher-1", status: "created" };
      },
    },
  });

  sessionActor = adminActor({ authMode: "local" });
  let response = await route.POST(inviteRequest(initialPassword));
  assert.equal(response.status, 403);

  sessionActor = adminActor();
  csrfValid = false;
  response = await route.POST(inviteRequest(initialPassword));
  assert.equal(response.status, 403);

  csrfValid = true;
  response = await route.POST(inviteRequest(initialPassword));
  assert.equal(response.status, 201);
  const responseText = await response.clone().text();
  assert.deepEqual(await response.json(), { userId: "teacher-1", status: "created" });
  assert.equal(provisionCalls.length, 1);
  assert.equal(provisionCalls[0].actorUserId, "admin-1");
  assert.equal(provisionCalls[0].role, "teacher");
  assert.equal(provisionCalls[0].activationState, undefined);
  assert.equal(responseText.includes(initialPassword), false);
});

test("password user provisioning stores only a hash and writes credential-free audit metadata", async () => {
  const users = [];
  const auditLogs = [];
  let transactionCalls = 0;
  let auditShouldFail = false;
  const db = {
    localUser: {
      async findUnique({ where }) {
        return users.find((user) => user.email === where.email) ?? null;
      },
      async create({ data }) {
        const user = { ...data };
        users.push(user);
        return user;
      },
    },
    auditLog: {
      async create({ data }) {
        if (auditShouldFail) throw new Error("audit unavailable");
        auditLogs.push(data);
        return data;
      },
    },
    async $transaction(callback) {
      transactionCalls += 1;
      const userCount = users.length;
      const auditCount = auditLogs.length;
      try {
        return await callback(this);
      } catch (error) {
        users.length = userCount;
        auditLogs.length = auditCount;
        throw error;
      }
    },
  };
  const initialPassword = "M67 audit secret never store!";
  const provisioning = loadTsModule(path.join(root, "src", "server", "auth", "user-provisioning.ts"), {
    "@/server/auth/audit-log": loadTsModule(path.join(root, "src", "server", "auth", "audit-log.ts"), {}),
    "@/server/auth/password": {
      async hashPassword(value) {
        assert.equal(value, initialPassword);
        return "safe-password-hash";
      },
    },
    "@/server/db/client": { prisma: db },
  });

  const result = await provisioning.provisionPasswordUser(
    {
      email: "teacher@example.test",
      displayName: "教师",
      initialPassword,
      role: "teacher",
      actorUserId: "admin-1",
      source: "admin_api",
    },
    { db, generateUserId: () => "teacher-1", now: () => new Date("2026-07-10T00:00:00.000Z") },
  );

  assert.deepEqual(result, { userId: "teacher-1", status: "created" });
  assert.equal(transactionCalls, 1);
  assert.equal(users[0].authMode, "password");
  assert.equal(users[0].passwordHash, "safe-password-hash");
  const serializedAudit = JSON.stringify(auditLogs);
  assert.doesNotMatch(serializedAudit, /M67 audit secret never store|initialPassword|passwordHash/);
  assert.match(serializedAudit, /auth\.user\.invited/);

  await assert.rejects(
    () =>
      provisioning.provisionPasswordUser(
        {
          email: "teacher@example.test",
          displayName: "教师",
          initialPassword,
          role: "teacher",
          actorUserId: "admin-1",
          source: "admin_api",
        },
        { db },
      ),
    (error) => error?.status === 409 && !String(error.message).includes("teacher@example.test"),
  );

  auditShouldFail = true;
  await assert.rejects(() =>
    provisioning.provisionPasswordUser(
      {
        email: "rollback@example.test",
        displayName: "回滚教师",
        initialPassword,
        role: "teacher",
        actorUserId: "admin-1",
        source: "admin_api",
      },
      { db, generateUserId: () => "teacher-rollback" },
    ),
  );
  assert.equal(users.some((user) => user.id === "teacher-rollback"), false);
});

test("shared SQLite URL parser rejects ambiguous URLs and is used by auth production scripts", async () => {
  const sqliteUrl = await import("../scripts/lib/sqlite-url.mjs");
  const baseDir = path.join(os.tmpdir(), "shanhai-sqlite-base");

  assert.equal(sqliteUrl.resolveSqliteFileUrl("file:./data/app.db", { baseDir }), path.resolve(baseDir, "data/app.db"));
  for (const databaseUrl of [
    "file::memory:",
    "file:./data/app.db?mode=ro",
    "file:./data/app.db#fragment",
    "file:./data/%61pp.db",
  ]) {
    assert.throws(() => sqliteUrl.resolveSqliteFileUrl(databaseUrl, { baseDir }), /DATABASE_URL/);
  }

  assert.match(readFileSync(path.join(root, "scripts", "production-preflight.mjs"), "utf8"), /scripts\/lib\/sqlite-url|\.\/lib\/sqlite-url/);
  assert.match(readFileSync(path.join(root, "scripts", "bootstrap-admin.mjs"), "utf8"), /\.\/lib\/sqlite-url/);
  assert.match(readFileSync(path.join(root, "scripts", "init-sqlite-schema.mjs"), "utf8"), /\.\/lib\/sqlite-url/);
});

test("package exposes the isolated M67 browser runner", () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.scripts["test:e2e:m67"], "node scripts/run-m67-e2e.mjs");
});

test("production preflight enforces password modes, closed registration, external database, and admin proof", async () => {
  const { runProductionPreflight } = await import("../scripts/production-preflight.mjs");
  const cwd = makeRepoFixture();
  const storageRoot = path.join(os.tmpdir(), `shanhai-storage-${Date.now()}`);
  mkdirSync(storageRoot, { recursive: true });
  const env = completePreflightEnv({ storageRoot, databaseUrl: `file:${makeM67AuthDatabase()}` });

  const passing = await runProductionPreflight({ cwd, env });
  for (const id of ["auth-server-mode", "auth-client-mode", "public-registration", "database-url", "admin-readiness"]) {
    assert.equal(passing.checks.find((check) => check.id === id)?.ok, true, id);
  }

  const unsafe = await runProductionPreflight({
    cwd,
    env: {
      ...env,
      SHANHAI_AUTH_MODE: "local",
      NEXT_PUBLIC_SHANHAI_AUTH_MODE: "local",
      SHANHAI_PUBLIC_REGISTRATION_ENABLED: "1",
      SHANHAI_ADMIN_BOOTSTRAP_CONFIRMED: "0",
      DATABASE_URL: "file:./data/shanhai-production.db",
    },
  });
  for (const id of ["auth-server-mode", "auth-client-mode", "public-registration", "database-url", "admin-readiness"]) {
    assert.equal(unsafe.checks.find((check) => check.id === id)?.ok, false, id);
  }

  const memoryDatabase = await runProductionPreflight({
    cwd,
    env: { ...env, DATABASE_URL: `${env.DATABASE_URL}?mode=memory&cache=shared` },
  });
  assert.equal(memoryDatabase.checks.find((check) => check.id === "database-url")?.ok, false);
});

test("bootstrap and invite CLIs are idempotent and return credential-free status", async () => {
  const bootstrap = await import("../scripts/bootstrap-admin.mjs");
  const invite = await import("../scripts/invite-user.mjs");
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE "LocalUser" (
      "id" TEXT PRIMARY KEY,
      "displayName" TEXT NOT NULL,
      "role" TEXT NOT NULL,
      "authMode" TEXT NOT NULL,
      "email" TEXT UNIQUE,
      "passwordHash" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE "AuditLog" (
      "id" TEXT PRIMARY KEY,
      "actorUserId" TEXT,
      "action" TEXT NOT NULL,
      "targetType" TEXT NOT NULL,
      "targetId" TEXT,
      "projectId" TEXT,
      "metadataJson" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const bootstrapSecret = "M67 bootstrap secret!";
  await assert.rejects(
    () =>
      bootstrap.runBootstrapAdmin({
        db,
        env: {
          SHANHAI_BOOTSTRAP_ADMIN_EMAIL: "admin@example.test",
          SHANHAI_BOOTSTRAP_ADMIN_DISPLAY_NAME: "管理员",
          SHANHAI_BOOTSTRAP_ADMIN_INITIAL_PASSWORD: bootstrapSecret,
        },
        hashPassword: async () => "admin-safe-hash",
      }),
    /CREATE_ADMIN/,
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM "LocalUser"').get().count, 0);

  const admin = await bootstrap.runBootstrapAdmin({
    db,
    env: {
      SHANHAI_BOOTSTRAP_ADMIN_EMAIL: "admin@example.test",
      SHANHAI_BOOTSTRAP_ADMIN_DISPLAY_NAME: "管理员",
      SHANHAI_BOOTSTRAP_ADMIN_INITIAL_PASSWORD: bootstrapSecret,
      SHANHAI_BOOTSTRAP_ADMIN_CONFIRM: "CREATE_ADMIN",
    },
    generateUserId: () => "admin-1",
    generateAuditId: () => "audit-admin",
    hashPassword: async () => "admin-safe-hash",
  });
  assert.deepEqual(admin, { userId: "admin-1", status: "created" });
  assert.deepEqual(Object.keys(admin).sort(), ["status", "userId"]);

  const repeated = await bootstrap.runBootstrapAdmin({ db, env: {} });
  assert.deepEqual(repeated, { userId: "admin-1", status: "already_initialized" });

  const inviteSecret = "M67 teacher invite secret!";
  const teacher = await invite.runInviteUser({
    db,
    env: {
      SHANHAI_INVITE_USER_EMAIL: "teacher@example.test",
      SHANHAI_INVITE_USER_DISPLAY_NAME: "教师",
      SHANHAI_INVITE_USER_INITIAL_PASSWORD: inviteSecret,
    },
    generateUserId: () => "teacher-1",
    generateAuditId: () => "audit-teacher",
    hashPassword: async () => "teacher-safe-hash",
  });
  assert.deepEqual(teacher, { userId: "teacher-1", status: "created" });
  assert.deepEqual(Object.keys(teacher).sort(), ["status", "userId"]);

  db.prepare(
    'INSERT INTO "LocalUser" ("id", "displayName", "role", "authMode", "email", "passwordHash", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run("teacher-pending", "待激活教师", "teacher", "pending", "pending@example.test", "pending-safe-hash", new Date().toISOString());
  const activated = await invite.runInviteUser({
    db,
    env: {
      SHANHAI_INVITE_USER_EMAIL: "pending@example.test",
      SHANHAI_INVITE_USER_DISPLAY_NAME: "已激活教师",
      SHANHAI_INVITE_USER_INITIAL_PASSWORD: "M67 activated teacher secret!",
    },
    generateAuditId: () => "audit-activated-teacher",
    hashPassword: async () => "activated-safe-hash",
  });
  assert.deepEqual(activated, { userId: "teacher-pending", status: "activated" });
  assert.equal(db.prepare('SELECT "authMode" FROM "LocalUser" WHERE "id" = ?').get("teacher-pending").authMode, "password");

  const stored = JSON.stringify({
    users: db.prepare('SELECT "id", "passwordHash" FROM "LocalUser" ORDER BY "id"').all(),
    audits: db.prepare('SELECT "action", "metadataJson" FROM "AuditLog" ORDER BY "id"').all(),
  });
  assert.equal(stored.includes(bootstrapSecret), false);
  assert.equal(stored.includes(inviteSecret), false);
  assert.doesNotMatch(stored, /initialPassword/);
  assert.match(stored, /auth\.admin\.bootstrapped/);
  assert.match(stored, /auth\.user\.invited/);
  db.close();
});

function loadSessionModule() {
  const actor = loadTsModule(path.join(root, "src", "server", "auth", "actor.ts"), {});
  return loadTsModule(path.join(root, "src", "server", "auth", "session.ts"), {
    "@/server/auth/local-session": {
      resolveLocalWorkbenchActor() {
        throw new Error("not used");
      },
      createLocalSessionSetCookieHeader() {
        throw new Error("not used");
      },
    },
    "@/server/auth/actor": actor,
    "@/server/db/client": { prisma: {} },
    "node:crypto": require("node:crypto"),
  });
}

function loadRoute(sourcePath, imports) {
  return loadTsModule(path.join(root, sourcePath), {
    ...imports,
    "next/server": {
      NextResponse: {
        json(body, init = {}) {
          const headers = new Headers(init.headers);
          headers.set("content-type", "application/json");
          return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
        },
      },
    },
  });
}

function allowRateLimitStub() {
  return {
    checkRateLimit() {
      return { allowed: true, remaining: 1, retryAfterSeconds: 0 };
    },
    rateLimitKeyFromRequest() {
      return "test-client";
    },
    resetRateLimit() {},
  };
}

function authResult(userId) {
  return {
    user: { id: userId, email: "teacher@example.test", displayName: "教师", role: "teacher", authMode: "password" },
    csrfToken: "csrf-token",
    session: { id: "session-token", expiresAt: new Date(Date.now() + 60_000) },
    setCookieHeader: "shanhai_session=session-token; Path=/; HttpOnly; SameSite=Lax; Secure",
  };
}

function validCredentials() {
  return {
    email: "teacher@example.test",
    displayName: "教师",
    password: "M67 registration password!",
  };
}

function adminActor(overrides = {}) {
  return {
    userId: "admin-1",
    displayName: "管理员",
    role: "admin",
    authMode: "password",
    isAdmin: true,
    projectRoles: {},
    ...overrides,
  };
}

function inviteRequest(initialPassword) {
  return new Request("https://localhost/api/admin/users/invite", {
    method: "POST",
    headers: { "content-type": "application/json", "x-shanhai-csrf": "valid-csrf-token" },
    body: JSON.stringify({ email: "teacher@example.test", displayName: "教师", initialPassword }),
  });
}

function jsonRequest(pathname, body) {
  return new Request(`https://localhost${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function loginRequest(password, clientIp) {
  return new Request("https://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": clientIp },
    body: JSON.stringify({ ...validCredentials(), password }),
  });
}

function makeRepoFixture() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "shanhai-m67-"));
  writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ scripts: { build: "next build", start: "next start" } }));
  writeFileSync(path.join(cwd, "next.config.ts"), 'const nextConfig = { output: "standalone" };\nexport default nextConfig;\n');
  return cwd;
}

function makeM67AuthDatabase() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "shanhai-m67-auth-db-"));
  const databasePath = path.join(directory, "production.db");
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE "LocalUser" (
      "id" TEXT PRIMARY KEY,
      "displayName" TEXT NOT NULL,
      "role" TEXT NOT NULL,
      "authMode" TEXT NOT NULL,
      "email" TEXT UNIQUE,
      "passwordHash" TEXT
    );
  `);
  db.prepare(
    'INSERT INTO "LocalUser" ("id", "displayName", "role", "authMode", "email", "passwordHash") VALUES (?, ?, ?, ?, ?, ?)',
  ).run("admin-m67", "管理员", "admin", "password", "admin@example.test", "test-password-hash");
  db.close();
  return databasePath;
}

function completePreflightEnv({ storageRoot, databaseUrl }) {
  return {
    SHANHAI_PRODUCTION_PREFLIGHT_SKIP_DOTENV: "1",
    SHANHAI_AUTH_MODE: "password",
    SHANHAI_TRUST_PROXY: "1",
    NEXT_PUBLIC_SHANHAI_AUTH_MODE: "password",
    SHANHAI_PUBLIC_REGISTRATION_ENABLED: "0",
    NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED: "0",
    SHANHAI_ADMIN_BOOTSTRAP_CONFIRMED: "1",
    DATABASE_URL: databaseUrl,
    ARTIFACT_STORAGE_ROOT: storageRoot,
    OPENAI_API_KEY: "test-openai-key",
    OPENAI_MODEL: "test-openai-model",
    COZE_API_TOKEN: "test-coze-token",
    COZE_PPT_RUN_URL: "https://coze.invalid/run",
    IMAGE_PROVIDER_CHANNEL: "free",
    IMAGEGEN_FREE_API_KEY: "test-image-key",
    IMAGEGEN_FREE_BASE_URL: "https://image.invalid/v1",
    IMAGEGEN_FREE_MODEL: "test-image-model",
    OCTO_API_KEY: "test-video-key",
    OCTO_BASE_URL: "https://video.invalid/v1",
    VIDEO_MODEL: "test-video-model",
  };
}

function withEnv(values, callback) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    const result = callback();
    if (result && typeof result.then === "function") {
      return result.finally(() => restoreEnv(previous));
    }
    restoreEnv(previous);
    return result;
  } catch (error) {
    restoreEnv(previous);
    throw error;
  }
}

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
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
    throw new Error(`Unexpected import in M67 auth readiness test: ${specifier}`);
  };
  new Function("require", "exports", "module", compiled.outputText)(requireShim, module.exports, module);
  return module.exports;
}
