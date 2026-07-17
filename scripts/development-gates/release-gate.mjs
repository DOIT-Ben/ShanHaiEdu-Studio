import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { collectGitSubject, executeCommand } from "./run-verification.mjs";

const releaseCommands = [
  { id: "production-preflight", program: "npm", args: ["run", "preflight:production"] },
  { id: "desktop-smoke", program: "npm", args: ["run", "desktop:smoke"] },
];

export async function runReleaseGate({ subject, verifyManifest, verifyProvider, runCommand } = {}) {
  if (!subject || subject.dirty !== false) throw new Error("Release gate requires a clean candidate.");
  if (typeof verifyManifest !== "function" || typeof verifyProvider !== "function" || typeof runCommand !== "function") {
    throw new Error("Release gate verifiers are required.");
  }
  await verifyManifest();
  const provider = await verifyProvider();
  for (const command of releaseCommands) {
    const result = await runCommand(command);
    if (!result || result.exitCode !== 0) throw new Error(`Release command ${command.id} failed.`);
  }
  return { ok: true, providerConsecutiveRuns: provider.consecutiveRuns };
}

async function runCli() {
  const root = process.cwd();
  const policy = JSON.parse(readFileSync(path.join(root, "config", "development-gates.json"), "utf8"));
  const subject = await collectGitSubject(root);
  const manifest = JSON.parse(readFileSync(path.join(root, ...policy.verification.manifestPath.split("/")), "utf8"));
  const { verifyVerificationManifest } = await import("./verification-manifest.mjs");
  const { verifyProviderContinuityEvidence } = await import("./provider-continuity.mjs");

  const result = await runReleaseGate({
    subject,
    verifyManifest: () => verifyVerificationManifest(manifest, {
      subject,
      requiredChecks: policy.verification.requiredChecks,
      maxAgeHours: policy.verification.maxAgeHours,
    }),
    verifyProvider: () => verifyProviderContinuityEvidence({ root, policy, subject, mode: "release" }),
    runCommand: (command) => executeCommand(command, root),
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(() => {
    console.error(JSON.stringify({ ok: false, error: "Release gate failed." }));
    process.exit(2);
  });
}
