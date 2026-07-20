import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

test("V1-9R4 retires the fixed stage rail in favor of the real activity timeline", () => {
  assert.equal(existsSync("src/components/conversation/StageProgress.tsx"), false);
});
