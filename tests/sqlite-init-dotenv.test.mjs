import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("SQLite init script loads DATABASE_URL from local dotenv", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "shanhai-db-init-"));
  writeFileSync(path.join(cwd, ".env"), "DATABASE_URL=file:./data/preflight.db\n");

  const result = spawnSync(process.execPath, [path.join(process.cwd(), "scripts", "init-sqlite-schema.mjs")], {
    cwd,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      COMSPEC: process.env.COMSPEC,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"ok":true/);
  assert.match(result.stdout, /data\/preflight\.db|data\\\\preflight\.db/);
});
