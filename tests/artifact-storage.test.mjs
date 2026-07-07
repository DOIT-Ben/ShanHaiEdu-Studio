import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);
const sourcePath = path.join(root, "src", "server", "artifact-storage", "local-artifact-storage.ts");
const tmpRoot = path.join(root, ".tmp", "artifact-storage-test");
const deployRoot = path.join(root, "test-results", "artifact-storage-root");

test("writes local artifacts to .tmp by default and deployment storage when configured", async () => {
  const storage = loadStorageModule();
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(deployRoot, { recursive: true, force: true });
  mkdirSync(tmpRoot, { recursive: true });
  mkdirSync(deployRoot, { recursive: true });

  const defaultResult = storage.writeLocalArtifact({
    category: "image-artifacts",
    fileName: "default-image.png",
    buffer: Buffer.from("default-image"),
    env: {},
  });

  assert.equal(defaultResult.localOutput, ".tmp/image-artifacts/default-image.png");
  assert.equal(readFileSync(path.join(root, defaultResult.localOutput)).toString("utf8"), "default-image");

  const configuredResult = storage.writeLocalArtifact({
    category: "video-artifacts",
    fileName: "configured-video.mp4",
    buffer: Buffer.from("configured-video"),
    env: { ARTIFACT_STORAGE_ROOT: deployRoot },
  });

  assert.equal(configuredResult.localOutput, "artifact-storage/video-artifacts/configured-video.mp4");
  assert.equal(readFileSync(path.join(deployRoot, "video-artifacts", "configured-video.mp4")).toString("utf8"), "configured-video");
});

test("resolves legacy and configured artifact metadata without allowing path escape", async () => {
  const storage = loadStorageModule();
  rmSync(deployRoot, { recursive: true, force: true });
  mkdirSync(path.join(deployRoot, "coze-ppt-artifacts"), { recursive: true });

  const legacy = storage.resolveLocalArtifactOutput(".tmp/image-artifacts/default-image.png", {});
  assert.equal(legacy, path.join(root, ".tmp", "image-artifacts", "default-image.png"));

  const configured = storage.resolveLocalArtifactOutput("artifact-storage/coze-ppt-artifacts/sample.pptx", {
    ARTIFACT_STORAGE_ROOT: deployRoot,
  });
  assert.equal(configured, path.join(deployRoot, "coze-ppt-artifacts", "sample.pptx"));

  for (const unsafe of [
    "",
    "package.json",
    "/tmp/outside.png",
    "C:/tmp/outside.png",
    ".tmp/../package.json",
    "artifact-storage/../package.json",
    "artifact-storage/video-artifacts/../../package.json",
  ]) {
    assert.equal(storage.resolveLocalArtifactOutput(unsafe, { ARTIFACT_STORAGE_ROOT: deployRoot }), null, unsafe);
  }
});

function loadStorageModule() {
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  const requireShim = (specifier) => {
    if (specifier === "node:fs") return require("node:fs");
    if (specifier === "node:path") return require("node:path");
    throw new Error(`Unexpected import in artifact storage test: ${specifier}`);
  };
  new Function("require", "exports", "module", compiled.outputText)(requireShim, module.exports, module);
  return module.exports;
}
