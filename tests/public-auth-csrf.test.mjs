import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);

test("public auth write requests require a session-bound csrf token", () => {
  const csrf = loadCsrfModule();

  const csrfBundle = csrf.createCsrfToken({ sessionId: "session-public-a", nonce: "fixed-nonce" });
  assert.equal(csrfBundle.token, "fixed-nonce");
  assert.equal(csrf.verifyCsrfToken({ sessionId: "session-public-a", token: "fixed-nonce", tokenHash: csrfBundle.tokenHash }), true);
  assert.equal(csrf.verifyCsrfToken({ sessionId: "session-public-b", token: "fixed-nonce", tokenHash: csrfBundle.tokenHash }), false);
  assert.equal(csrf.verifyCsrfToken({ sessionId: "session-public-a", token: "wrong-nonce", tokenHash: csrfBundle.tokenHash }), false);
});

test("csrf gate applies only to public auth write methods", () => {
  const csrf = loadCsrfModule();

  assert.equal(csrf.requiresCsrfToken({ method: "POST", authMode: "password" }), true);
  assert.equal(csrf.requiresCsrfToken({ method: "PATCH", authMode: "oauth" }), true);
  assert.equal(csrf.requiresCsrfToken({ method: "GET", authMode: "password" }), false);
  assert.equal(csrf.requiresCsrfToken({ method: "POST", authMode: "local" }), false);
});

test("csrf token issue and validation use the persisted session-bound hash", async () => {
  const csrf = loadCsrfModule();
  const db = createFakeDb();
  const issued = await csrf.issueCsrfToken({
    sessionId: "session-public-a",
    userId: "user-a",
    expiresAt: new Date(Date.now() + 60_000),
    db,
    nonce: "persisted-nonce",
  });

  assert.equal(issued.token, "persisted-nonce");
  assert.equal(db.csrfTokens.length, 1);
  assert.notEqual(db.csrfTokens[0].tokenHash, issued.token);
  assert.equal(
    await csrf.validateCsrfToken({
      sessionId: "session-public-a",
      userId: "user-a",
      token: "persisted-nonce",
      db,
    }),
    true,
  );
  assert.equal(
    await csrf.validateCsrfToken({
      sessionId: "session-public-b",
      userId: "user-a",
      token: "persisted-nonce",
      db,
    }),
    false,
  );
  assert.equal(
    await csrf.validateCsrfToken({
      sessionId: "session-public-a",
      userId: "user-a",
      token: "wrong-nonce",
      db,
    }),
    false,
  );

  db.csrfTokens[0].expiresAt = new Date(Date.now() - 60_000);
  assert.equal(
    await csrf.validateCsrfToken({
      sessionId: "session-public-a",
      userId: "user-a",
      token: "persisted-nonce",
      db,
    }),
    false,
  );
});

function createFakeDb() {
  const csrfTokens = [];
  return {
    csrfTokens,
    csrfToken: {
      async create({ data }) {
        const row = { id: `csrf_${csrfTokens.length + 1}`, ...data, consumedAt: data.consumedAt ?? null, createdAt: new Date() };
        csrfTokens.push(row);
        return row;
      },
      async findFirst({ where }) {
        return (
          csrfTokens.find(
            (entry) =>
              entry.sessionId === where.sessionId &&
              entry.userId === where.userId &&
              entry.tokenHash === where.tokenHash &&
              entry.consumedAt === where.consumedAt &&
              entry.expiresAt > where.expiresAt.gt,
          ) ?? null
        );
      },
    },
  };
}

function loadCsrfModule() {
  return loadTsModule(path.join(root, "src", "server", "auth", "csrf.ts"), {
    "node:crypto": require("node:crypto"),
    "@/server/auth/actor": loadTsModule(path.join(root, "src", "server", "auth", "actor.ts"), {}),
    "@/server/db/client": { prisma: {} },
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
    throw new Error(`Unexpected import in public auth csrf test: ${specifier}`);
  };
  new Function("require", "exports", "module", compiled.outputText)(requireShim, module.exports, module);
  return module.exports;
}
