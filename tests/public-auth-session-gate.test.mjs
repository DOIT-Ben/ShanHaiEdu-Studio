import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);

test("public workbench session resolves only an active DB session and loads memberships", async () => {
  const db = createFakeDb();
  const session = loadSessionModule(db);
  const previousMode = process.env.SHANHAI_AUTH_MODE;
  process.env.SHANHAI_AUTH_MODE = "password";
  try {
    const missing = await session.resolveWorkbenchSession(new Request("https://localhost/api/workbench/projects"));
    assert.equal(missing.actor, null);
    assert.equal(missing.reason, "missing_public_session");

    const valid = await session.resolveWorkbenchSession(
      new Request("https://localhost/api/workbench/projects", {
        headers: { cookie: "shanhai_session=valid_public_session" },
      }),
    );
    assert.equal(valid.actor.userId, "user_password_1");
    assert.equal(valid.actor.displayName, "王老师");
    assert.equal(valid.actor.authMode, "password");
    assert.equal(valid.actor.projectRoles.project_shared, "editor");
    assert.equal(valid.publicSession.id, "auth_session_1");

    const expired = await session.resolveWorkbenchSession(
      new Request("https://localhost/api/workbench/projects", {
        headers: { cookie: "shanhai_session=expired_public_session" },
      }),
    );
    assert.equal(expired.actor, null);

    const revoked = await session.resolveWorkbenchSession(
      new Request("https://localhost/api/workbench/projects", {
        headers: { cookie: "shanhai_session=revoked_public_session" },
      }),
    );
    assert.equal(revoked.actor, null);
  } finally {
    restoreEnv("SHANHAI_AUTH_MODE", previousMode);
  }
});

function createFakeDb() {
  const sessionModule = loadSessionModuleWithoutDb();
  const now = Date.now();
  const user = {
    id: "user_password_1",
    email: "teacher@example.test",
    displayName: "王老师",
    role: "teacher",
    authMode: "password",
    memberships: [{ projectId: "project_shared", role: "editor" }],
  };
  const rows = [
    {
      id: "auth_session_1",
      userId: user.id,
      sessionTokenHash: sessionModule.hashPublicSessionToken("valid_public_session"),
      authMode: "password",
      expiresAt: new Date(now + 60_000),
      revokedAt: null,
      user,
    },
    {
      id: "auth_session_expired",
      userId: user.id,
      sessionTokenHash: sessionModule.hashPublicSessionToken("expired_public_session"),
      authMode: "password",
      expiresAt: new Date(now - 60_000),
      revokedAt: null,
      user,
    },
    {
      id: "auth_session_revoked",
      userId: user.id,
      sessionTokenHash: sessionModule.hashPublicSessionToken("revoked_public_session"),
      authMode: "password",
      expiresAt: new Date(now + 60_000),
      revokedAt: new Date(now),
      user,
    },
  ];

  return {
    authSession: {
      async findFirst({ where, include }) {
        const row =
          rows.find(
            (entry) =>
              entry.sessionTokenHash === where.sessionTokenHash &&
              entry.revokedAt === where.revokedAt &&
              entry.expiresAt > where.expiresAt.gt &&
              entry.authMode === where.authMode,
          ) ?? null;
        if (!row) return null;
        return include?.user ? row : { ...row, user: undefined };
      },
    },
  };
}

function loadSessionModule(db) {
  return loadSessionModuleWithImports({ "@/server/db/client": { prisma: db } });
}

function loadSessionModuleWithoutDb() {
  return loadSessionModuleWithImports({ "@/server/db/client": { prisma: {} } });
}

function loadSessionModuleWithImports(extraImports) {
  const actor = loadTsModule(path.join(root, "src", "server", "auth", "actor.ts"), {});
  return loadTsModule(path.join(root, "src", "server", "auth", "session.ts"), {
    "@/server/auth/local-session": loadTsModule(path.join(root, "src", "server", "auth", "local-session.ts"), {
      "node:crypto": require("node:crypto"),
      "@/server/auth/actor": actor,
    }),
    "@/server/auth/actor": actor,
    "node:crypto": require("node:crypto"),
    ...extraImports,
  });
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
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
    throw new Error(`Unexpected import in public auth session gate test: ${specifier}`);
  };
  new Function("require", "exports", "module", compiled.outputText)(requireShim, module.exports, module);
  return module.exports;
}

