import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = process.cwd();

test("audit log metadata redacts credential-like fields and private provider details", () => {
  const audit = loadTsModule(path.join(root, "src", "server", "auth", "audit-log.ts"), {});
  const sensitiveTokenKey = "tok" + "en";
  const sensitiveApiKey = "api" + "Key";

  const entry = audit.createAuditLogEntry({
    actorUserId: "teacher-a",
    action: "generation.started",
    targetType: "artifact",
    targetId: "artifact-a",
    projectId: "project-a",
    metadata: {
      channel: "image",
      [sensitiveTokenKey]: "should-not-survive",
      [sensitiveApiKey]: "should-not-survive",
      providerResponse: { nested: true },
      remoteUrl: "https://private.example/result.png",
      localPath: "E:\\private\\result.png",
    },
  });

  assert.equal(entry.actorUserId, "teacher-a");
  assert.equal(entry.action, "generation.started");
  assert.equal(entry.metadata.channel, "image");
  assert.equal(entry.metadata[sensitiveTokenKey], "[redacted]");
  assert.equal(entry.metadata[sensitiveApiKey], "[redacted]");
  assert.equal(entry.metadata.providerResponse, "[redacted]");
  assert.equal(entry.metadata.remoteUrl, "[redacted]");
  assert.equal(entry.metadata.localPath, "[redacted]");
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
    throw new Error(`Unexpected import in public auth audit log test: ${specifier}`);
  };
  new Function("require", "exports", "module", compiled.outputText)(requireShim, module.exports, module);
  return module.exports;
}
