import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);
const sourcePath = path.join(root, "src", "server", "auth", "local-session.ts");

test("creates a local actor and httpOnly session cookie when the request has no session", () => {
  const session = loadLocalSessionModule();
  const resolved = session.resolveLocalWorkbenchActor(new Request("http://localhost/api/workbench/projects"), {
    generateUserId: () => "local-user-a",
  });

  assert.equal(resolved.actor.userId, "local-user-a");
  assert.equal(resolved.actor.role, "teacher");
  assert.equal(resolved.isNewSession, true);

  const header = session.createLocalSessionSetCookieHeader(resolved);
  assert.match(header, /^shanhai_local_user=local-user-a;/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Path=\//);
});

test("reuses a valid local session cookie and replaces an unsafe one", () => {
  const session = loadLocalSessionModule();
  const reused = session.resolveLocalWorkbenchActor(
    new Request("http://localhost/api/workbench/projects", {
      headers: { cookie: "theme=light; shanhai_local_user=local-user-b; other=1" },
    }),
    { generateUserId: () => "should-not-be-used" },
  );

  assert.equal(reused.actor.userId, "local-user-b");
  assert.equal(reused.isNewSession, false);

  const replaced = session.resolveLocalWorkbenchActor(
    new Request("http://localhost/api/workbench/projects", {
      headers: { cookie: "shanhai_local_user=../outside" },
    }),
    { generateUserId: () => "local-user-c" },
  );

  assert.equal(replaced.actor.userId, "local-user-c");
  assert.equal(replaced.isNewSession, true);
});

function loadLocalSessionModule() {
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  const requireShim = (specifier) => {
    if (specifier === "node:crypto") return require("node:crypto");
    throw new Error(`Unexpected import in local session test: ${specifier}`);
  };
  new Function("require", "exports", "module", compiled.outputText)(requireShim, module.exports, module);
  return module.exports;
}
