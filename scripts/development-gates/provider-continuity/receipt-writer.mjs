import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function writeExclusiveJson(target, value) {
  if (existsSync(target)) throw new Error(`Evidence target already exists: ${path.basename(target)}.`);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    if (existsSync(target)) throw new Error(`Evidence target already exists: ${path.basename(target)}.`);
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function sealProviderContinuity({ campaignRoot } = {}) {
  const root = path.resolve(String(campaignRoot ?? ""));
  const capture = path.join(root, "capture");
  const evidence = path.join(root, "evidence");
  if (!existsSync(capture) || !existsSync(evidence)) {
    throw new Error("Provider campaign capture and evidence directories are incomplete.");
  }
  const captureFiles = readdirSync(capture, { withFileTypes: true }).filter((entry) => entry.isFile());
  const evidenceFiles = readdirSync(evidence, { withFileTypes: true }).filter((entry) => entry.isFile());
  if (captureFiles.length === 0 || evidenceFiles.length === 0) {
    throw new Error("Provider campaign capture and evidence are incomplete.");
  }
  throw new Error("Provider campaign cannot be sealed until live authorization and source verification complete.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const campaignIndex = process.argv.indexOf("--campaign-root");
    sealProviderContinuity({ campaignRoot: campaignIndex >= 0 ? process.argv[campaignIndex + 1] : "" });
  } catch (error) {
    console.error(JSON.stringify({ ok: false, passed: false, status: "failed", message: error.message }));
    process.exitCode = 1;
  }
}
