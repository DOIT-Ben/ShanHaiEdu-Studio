import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const manifestPath = "fixtures/ppt-sample-manifest.json";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("PPT prompt and textbook fixtures are stable and manifest-backed", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.fixtures.length, 2);

  const manifestText = JSON.stringify(manifest);
  assert.doesNotMatch(manifestText, /sk-[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(manifestText, /(token|secret|api[_-]?key)\s*=\s*["']?[A-Za-z0-9_\-]{20,}/i);

  for (const fixture of manifest.fixtures) {
    const stats = statSync(fixture.path);
    assert.ok(stats.size > 0, `${fixture.id} should be non-empty`);
    assert.equal(stats.size, fixture.sizeBytes);
    assert.equal(sha256(fixture.path), fixture.sha256);
  }

  const textbook = manifest.fixtures.find((fixture) => fixture.id === "sujiao-grade6-percentage-textbook");
  assert.ok(textbook);
  const header = readFileSync(textbook.path).subarray(0, 4).toString("ascii");
  assert.equal(header, "%PDF");
});
