import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("V1-9R4 keeps the stage rail within a narrow viewport without hiding the active stage", () => {
  const source = readFileSync("src/components/conversation/StageProgress.tsx", "utf8");

  assert.match(source, /min-w-\[42px\] sm:min-w-\[108px\]/);
  assert.match(source, /!compact && !active && "hidden sm:block"/);
  assert.match(source, /aria-label=\{`第 \$\{index \+ 1\} 步：\$\{stage\}`\}/);
});
