import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtureRoot = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.resolve(process.argv[2]);
const child = spawn(process.execPath, [path.join(fixtureRoot, "child.mjs")], {
  stdio: "ignore",
  shell: false,
  windowsHide: true,
});

writeFileSync(statePath, JSON.stringify({
  parentPid: process.pid,
  childPid: child.pid,
}) + "\n", "utf8");

setInterval(() => {}, 1_000);
