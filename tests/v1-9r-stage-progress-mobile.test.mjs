import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("V1-9R4 retires the fixed stage rail in favor of the real activity timeline", () => {
  const source = readFileSync("src/components/conversation/ConversationWorkbench.tsx", "utf8");

  assert.equal(existsSync("src/components/conversation/StageProgress.tsx"), false);
  assert.doesNotMatch(source, /StageProgress|deriveWorkbenchStageIndex/);
});
