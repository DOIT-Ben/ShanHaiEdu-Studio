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

function loadCsrfModule() {
  return loadTsModule(path.join(root, "src", "server", "auth", "csrf.ts"), {
    "node:crypto": require("node:crypto"),
    "@/server/auth/actor": loadTsModule(path.join(root, "src", "server", "auth", "actor.ts"), {}),
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
