import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("V1-9R4 refreshes the authoritative project snapshot after an intensity version conflict", () => {
  const source = readFileSync("src/hooks/useWorkbenchController.ts", "utf8");
  const start = source.indexOf("async function updateGenerationIntensity");
  const section = source.slice(start);

  assert.match(section, /status === 409/);
  assert.match(section, /await sync\.loadProject\(activeProject\.id\)/);
});
