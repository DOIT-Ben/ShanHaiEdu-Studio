import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);

test("public workbench writes require a valid session-bound csrf token", async () => {
  const { route, csrf } = loadRouteWithFakeDb();
  const previousMode = process.env.SHANHAI_AUTH_MODE;
  process.env.SHANHAI_AUTH_MODE = "password";
  try {
    const withoutToken = await route.withLocalWorkbenchActor(
      publicRequest("POST", { cookie: "shanhai_session=valid_public_session", origin: "https://localhost" }),
      async () => new Response("created", { status: 201 }),
    );
    assert.equal(withoutToken.status, 403);

    const wrongToken = await route.withLocalWorkbenchActor(
      publicRequest("POST", {
        cookie: "shanhai_session=valid_public_session",
        origin: "https://localhost",
        "x-shanhai-csrf": "wrong-token",
      }),
      async () => new Response("created", { status: 201 }),
    );
    assert.equal(wrongToken.status, 403);

    const issued = await csrf.issueCsrfToken({
      sessionId: "auth_session_1",
      userId: "user_password_1",
      expiresAt: new Date(Date.now() + 60_000),
      db: route.__db,
      nonce: "valid-csrf-token",
    });
    const allowed = await route.withLocalWorkbenchActor(
      publicRequest("POST", {
        cookie: "shanhai_session=valid_public_session",
        origin: "https://localhost",
        "x-shanhai-csrf": issued.token,
      }),
      async ({ actor }) => new Response(actor.userId, { status: 201 }),
    );
    assert.equal(allowed.status, 201);
    assert.equal(await allowed.text(), "user_password_1");
  } finally {
    restoreEnv("SHANHAI_AUTH_MODE", previousMode);
  }
});

test("public reads and local writes do not require csrf token", async () => {
  const { route } = loadRouteWithFakeDb();
  const previousMode = process.env.SHANHAI_AUTH_MODE;
  process.env.SHANHAI_AUTH_MODE = "password";
  try {
    const read = await route.withLocalWorkbenchActor(
      publicRequest("GET", { cookie: "shanhai_session=valid_public_session", origin: "https://outside.example" }),
      async () => new Response("ok", { status: 200 }),
    );
    assert.equal(read.status, 200);
  } finally {
    restoreEnv("SHANHAI_AUTH_MODE", previousMode);
  }

  process.env.SHANHAI_AUTH_MODE = "local";
  try {
    const localWrite = await route.withLocalWorkbenchActor(
      new Request("http://localhost/api/workbench/projects", { method: "POST", headers: { origin: "http://localhost" } }),
      async () => new Response("ok", { status: 201 }),
    );
    assert.equal(localWrite.status, 201);
  } finally {
    restoreEnv("SHANHAI_AUTH_MODE", previousMode);
  }
});

function publicRequest(method, headers) {
  return new Request("https://localhost/api/workbench/projects", { method, headers });
}

function loadRouteWithFakeDb() {
  const db = createFakeDb();
  const actor = loadTsModule(path.join(root, "src", "server", "auth", "actor.ts"), {});
  const localSession = loadTsModule(path.join(root, "src", "server", "auth", "local-session.ts"), {
    "node:crypto": require("node:crypto"),
    "@/server/auth/actor": actor,
  });
  const session = loadTsModule(path.join(root, "src", "server", "auth", "session.ts"), {
    "@/server/auth/local-session": localSession,
    "@/server/auth/actor": actor,
    "@/server/db/client": { prisma: db },
    "node:crypto": require("node:crypto"),
  });
  const csrf = loadTsModule(path.join(root, "src", "server", "auth", "csrf.ts"), {
    "@/server/auth/actor": actor,
    "@/server/db/client": { prisma: db },
    "node:crypto": require("node:crypto"),
  });
  const route = loadTsModule(path.join(root, "src", "server", "auth", "workbench-route.ts"), {
    "@/server/auth/local-session": localSession,
    "@/server/auth/session": session,
    "@/server/auth/csrf": csrf,
    "@/server/workbench/service": {
      createWorkbenchService: () => ({}),
    },
    "next/server": nextServerShim(),
  });
  route.__db = db;
  return { route, csrf };
}

function createFakeDb() {
  const sessionHash = hashPublicSessionToken("valid_public_session");
  const rows = [
    {
      id: "auth_session_1",
      userId: "user_password_1",
      sessionTokenHash: sessionHash,
      authMode: "password",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: {
        id: "user_password_1",
        displayName: "王老师",
        role: "teacher",
        authMode: "password",
        memberships: [],
      },
    },
  ];
  const csrfRows = [];
  return {
    csrfRows,
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
        return row && include?.user ? row : row ? { ...row, user: undefined } : null;
      },
    },
    csrfToken: {
      async create({ data }) {
        const row = { id: `csrf_${csrfRows.length + 1}`, ...data, consumedAt: data.consumedAt ?? null, createdAt: new Date() };
        csrfRows.push(row);
        return row;
      },
      async findFirst({ where }) {
        return (
          csrfRows.find(
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

function hashPublicSessionToken(token) {
  return require("node:crypto").createHash("sha256").update(token, "utf8").digest("base64url");
}

function nextServerShim() {
  return {
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status ?? 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  };
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
    throw new Error(`Unexpected import in public auth workbench csrf test: ${specifier}`);
  };
  new Function("require", "exports", "module", compiled.outputText)(requireShim, module.exports, module);
  return module.exports;
}

