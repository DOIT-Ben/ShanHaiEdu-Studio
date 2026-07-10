import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = process.cwd();
process.env.SHANHAI_PUBLIC_REGISTRATION_ENABLED = "1";

test("password auth API routes register, login, read current user, and logout", async () => {
  const calls = [];
  const auth = {
    async registerPasswordUser(input) {
      calls.push(["register", input]);
      return authResult("user_1", "teacher@example.test", "王老师", "register_token");
    },
    async loginPasswordUser(input) {
      calls.push(["login", input]);
      return authResult("user_1", "teacher@example.test", "王老师", "login_token");
    },
    async getCurrentPasswordUser(request) {
      calls.push(["me", request.headers.get("cookie")]);
      if (!request.headers.get("cookie")) return { authenticated: false, user: null };
      return {
        authenticated: true,
        user: userSummary("user_1", "teacher@example.test", "王老师"),
      };
    },
    async logoutPasswordSession(request) {
      calls.push(["logout", request.headers.get("cookie")]);
      return {
        revoked: true,
        clearCookieHeader: "shanhai_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure",
      };
    },
  };

  const registerRoute = loadRoute("src/app/api/auth/register/route.ts", auth);
  const loginRoute = loadRoute("src/app/api/auth/login/route.ts", auth);
  const meRoute = loadRoute("src/app/api/auth/me/route.ts", auth);
  const logoutRoute = loadRoute("src/app/api/auth/logout/route.ts", auth);

  const register = await registerRoute.POST(jsonRequest("/api/auth/register", {
    email: "teacher@example.test",
    displayName: "王老师",
    password: "M40B route passphrase 2026!",
  }));
  assert.equal(register.status, 201);
  assert.match(register.headers.get("set-cookie"), /^shanhai_session=register_token;/);
  await assertSanitizedAuthBody(register, {
    authenticated: true,
    user: userSummary("user_1", "teacher@example.test", "王老师"),
  });

  const login = await loginRoute.POST(jsonRequest("/api/auth/login", {
    email: "teacher@example.test",
    password: "M40B route passphrase 2026!",
  }));
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /^shanhai_session=login_token;/);
  await assertSanitizedAuthBody(login, {
    authenticated: true,
    user: userSummary("user_1", "teacher@example.test", "王老师"),
  });

  const anonymous = await meRoute.GET(new Request("https://localhost/api/auth/me"));
  assert.equal(anonymous.status, 200);
  assert.deepEqual(await anonymous.json(), { enabled: true, authMode: "password", authenticated: false, user: null });

  const current = await meRoute.GET(
    new Request("https://localhost/api/auth/me", {
      headers: { cookie: "shanhai_session=login_token" },
    }),
  );
  assert.equal(current.status, 200);
  assert.deepEqual(await current.json(), {
    enabled: true,
    authMode: "password",
    authenticated: true,
    user: userSummary("user_1", "teacher@example.test", "王老师"),
  });

  const logout = await logoutRoute.POST(
    new Request("https://localhost/api/auth/logout", {
      method: "POST",
      headers: { cookie: "shanhai_session=login_token" },
    }),
  );
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /^shanhai_session=;/);
  assert.deepEqual(await logout.json(), { authenticated: false, user: null, revoked: true });

  assert.deepEqual(calls.map(([name]) => name), ["register", "login", "me", "me", "logout"]);
});

test("password auth API routes return generic login failures and invalid input errors", async () => {
  const genericError = new Error("账号或密码不正确。");
  genericError.status = 401;
  const auth = {
    async registerPasswordUser() {
      const error = new Error("这个邮箱已经可以登录，请直接登录。");
      error.status = 409;
      throw error;
    },
    async loginPasswordUser() {
      throw genericError;
    },
    async getCurrentPasswordUser() {
      return { authenticated: false, user: null };
    },
    async logoutPasswordSession() {
      return { revoked: false, clearCookieHeader: "shanhai_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax" };
    },
  };

  const registerRoute = loadRoute("src/app/api/auth/register/route.ts", auth);
  const loginRoute = loadRoute("src/app/api/auth/login/route.ts", auth);

  const invalid = await registerRoute.POST(jsonRequest("/api/auth/register", { email: "", password: "" }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "请输入有效的邮箱和密码。" });

  const duplicate = await registerRoute.POST(jsonRequest("/api/auth/register", {
    email: "teacher@example.test",
    password: "M40B route passphrase 2026!",
  }));
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { error: "这个邮箱已经可以登录，请直接登录。" });

  const failed = await loginRoute.POST(jsonRequest("/api/auth/login", {
    email: "missing@example.test",
    password: "M40B route passphrase 2026!",
  }));
  assert.equal(failed.status, 401);
  assert.deepEqual(await failed.json(), { error: "账号或密码不正确。" });
});

function authResult(id, email, displayName, cookieValue) {
  return {
    user: userSummary(id, email, displayName),
    session: { id: cookieValue, expiresAt: new Date("2026-07-09T00:00:00.000Z") },
    setCookieHeader: `shanhai_session=${cookieValue}; Max-Age=86400; Path=/; HttpOnly; SameSite=Lax; Secure`,
  };
}

function userSummary(id, email, displayName) {
  return {
    id,
    email,
    displayName,
    role: "teacher",
    authMode: "password",
  };
}

function jsonRequest(pathname, body) {
  return new Request(`https://localhost${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function assertSanitizedAuthBody(response, expected) {
  const body = await response.json();
  assert.deepEqual(body, expected);
  const raw = JSON.stringify(body);
  assert.doesNotMatch(raw, /passwordHash|sessionToken|sessionTokenHash|M40B route passphrase/i);
}

function loadRoute(sourcePath, auth) {
  return loadTsModule(path.join(root, sourcePath), {
    "@/server/auth/password-auth": auth,
    "@/server/auth/session": {
      resolveAuthMode() {
        return "password";
      },
    },
    "@/server/auth/rate-limit": {
      checkRateLimit() {
        return { allowed: true, remaining: 1, retryAfterSeconds: 0 };
      },
      rateLimitKeyFromRequest() {
        return "password-auth-route-test";
      },
      resetRateLimit() {},
    },
    "next/server": {
      NextResponse: {
        json(body, init = {}) {
          const headers = new Headers(init.headers);
          headers.set("content-type", "application/json");
          return new Response(JSON.stringify(body), {
            status: init.status ?? 200,
            headers,
          });
        },
      },
    },
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
    throw new Error(`Unexpected import in password auth route test: ${specifier}`);
  };
  new Function("require", "exports", "module", compiled.outputText)(requireShim, module.exports, module);
  return module.exports;
}
