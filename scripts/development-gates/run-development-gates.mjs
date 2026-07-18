import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  detectProviderImpact,
  verifyProviderContinuityEvidence,
} from "./provider-continuity.mjs";
import { evaluateOrchestrationAuditGate } from "./orchestration-audit.mjs";

const staticGates = [
  { id: "policy", script: "policy-ratchet.mjs" },
  { id: "stage-paths", script: "stage-paths.mjs" },
  { id: "source-contracts", script: "source-contracts.mjs" },
  { id: "complexity", script: "complexity.mjs" },
];

export async function runDevelopmentGates({
  root = process.cwd(),
  runSubgate = runStaticSubgate,
  verifyOrchestration = evaluateOrchestrationAuditGate,
  detectImpact = detectProviderImpact,
  verifyProvider = verifyProviderContinuityEvidence,
} = {}) {
  const checks = [];
  for (const definition of staticGates) {
    const result = await runSubgate(definition.id, { root, script: definition.script });
    if (!result || result.ok !== true) throw new Error(`Development subgate ${definition.id} failed.`);
    checks.push({ id: definition.id, ok: true });
  }

  const orchestration = await verifyOrchestration({ root });
  if (!orchestration || orchestration.ok !== true) {
    const detail = Array.isArray(orchestration?.errors) && orchestration.errors.length > 0
      ? ` ${orchestration.errors[0]}`
      : "";
    throw new Error(`Orchestration audit development gate failed.${detail}`);
  }
  checks.push({ id: "orchestration-audit", ok: true });

  const impact = await detectImpact({ root });
  let provider;
  if (impact?.impacted !== true) {
    provider = { ok: true, passed: true, status: "not-required", matchedPaths: [] };
  } else {
    const evidence = await verifyProvider({ root, mode: "development", changedPaths: impact.changedPaths });
    const passed = evidence?.ok === true && evidence?.passed === true && evidence?.status === "passed";
    const exactBootstrap = evidence?.ok === false && evidence?.passed === false &&
      evidence?.status === "deferred_bootstrap";
    const exactCaptureBootstrap = evidence?.ok === false && evidence?.passed === false &&
      evidence?.status === "deferred_capture_bootstrap";
    const exactReadinessImplementation = evidence?.ok === false && evidence?.passed === false &&
      evidence?.status === "deferred_readiness_implementation";
    if (!passed && !exactBootstrap && !exactCaptureBootstrap && !exactReadinessImplementation) {
      throw new Error("Provider continuity development gate failed.");
    }
    provider = evidence;
  }

  return {
    ok: true,
    status: provider.status === "deferred_bootstrap"
      ? "passed-with-bootstrap-defer"
      : provider.status === "deferred_capture_bootstrap"
        ? "passed-with-capture-bootstrap-defer"
        : provider.status === "deferred_readiness_implementation"
          ? "passed-with-readiness-defer"
        : "passed",
    checks,
    provider: {
      ok: provider.ok,
      passed: provider.passed,
      status: provider.status,
      matchedPaths: provider.matchedPaths ?? impact.matchedPaths ?? [],
    },
  };
}

async function runStaticSubgate(id, { root, script }) {
  const scriptPath = path.join(root, "scripts", "development-gates", script);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return { id, ok: result.status === 0 };
}

async function runCli() {
  const result = await runDevelopmentGates();
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(() => {
    console.error(JSON.stringify({ ok: false, error: "Development gates failed." }));
    process.exit(2);
  });
}
