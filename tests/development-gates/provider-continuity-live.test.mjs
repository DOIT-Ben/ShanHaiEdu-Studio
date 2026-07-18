import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCampaignEvidence } from "../../scripts/development-gates/provider-continuity/evidence-builder.mjs";
import { createCampaignWorkspace } from "../../scripts/development-gates/provider-continuity/isolation.mjs";
import { validateLivePreflight } from "../../scripts/development-gates/provider-continuity/preflight.mjs";
import { writeExclusiveJson, sealProviderContinuity } from "../../scripts/development-gates/provider-continuity/receipt-writer.mjs";
import { createScenarioPlan, validateScenarioSequence } from "../../scripts/development-gates/provider-continuity/scenario-runner.mjs";

test("live preflight fails before startup when explicit Provider authorization is incomplete", () => {
  let started = false;
  assert.throws(() => validateLivePreflight({
    liveCallsAuthorized: false,
    channel: "",
    modelFingerprint: "",
    budgetAuthorizationSha256: "",
    maxProviderCalls: 0,
    maxCostMinorUnits: 0,
    onAuthorized: () => { started = true; },
  }), /not authorized/i);
  assert.equal(started, false);
});

test("live preflight requires an exact, current stage authorization and authoritative verifiers", () => {
  const authorization = approvedAuthorization();
  const input = {
    liveCallsAuthorized: true,
    approvedAuthorization: authorization,
    requestedAuthorization: {
      channel: authorization.channel,
      modelFingerprint: authorization.modelFingerprint,
      budgetAuthorizationSha256: authorization.budgetAuthorizationSha256,
      maxProviderCalls: authorization.maxProviderCalls,
      maxCostMinorUnits: authorization.maxCostMinorUnits,
    },
    trustedCaptureKeyIds: [authorization.trustedCaptureKeyId],
    now: new Date("2026-07-18T00:00:00.000Z"),
  };
  assert.throws(() => validateLivePreflight(input), /protected environment|ledger binding/i);
  assert.throws(() => validateLivePreflight({
    ...input,
    requestedAuthorization: { ...input.requestedAuthorization, maxProviderCalls: 99 },
    verifyProtectedEnvironment: () => true,
    verifyLedgerBinding: () => true,
  }), /does not match/i);
  const result = validateLivePreflight({
    ...input,
    verifyProtectedEnvironment: () => true,
    verifyLedgerBinding: () => true,
  });
  assert.equal(result.channel, "primary");
  assert.equal(result.trustedCaptureKeyId, "capture-key-1");
});

test("campaign workspace is new, isolated, and cannot traverse a link", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "shanhai-provider-live-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = createCampaignWorkspace({ root, campaignId: "campaign-1" });
  assert.deepEqual(Object.keys(workspace).sort(), [
    "artifacts", "capture", "database", "evidence", "logs", "root",
  ]);
  assert.throws(() => createCampaignWorkspace({ root, campaignId: "campaign-1" }), /already exists/i);

  const outside = mkdtempSync(path.join(tmpdir(), "shanhai-provider-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const campaigns = path.join(root, ".tmp", "provider-continuity", "campaigns");
  mkdirSync(campaigns, { recursive: true });
  try {
    symlinkSync(outside, path.join(campaigns, "linked"), "junction");
  } catch {
    t.skip("This Windows environment does not permit test junctions.");
    return;
  }
  assert.throws(() => createCampaignWorkspace({ root, campaignId: "linked" }), /link|ordinary|exists/i);
});

test("the fourth scenario observes the third turn and never submits a new teacher message", () => {
  const plan = createScenarioPlan();
  assert.equal(plan.length, 4);
  assert.equal(plan[3].submitTeacherMessage, false);
  assert.equal(plan[3].continuationOf, "requirement-spec-and-ppt-outline");

  const facts = plan.map((scenario, index) => ({
    id: scenario.id,
    teacherMessageId: index === 3 ? "message-c" : `message-${index}`,
    turnJobId: index === 3 ? "job-c" : `job-${index}`,
    submittedTeacherMessage: scenario.submitTeacherMessage,
  }));
  facts[2].teacherMessageId = "message-c";
  facts[2].turnJobId = "job-c";
  assert.doesNotThrow(() => validateScenarioSequence(facts));
  assert.throws(() => validateScenarioSequence(facts.map((entry, index) => index === 3
    ? { ...entry, submittedTeacherMessage: true }
    : entry)), /must not submit/i);
});

test("campaign evidence requires a signed exact source index and turn-global Provider ordinals", () => {
  const fixture = createSignedCampaign();
  const evidence = buildCampaignEvidence(fixture);
  assert.equal(evidence.result, "source-verified");
  assert.equal(evidence.scenarios.length, 4);
  assert.deepEqual(evidence.scenarios[2].providerCalls.map((call) => call.callOrdinal), [1, 2, 3, 4]);
  assert.deepEqual(evidence.scenarios[3].providerCalls.map((call) => [call.callOrdinal, call.phase]), [[5, "post_tool"]]);
  assert.throws(() => buildCampaignEvidence({ ...fixture, trustedCaptureKeys: [] }), /not trusted/i);
  assert.throws(() => buildCampaignEvidence({
    ...fixture,
    sourceIndex: {
      ...fixture.sourceIndex,
      signature: `${fixture.sourceIndex.signature.startsWith("A") ? "B" : "A"}${fixture.sourceIndex.signature.slice(1)}`,
    },
  }), /signature verification failed/i);
  const invalidPolicy = createSignedCampaign((scenarios) => {
    scenarios[2].toolInvocations = [];
  });
  assert.throws(() => buildCampaignEvidence(invalidPolicy), /Tool contract/i);
  rmSync(invalidPolicy.repositoryRoot, { recursive: true, force: true });

  writeFileSync(path.join(fixture.campaignRoot, "capture", "omitted-failure.json"), "{}\n", "utf8");
  assert.throws(() => buildCampaignEvidence(fixture), /exact campaign capture file set/i);
  rmSync(path.join(fixture.campaignRoot, "capture", "omitted-failure.json"), { force: true });
  writeFileSync(path.join(fixture.campaignRoot, fixture.captureRefs[0].path), "{}\n", "utf8");
  assert.throws(() => buildCampaignEvidence(fixture), /SHA-256/i);
  rmSync(fixture.repositoryRoot, { recursive: true, force: true });
});

function approvedAuthorization() {
  return {
    channel: "primary",
    modelFingerprint: "a".repeat(64),
    budgetAuthorizationSha256: "b".repeat(64),
    maxProviderCalls: 12,
    maxCostMinorUnits: 1000,
    expiresAt: "2026-07-19T00:00:00.000Z",
    protectedEnvironment: "provider-continuity-prod-1",
    providerLedgerManifestSha256: "c".repeat(64),
    trustedCaptureKeyId: "capture-key-1",
    trustedCapturePublicKeySha256: "d".repeat(64),
  };
}

function writeSource(root, relativePath, value) {
  const target = path.join(root, ...relativePath.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(target, bytes, "utf8");
  return { path: relativePath, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function createSignedCampaign(mutateScenarios = () => {}) {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "shanhai-provider-repository-"));
  const campaignRoot = path.join(repositoryRoot, ".tmp", "provider-continuity", "campaigns", "campaign-1");
  mkdirSync(campaignRoot, { recursive: true });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const publicKeySha256 = createHash("sha256").update(publicKeyPem).digest("hex");
  writeSource(repositoryRoot, "docs/stages/active-stage.json", {
    schemaVersion: "shanhai-active-stage.v1",
    stageId: "p0-05a-provider-continuity-readiness",
    status: "active",
    providerContinuity: {
      requiredReceiptSchema: "shanhai-provider-continuity-receipt.v2",
      trustedCaptureKeyIds: ["capture-key-1"],
      liveAuthorization: {
        trustedCaptureKeyId: "capture-key-1",
        trustedCapturePublicKeySha256: publicKeySha256,
      },
    },
  });
  const scenarios = [
    scenarioFact("ambiguous-discussion", "a", true),
    scenarioFact("single-requirement-spec", "b", true),
    scenarioFact("requirement-spec-and-ppt-outline", "c", true),
    scenarioFact("main-agent-continuation", "c", false),
  ];
  mutateScenarios(scenarios);
  const scenarioRefs = scenarios.map((scenario, index) => writeSource(campaignRoot, `facts/scenario-${index + 1}.json`, {
    schemaVersion: "shanhai-provider-scenario-facts.v1",
    scenario,
  }));
  const captureRefs = [
    writeProviderTrace(campaignRoot, "call-a-1.json", scenarios[0], 1, "initial", scenarios[0].taskId),
    writeProviderTrace(campaignRoot, "call-b-1.json", scenarios[1], 1, "initial", scenarios[1].taskId),
    writeProviderTrace(campaignRoot, "call-b-2.json", scenarios[1], 2, "tool", scenarios[1].taskId),
    writeProviderTrace(campaignRoot, "call-b-3.json", scenarios[1], 3, "post_tool", scenarios[1].taskId),
    writeProviderTrace(campaignRoot, "call-c-1.json", scenarios[2], 1, "intake", `conversation-turn:${scenarios[2].teacherMessageId}`),
    writeProviderTrace(campaignRoot, "call-c-2.json", scenarios[2], 2, "initial", scenarios[2].taskId),
    writeProviderTrace(campaignRoot, "call-c-3.json", scenarios[2], 3, "tool", scenarios[2].taskId),
    writeProviderTrace(campaignRoot, "call-c-4.json", scenarios[2], 4, "tool", scenarios[2].taskId),
    writeProviderTrace(campaignRoot, "call-c-5.json", scenarios[3], 5, "post_tool", scenarios[3].taskId),
  ];
  const sourceIndexValue = {
    schemaVersion: "shanhai-provider-source-index.v2",
    campaignId: path.basename(campaignRoot),
    captureKeyId: "capture-key-1",
    captureFiles: captureRefs.map((entry) => entry.path),
    scenarios: scenarios.map((scenario, index) => ({
      id: scenario.id,
      scenarioFacts: scenarioRefs[index],
      providerCalls: index === 0 ? [captureRefs[0]]
        : index === 1 ? captureRefs.slice(1, 4)
          : index === 2 ? captureRefs.slice(4, 8) : [captureRefs[8]],
    })),
  };
  const indexRef = writeSource(campaignRoot, "source-index.json", sourceIndexValue);
  const indexBytes = readFileSync(path.join(campaignRoot, indexRef.path));
  return {
    repositoryRoot,
    campaignRoot,
    captureRefs,
    sourceIndex: {
      ...indexRef,
      keyId: "capture-key-1",
      signature: sign(null, indexBytes, privateKey).toString("base64"),
    },
    trustedCaptureKeys: [{
      keyId: "capture-key-1",
      publicKeyPem,
      publicKeySha256,
    }],
  };
}

function scenarioFact(id, identity, submittedTeacherMessage) {
  const tools = id === "single-requirement-spec"
    ? ["create_requirement_spec"]
    : id === "requirement-spec-and-ppt-outline"
      ? ["create_requirement_spec", "create_ppt_outline"] : [];
  const artifactCount = id === "single-requirement-spec" ? 1
    : id === "requirement-spec-and-ppt-outline" ? 2 : 0;
  const intentEpochBefore = identity === "c" ? 2 : 1;
  return {
    id,
    teacherMessageId: `message-${identity}`,
    turnJobId: `job-${identity}`,
    projectId: `project-${identity}`,
    taskId: `task-${identity}`,
    intentEpochBefore,
    intentEpochAfter: id === "single-requirement-spec" ? intentEpochBefore + 1 : intentEpochBefore,
    terminalState: "completed",
    submittedTeacherMessage,
    toolInvocations: tools.map((name, index) => ({ name, id: `tool-${identity}-${index + 1}` })),
    observations: [{ id: `observation-${identity}` }],
    artifacts: Array.from({ length: artifactCount }, (_, index) => ({ artifactId: `artifact-${identity}-${index + 1}` })),
  };
}

function writeProviderTrace(root, fileName, scenario, callOrdinal, phase, taskId) {
  return writeSource(root, `capture/${fileName}`, {
    schemaVersion: "shanhai-provider-call-trace.v1",
    campaignId: path.basename(root),
    context: {
      projectId: scenario.projectId,
      taskId,
      teacherMessageId: scenario.teacherMessageId,
      turnJobId: scenario.turnJobId,
    },
    continuity: { callOrdinal, phase },
    provider: { kind: "openai_responses", mode: "real-provider", channel: "primary", modelFingerprint: "c".repeat(64) },
    result: { outcome: "succeeded", httpStatus: 200, timeout: false, errorCategory: "none" },
  });
}

test("receipt files are exclusive and a campaign without complete raw sources cannot be sealed", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "shanhai-provider-seal-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "manifest.json");
  writeExclusiveJson(target, { schemaVersion: "test.v1" });
  assert.match(readFileSync(target, "utf8"), /test\.v1/);
  assert.throws(() => writeExclusiveJson(target, { schemaVersion: "test.v2" }), /already exists/i);
  assert.throws(() => sealProviderContinuity({ campaignRoot: root }), /capture|evidence|incomplete/i);
});
