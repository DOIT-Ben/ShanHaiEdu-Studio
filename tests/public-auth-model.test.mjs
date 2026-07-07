import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);

test("workbench actor model distinguishes local and public authentication modes", () => {
  const actor = loadTsModule(path.join(root, "src", "server", "auth", "actor.ts"), {});

  const localActor = actor.createWorkbenchActor({
    userId: "local-user-a",
    displayName: "本地教师",
    authMode: "local",
  });
  assert.equal(localActor.authMode, "local");
  assert.equal(localActor.role, "teacher");
  assert.equal(localActor.isAdmin, false);

  const adminActor = actor.createWorkbenchActor({
    userId: "admin-user-a",
    displayName: "管理员",
    authMode: "password",
    role: "admin",
  });
  assert.equal(adminActor.authMode, "password");
  assert.equal(adminActor.isAdmin, true);
});

test("public session cookie is opaque and separate from the local user cookie", () => {
  const session = loadTsModule(path.join(root, "src", "server", "auth", "session.ts"), {
    "@/server/auth/local-session": loadTsModule(path.join(root, "src", "server", "auth", "local-session.ts"), {
      "node:crypto": require("node:crypto"),
      "@/server/auth/actor": loadTsModule(path.join(root, "src", "server", "auth", "actor.ts"), {}),
    }),
    "@/server/auth/actor": loadTsModule(path.join(root, "src", "server", "auth", "actor.ts"), {}),
    "@/server/db/client": { prisma: {} },
    "node:crypto": require("node:crypto"),
  });

  assert.equal(session.publicWorkbenchSessionCookieName, "shanhai_session");
  assert.notEqual(session.publicWorkbenchSessionCookieName, "shanhai_local_user");

  const header = session.createPublicSessionSetCookieHeader(
    { id: "session_12345678", expiresAt: new Date(Date.now() + 60000) },
    new Request("https://localhost/api/workbench/projects"),
  );
  assert.match(header, /^shanhai_session=session_12345678;/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Secure/);
  assert.doesNotMatch(header, /local-user/);
});

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
    throw new Error(`Unexpected import in public auth model test: ${specifier}`);
  };
  new Function("require", "exports", "module", compiled.outputText)(requireShim, module.exports, module);
  return module.exports;
}
