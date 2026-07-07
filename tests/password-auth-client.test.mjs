import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = process.cwd();

test("password auth client calls the public auth route contract", async () => {
  const { createPasswordAuthClient } = loadAuthApiModule();
  const calls = [];
  const client = createPasswordAuthClient({
    baseUrl: "https://example.test",
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse(responseFor(String(url), init));
    },
  });

  const current = await client.me();
  const registered = await client.register({
    email: "teacher@example.test",
    displayName: "王老师",
    password: "M40C client passphrase 2026!",
  });
  const loggedIn = await client.login({
    email: "teacher@example.test",
    password: "M40C client passphrase 2026!",
  });
  const loggedOut = await client.logout();

  assert.equal(current.authenticated, false);
  assert.equal(registered.user.displayName, "王老师");
  assert.equal(loggedIn.user.email, "teacher@example.test");
  assert.equal(loggedOut.authenticated, false);

  assert.equal(calls[0].url, "https://example.test/api/auth/me");
  assert.equal(calls[1].url, "https://example.test/api/auth/register");
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    email: "teacher@example.test",
    displayName: "王老师",
    password: "M40C client passphrase 2026!",
  });
  assert.equal(calls[2].url, "https://example.test/api/auth/login");
  assert.equal(calls[2].init.method, "POST");
  assert.equal(calls[3].url, "https://example.test/api/auth/logout");
  assert.equal(calls[3].init.method, "POST");
});

test("password auth client converts failures to teacher-facing errors", async () => {
  const { createPasswordAuthClient, PasswordAuthClientError } = loadAuthApiModule();
  const client = createPasswordAuthClient({
    fetcher: async () => jsonResponse({ error: "账号或密码不正确。" }, 401),
  });

  await assert.rejects(
    () => client.login({ email: "missing@example.test", password: "M40C client passphrase 2026!" }),
    (error) => {
      assert.equal(error instanceof PasswordAuthClientError, true);
      assert.equal(error.status, 401);
      assert.equal(error.userMessage, "账号或密码不正确。");
      return true;
    },
  );
});

function responseFor(url, init) {
  if (url.endsWith("/api/auth/me")) return { authenticated: false, user: null };
  if (url.endsWith("/api/auth/logout")) return { authenticated: false, user: null, revoked: true };
  if (url.endsWith("/api/auth/register") || url.endsWith("/api/auth/login")) {
    return {
      authenticated: true,
      user: {
        id: "teacher_1",
        email: JSON.parse(init.body).email,
        displayName: JSON.parse(init.body).displayName ?? "王老师",
        role: "teacher",
        authMode: "password",
      },
    };
  }
  throw new Error(`Unexpected auth client URL: ${url}`);
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function loadAuthApiModule() {
  return loadTsModule(path.join(root, "src", "lib", "auth-api.ts"));
}

function loadTsModule(sourcePath) {
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  new Function("require", "exports", "module", compiled.outputText)(
    (specifier) => {
      throw new Error(`Unexpected import in password auth client test: ${specifier}`);
    },
    module.exports,
    module,
  );
  return module.exports;
}
