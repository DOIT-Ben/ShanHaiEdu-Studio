import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCampaignWorkspace } from "./isolation.mjs";
import { validateLivePreflight } from "./preflight.mjs";

export function runLivePreflight({
  root = process.cwd(),
  stage,
  options,
  verifyProtectedEnvironment,
  verifyLedgerBinding,
  now,
} = {}) {
  const authorization = validateLivePreflight({
    liveCallsAuthorized: stage?.providerContinuity?.liveCallsAuthorized,
    approvedAuthorization: stage?.providerContinuity?.liveAuthorization,
    trustedCaptureKeyIds: stage?.providerContinuity?.trustedCaptureKeyIds,
    requestedAuthorization: {
      channel: options.channel,
      modelFingerprint: options.modelFingerprint,
      budgetAuthorizationSha256: options.budgetAuthorizationSha256,
      maxProviderCalls: options.maxProviderCalls,
      maxCostMinorUnits: options.maxCostMinorUnits,
    },
    verifyProtectedEnvironment,
    verifyLedgerBinding,
    now,
  });
  const workspace = createCampaignWorkspace({ root, campaignId: options.campaignId });
  return { ok: true, passed: false, status: "preflight-ready", authorization, workspace };
}

function parseArgs(argv) {
  const result = { preflightOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--preflight-only") result.preflightOnly = true;
    else if (arg === "--campaign-id") result.campaignId = argv[++index];
    else if (arg === "--channel") result.channel = argv[++index];
    else if (arg === "--model-fingerprint") result.modelFingerprint = argv[++index];
    else if (arg === "--budget-authorization-sha256") result.budgetAuthorizationSha256 = argv[++index];
    else if (arg === "--max-provider-calls") result.maxProviderCalls = Number.parseInt(argv[++index], 10);
    else if (arg === "--max-cost-minor-units") result.maxCostMinorUnits = Number.parseInt(argv[++index], 10);
    else if (arg === "--mode") result.mode = argv[++index];
    else throw new Error(`Unknown live Provider argument: ${arg}.`);
  }
  if (result.mode !== "development") throw new Error("Provider live runner only supports development mode.");
  if (!result.preflightOnly) throw new Error("Live execution is not enabled; use --preflight-only.");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const root = process.cwd();
    const stage = JSON.parse(readFileSync(path.join(root, "docs", "stages", "active-stage.json"), "utf8"));
    const result = runLivePreflight({ root, stage, options: parseArgs(process.argv.slice(2)) });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, passed: false, status: "failed", message: error.message }));
    process.exitCode = 1;
  }
}
