import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCampaignEvidence } from "../../scripts/development-gates/provider-continuity/evidence-builder.mjs";
import {
  createSignedCaptureIndex,
  PROVIDER_CAPTURE_SIGNATURE_DOMAIN,
} from "../../scripts/development-gates/provider-continuity/capture-signature.mjs";
import { createCampaignWorkspace } from "../../scripts/development-gates/provider-continuity/isolation.mjs";
import {
  ledgerAuthorityPayloadBytes,
  PROVIDER_LEDGER_AUTHORITY_DOMAIN,
} from "../../scripts/development-gates/provider-continuity/ledger-authority-attestation.mjs";
import { validateLivePreflight } from "../../scripts/development-gates/provider-continuity/preflight.mjs";
import { verifyProviderContinuityReceiptV2 } from "../../scripts/development-gates/provider-continuity/receipt-v2.mjs";
import { writeExclusiveJson, sealProviderContinuity } from "../../scripts/development-gates/provider-continuity/receipt-writer.mjs";
import { createScenarioPlan, validateScenarioSequence } from "../../scripts/development-gates/provider-continuity/scenario-runner.mjs";
import {
  loadTrustedCaptureKeys,
  resolveTrustedCaptureKey,
} from "../../scripts/development-gates/provider-continuity/trust-store.mjs";
import { verifyProviderContinuityEvidence } from "../../scripts/development-gates/provider-continuity.mjs";
import { collectGitVerificationSubject } from "../../scripts/development-gates/verification-subject.mjs";

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
    trustedLedgerAuthorityKeyIds: [authorization.ledgerAuthorityKeyId],
    now: new Date("2026-07-18T00:00:00.000Z"),
  };
  assert.throws(() => validateLivePreflight(input), /protected environment|ledger binding/i);
  assert.throws(() => validateLivePreflight({
    ...input,
    requestedAuthorization: { ...input.requestedAuthorization, maxProviderCalls: 99 },
    verifyProtectedEnvironment: () => true,
    verifyLedgerBinding: () => true,
  }), /does not match/i);
  assert.throws(() => validateLivePreflight({
    ...input,
    approvedAuthorization: {
      ...authorization,
      ledgerAuthorityKeyId: authorization.trustedCaptureKeyId,
      ledgerAuthorityPublicKeySha256: authorization.trustedCapturePublicKeySha256,
    },
    verifyProtectedEnvironment: () => true,
    verifyLedgerBinding: () => true,
  }), /must be distinct/i);
  const result = validateLivePreflight({
    ...input,
    verifyProtectedEnvironment: () => true,
    verifyLedgerBinding: () => true,
  });
  assert.equal(result.channel, "primary");
  assert.equal(result.trustedCaptureKeyId, "capture-key-1");
  assert.throws(() => validateLivePreflight({
    ...input,
    now: new Date(authorization.expiresAt),
    verifyProtectedEnvironment: () => true,
    verifyLedgerBinding: () => true,
  }), /expired/i);
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
    ledgerAuthorityKeyId: "ledger-authority-key-1",
    ledgerAuthorityPublicKeySha256: "e".repeat(64),
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
  const authorityKey = generateKeyPairSync("ed25519").publicKey;
  const authorityPublicKeyPem = authorityKey.export({ type: "spki", format: "pem" }).toString();
  const authorityPublicKeySha256 = sha256(authorityPublicKeyPem);
  writeSource(repositoryRoot, "docs/stages/active-stage.json", {
    schemaVersion: "shanhai-active-stage.v1",
    stageId: "p0-05a-provider-continuity-readiness",
    status: "active",
    providerContinuity: {
      requiredReceiptSchema: "shanhai-provider-continuity-receipt.v2",
      trustedCaptureKeyIds: ["capture-key-1"],
      trustedLedgerAuthorityKeyIds: ["ledger-authority-key-1"],
      liveAuthorization: {
        trustedCaptureKeyId: "capture-key-1",
        trustedCapturePublicKeySha256: publicKeySha256,
        ledgerAuthorityKeyId: "ledger-authority-key-1",
        ledgerAuthorityPublicKeySha256: authorityPublicKeySha256,
      },
    },
    expiresOn: "2026-07-24",
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
  const indexBytes = readBytes(path.join(campaignRoot, indexRef.path));
  return {
    repositoryRoot,
    campaignRoot,
    captureRefs,
    sourceIndex: {
      ...indexRef,
      algorithm: "Ed25519",
      domain: PROVIDER_CAPTURE_SIGNATURE_DOMAIN,
      keyId: "capture-key-1",
      signature: sign(null, Buffer.concat([
        Buffer.from(PROVIDER_CAPTURE_SIGNATURE_DOMAIN, "utf8"),
        indexBytes,
      ]), privateKey).toString("base64"),
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
  const relativePath = ".tmp/provider-continuity/evidence/manifest.json";
  const target = path.join(root, ...relativePath.split("/"));
  writeExclusiveJson({ root, relativePath, value: { schemaVersion: "test.v1" } });
  assert.match(readText(target), /test\.v1/);
  assert.throws(() => writeExclusiveJson({
    root,
    relativePath,
    value: { schemaVersion: "test.v2" },
  }), /already exists/i);
  const protectedPath = path.join(root, "protected.json");
  writeFileSync(protectedPath, "keep\n");
  assert.throws(() => writeExclusiveJson({
    root,
    relativePath: protectedPath,
    value: { unsafe: true },
  }), /unsafe|provider-continuity/i);
  assert.equal(readText(protectedPath), "keep\n");
  assert.throws(() => sealProviderContinuity({ campaignRoot: root }), /capture|evidence|incomplete/i);
});

test("receipt writer refuses a continuity parent junction before writing outside", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "shanhai-provider-writer-"));
  const outside = mkdtempSync(path.join(tmpdir(), "shanhai-provider-writer-outside-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  mkdirSync(path.join(root, ".tmp", "provider-continuity"), { recursive: true });
  const linked = path.join(root, ".tmp", "provider-continuity", "evidence");
  try {
    symlinkSync(outside, linked, "junction");
  } catch (error) {
    if (["EPERM", "EACCES", "UNKNOWN"].includes(error.code)) {
      t.skip("This Windows environment does not permit test junctions.");
      return;
    }
    throw error;
  }
  assert.throws(() => writeExclusiveJson({
    root,
    relativePath: ".tmp/provider-continuity/evidence/receipt.json",
    value: { schemaVersion: "test.v1" },
  }), /link|unsafe/i);
  assert.equal(existsSync(path.join(outside, "receipt.json")), false);
});

test("protected signer builds its own deterministic Ed25519 domain-bound source index", (t) => {
  const fixture = createV2Fixture(t, { runCount: 1 });
  const campaign = fixture.campaigns[0];
  assert.equal(campaign.signed.index.schemaVersion, "shanhai-provider-source-index.v2");
  assert.equal(campaign.signed.index.runSequence, 1);
  assert.equal(campaign.signed.signature.algorithm, "Ed25519");
  assert.equal(campaign.signed.signature.domain, PROVIDER_CAPTURE_SIGNATURE_DOMAIN);
  assert.equal(campaign.signed.index.captureFiles.length, campaign.ledgerAuthorityAttestation.payload.attemptCount);
  assert.equal(JSON.stringify(campaign.signed).includes("PRIVATE KEY"), false);

  let signCalled = false;
  assert.throws(() => createSignedCaptureIndex({
    ...campaign.signerInput,
    sourceIndex: { callerControlled: true },
    signBytes: () => {
      signCalled = true;
      return Buffer.alloc(64);
    },
  }), /caller.*index|unexpected input/i);
  assert.equal(signCalled, false);

  assert.throws(() => createSignedCaptureIndex({
    ...campaign.signerInput,
    trustedCaptureKeys: [{ ...fixture.trustedCaptureKeys[0], algorithm: "RSA" }],
  }), /ed25519/i);
  assert.throws(() => createSignedCaptureIndex({
    ...campaign.signerInput,
    signBytes: (bytes) => sign(null, bytes.subarray(Buffer.byteLength(PROVIDER_CAPTURE_SIGNATURE_DOMAIN)), fixture.privateKey),
  }), /signature verification failed/i);
});

test("protected signer binds authorization, verification, ledger, server, and capture attempt facts", async (t) => {
  await t.test("channel mismatch", (subtest) => {
    const fixture = createV2Fixture(subtest, { runCount: 0 });
    const campaign = createV2CampaignFixture(fixture, 1);
    mutateJson(campaign.capturePaths[0], (trace) => { trace.provider.channel = "third"; });
    assert.throws(() => createSignedCaptureIndex(campaign.signerInput), /channel.*authorization/i);
  });

  await t.test("verification subject drift", (subtest) => {
    const fixture = createV2Fixture(subtest, { runCount: 0 });
    const campaign = createV2CampaignFixture(fixture, 1);
    mutateJson(fixture.verificationManifestPath, (manifest) => { manifest.subject.policySha256 = "0".repeat(64); });
    assert.throws(() => createSignedCaptureIndex(campaign.signerInput), /verification.*subject|policy.*sha/i);
  });

  await t.test("incomplete verification check set", (subtest) => {
    const fixture = createV2Fixture(subtest, { runCount: 0 });
    const campaign = createV2CampaignFixture(fixture, 1);
    mutateJson(fixture.verificationManifestPath, (manifest) => {
      manifest.requiredCheckIds.pop();
      manifest.checks.pop();
    });
    assert.throws(() => createSignedCaptureIndex(campaign.signerInput), /verification.*check/i);
  });

  await t.test("ledger attempt omission", (subtest) => {
    const fixture = createV2Fixture(subtest, { runCount: 0 });
    const campaign = createV2CampaignFixture(fixture, 1);
    campaign.signerInput.ledgerAuthorityAttestation.payload.attemptCount -= 1;
    let captureSignCalled = false;
    assert.throws(() => createSignedCaptureIndex({
      ...campaign.signerInput,
      signBytes: () => { captureSignCalled = true; return Buffer.alloc(64); },
    }), /authority.*attempt|authority.*signature/i);
    assert.equal(captureSignCalled, false);
  });

  await t.test("duplicate event, retry, and cost mismatch", (subtest) => {
    const fixture = createV2Fixture(subtest, { runCount: 0 });
    const duplicate = createV2CampaignFixture(fixture, 1);
    const first = readJson(duplicate.capturePaths[0]);
    mutateJson(duplicate.capturePaths[1], (trace) => { trace.eventId = first.eventId; });
    assert.throws(() => createSignedCaptureIndex(duplicate.signerInput), /eventId.*unique/i);

    const retry = createV2CampaignFixture(fixture, 2);
    mutateJson(retry.capturePaths[0], (trace) => { trace.result.retryCount = 1; });
    assert.throws(() => createSignedCaptureIndex(retry.signerInput), /retry/i);

    const cost = createV2CampaignFixture(fixture, 3);
    cost.signerInput.ledgerAuthorityAttestation.payload.totalCostMinorUnits += 1;
    assert.throws(() => createSignedCaptureIndex(cost.signerInput), /authority.*cost/i);
  });
});

test("v2 receipt verifier rebuilds signed campaigns and requires exact one-to-N continuity", async (t) => {
  const fixture = createV2Fixture(t, { runCount: 3 });
  const verified = verifyProviderContinuityReceiptV2(fixture.verifierInput);
  assert.equal(verified.ok, true);
  assert.equal(verified.passed, true);
  assert.equal(verified.consecutiveRuns, 3);
  assert.deepEqual(verified.subject, fixture.subject);
  assert.equal(verified.receiptSha256, sha256(fixture.receiptBytes));

  await t.test("missing and extra runs", () => {
    assert.throws(() => verifyProviderContinuityReceiptV2(
      mutateReceiptInput(fixture, (receipt) => { receipt.runs.pop(); }),
    ), /exactly 3 runs/i);
    assert.throws(() => verifyProviderContinuityReceiptV2({
      ...fixture.verifierInput,
      requiredRuns: 2,
    }), /exactly 2 runs/i);
  });

  await t.test("sequence and server continuity", (subtest) => {
    assert.throws(() => verifyProviderContinuityReceiptV2(
      mutateManifestAndReceiptInput(fixture, (manifest, receipt) => {
        manifest.runs[0].sequence = 2;
        receipt.runs[0].sequence = 2;
      }),
    ), /sequence.*1/i);
    const mixed = createV2Fixture(subtest, { runCount: 3, serverInstanceIds: ["server-a", "server-b", "server-a"] });
    assert.throws(() => verifyProviderContinuityReceiptV2(mixed.verifierInput), /same server/i);
    const replayed = createV2Fixture(subtest, { runCount: 3 });
    const firstNonce = replayed.campaigns[0].ledgerAuthorityAttestation.payload.nonce;
    const replayedCampaign = replayed.campaigns[1];
    replayedCampaign.ledgerAuthorityAttestation.payload.nonce = firstNonce;
    replayedCampaign.ledgerAuthorityAttestation = signLedgerAuthorityAttestation(
      replayed,
      replayedCampaign.ledgerAuthorityAttestation.payload,
    );
    replayedCampaign.signerInput.ledgerAuthorityAttestation = replayedCampaign.ledgerAuthorityAttestation;
    replayedCampaign.signed = createSignedCaptureIndex(replayedCampaign.signerInput);
    writeBytes(path.join(replayedCampaign.campaignRoot, replayedCampaign.signed.sourceIndex.path), replayedCampaign.signed.indexBytes);
    finalizeV2ReceiptFixture(replayed);
    assert.throws(() => verifyProviderContinuityReceiptV2(replayed.verifierInput), /nonce.*unique/i);
  });

  await t.test("receipt digest is computed from the exact verified bytes", () => {
    const changedBytes = Buffer.concat([fixture.receiptBytes, Buffer.from(" \n")]);
    const result = verifyProviderContinuityReceiptV2({ ...fixture.verifierInput, receiptBytes: changedBytes });
    assert.equal(result.receiptSha256, sha256(changedBytes));
    assert.notEqual(result.receiptSha256, verified.receiptSha256);
  });

  await t.test("signed source index references reject unknown fields", () => {
    assert.throws(() => verifyProviderContinuityReceiptV2(
      mutateManifestAndReceiptInput(fixture, (manifest, receipt) => {
        manifest.runs[0].sourceIndex.privateKeyPem = "must-not-survive";
        receipt.runs[0].sourceIndex.privateKeyPem = "must-not-survive";
      }),
    ), /source index reference fields/i);
  });

  await t.test("stale receipt", () => {
    assert.throws(() => verifyProviderContinuityReceiptV2({
      ...fixture.verifierInput,
      now: new Date("2026-07-26T00:00:00.000Z"),
      maxAgeHours: 168,
    }), /expired/i);
  });

  await t.test("authority attestation blocks mutated product scenario facts before capture signing", (subtest) => {
    const invalid = createV2Fixture(subtest, { runCount: 3 });
    const campaign = invalid.campaigns[0];
    mutateJson(path.join(campaign.campaignRoot, "facts", "scenario-2.json"), (facts) => {
      facts.scenario.toolInvocations = [];
    });
    let captureSignCalled = false;
    assert.throws(() => createSignedCaptureIndex({
      ...campaign.signerInput,
      signBytes: () => { captureSignCalled = true; return Buffer.alloc(64); },
    }), /authority attestation does not bind/i);
    assert.equal(captureSignCalled, false);
  });

  await t.test("authoritative sources still must satisfy the product Tool contract", (subtest) => {
    const invalid = createV2Fixture(subtest, { runCount: 3 });
    const campaign = invalid.campaigns[0];
    mutateJson(path.join(campaign.campaignRoot, "facts", "scenario-2.json"), (facts) => {
      facts.scenario.toolInvocations = [];
    });
    const payload = structuredClone(campaign.ledgerAuthorityAttestation.payload);
    payload.factsFiles = payload.factsFiles.map((entry) => ({
      ...entry,
      sha256: sha256File(path.join(campaign.campaignRoot, ...entry.path.split("/"))),
    }));
    campaign.ledgerAuthorityAttestation = signLedgerAuthorityAttestation(invalid, payload);
    campaign.signerInput.ledgerAuthorityAttestation = campaign.ledgerAuthorityAttestation;
    campaign.signed = createSignedCaptureIndex(campaign.signerInput);
    writeBytes(path.join(campaign.campaignRoot, campaign.signed.sourceIndex.path), campaign.signed.indexBytes);
    finalizeV2ReceiptFixture(invalid);
    assert.throws(() => verifyProviderContinuityReceiptV2(invalid.verifierInput), /Tool contract/i);
  });
});

test("main Provider verifier consumes the exact v2 receipt bytes and current Git subject", (t) => {
  const fixture = createV2Fixture(t, { runCount: 3 });
  prepareGitBackedV2Fixture(fixture);
  const exactReceiptBytes = Buffer.concat([fixture.receiptBytes, Buffer.from(" \n")]);
  writeBytes(path.join(fixture.repositoryRoot, ".tmp/provider-continuity/provider-continuity.manifest.json"), fixture.manifestBytes);
  writeBytes(path.join(fixture.repositoryRoot, ".tmp/provider-continuity/provider-continuity.receipt.json"), exactReceiptBytes);

  const verified = verifyProviderContinuityEvidence({
    root: fixture.repositoryRoot,
    mode: "development",
    now: new Date("2026-07-18T00:12:00.000Z"),
  });

  assert.equal(verified.ok, true);
  assert.equal(verified.passed, true);
  assert.equal(verified.consecutiveRuns, 3);
  assert.equal(verified.receiptSha256, sha256(exactReceiptBytes));
  assert.deepEqual(verified.subject, collectGitVerificationSubject(fixture.repositoryRoot));
});

test("capture trust store rejects unsafe paths, private material, unknown keys, and linked parents", (t) => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "shanhai-capture-trust-"));
  const externalRoot = mkdtempSync(path.join(tmpdir(), "shanhai-capture-trust-external-"));
  t.after(() => {
    rmSync(repositoryRoot, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const publicKeySha256 = sha256(publicKeyPem);
  const key = { keyId: "capture-key-1", algorithm: "Ed25519", publicKeyPem, publicKeySha256 };
  const store = { schemaVersion: "shanhai-provider-capture-trust.v1", keys: [key] };
  const storePath = path.join(repositoryRoot, "config", "provider-capture-trust.json");
  writeBytes(storePath, jsonBytes(store));

  assert.equal(loadTrustedCaptureKeys({
    repositoryRoot,
    relativePath: "config/provider-capture-trust.json",
  })[0].keyId, key.keyId);
  for (const relativePath of [
    "../provider-capture-trust.json",
    "config\\provider-capture-trust.json",
    path.resolve(repositoryRoot, "config", "provider-capture-trust.json"),
  ]) {
    assert.throws(() => loadTrustedCaptureKeys({ repositoryRoot, relativePath }), /unsafe/i);
  }

  writeBytes(storePath, jsonBytes({
    ...store,
    keys: [{ ...key, privateKeyPem: "-----BEGIN PRIVATE KEY-----" }],
  }));
  assert.throws(() => loadTrustedCaptureKeys({
    repositoryRoot,
    relativePath: "config/provider-capture-trust.json",
  }), /key entry is invalid/i);
  writeBytes(storePath, jsonBytes({ ...store, privateKeyPem: "must-not-survive" }));
  assert.throws(() => loadTrustedCaptureKeys({
    repositoryRoot,
    relativePath: "config/provider-capture-trust.json",
  }), /contract is invalid/i);

  const stage = {
    schemaVersion: "shanhai-active-stage.v1",
    stageId: "p0-05a-provider-continuity-readiness",
    status: "active",
    providerContinuity: {
      expiresOn: "2026-07-24",
      liveCallsAuthorized: true,
      requiredReceiptSchema: "shanhai-provider-continuity-receipt.v2",
      trustedCaptureKeyIds: ["capture-key-missing"],
      trustedLedgerAuthorityKeyIds: ["ledger-authority-key-1"],
      liveAuthorization: {
        ...approvedAuthorization(),
        trustedCaptureKeyId: "capture-key-missing",
        trustedCapturePublicKeySha256: publicKeySha256,
      },
    },
  };
  assert.throws(() => resolveTrustedCaptureKey({
    stage,
    trustedCaptureKeys: [key],
    keyId: "capture-key-missing",
    now: new Date("2026-07-18T00:00:00.000Z"),
  }), /unknown or duplicated/i);
  const collapsedStage = structuredClone(stage);
  collapsedStage.providerContinuity.trustedCaptureKeyIds = [key.keyId];
  collapsedStage.providerContinuity.trustedLedgerAuthorityKeyIds = [key.keyId];
  collapsedStage.providerContinuity.liveAuthorization.trustedCaptureKeyId = key.keyId;
  collapsedStage.providerContinuity.liveAuthorization.trustedCapturePublicKeySha256 = publicKeySha256;
  collapsedStage.providerContinuity.liveAuthorization.ledgerAuthorityKeyId = key.keyId;
  collapsedStage.providerContinuity.liveAuthorization.ledgerAuthorityPublicKeySha256 = publicKeySha256;
  assert.throws(() => resolveTrustedCaptureKey({
    stage: collapsedStage,
    trustedCaptureKeys: [key],
    keyId: key.keyId,
    now: new Date("2026-07-18T00:00:00.000Z"),
  }), /must be distinct/i);
  const authorizedStage = structuredClone(stage);
  authorizedStage.providerContinuity.trustedCaptureKeyIds = [key.keyId];
  authorizedStage.providerContinuity.liveAuthorization.trustedCaptureKeyId = key.keyId;
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  authorizedStage.providerContinuity.liveAuthorization.trustedCapturePublicKeySha256 = sha256(privateKeyPem);
  assert.throws(() => resolveTrustedCaptureKey({
    stage: authorizedStage,
    trustedCaptureKeys: [{ ...key, publicKeyPem: privateKeyPem, publicKeySha256: sha256(privateKeyPem) }],
    keyId: key.keyId,
    now: new Date("2026-07-18T00:00:00.000Z"),
  }), /exact Ed25519 public contract|public key contract/i);

  const externalConfig = path.join(externalRoot, "config");
  writeBytes(path.join(externalConfig, "provider-capture-trust.json"), jsonBytes(store));
  rmSync(path.join(repositoryRoot, "config"), { recursive: true, force: true });
  symlinkSync(externalConfig, path.join(repositoryRoot, "config"), "junction");
  assert.throws(() => loadTrustedCaptureKeys({
    repositoryRoot,
    relativePath: "config/provider-capture-trust.json",
  }), /link/i);
});

function createV2Fixture(t, { runCount = 3, serverInstanceIds = [] } = {}) {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), "shanhai-provider-v2-"));
  t.after(() => rmSync(repositoryRoot, { recursive: true, force: true }));
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const publicKeySha256 = sha256(publicKeyPem);
  const authorityKeyPair = generateKeyPairSync("ed25519");
  const authorityPublicKeyPem = authorityKeyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const authorityPublicKeySha256 = sha256(authorityPublicKeyPem);
  const ledgerManifestBytes = jsonBytes({ schemaVersion: "provider-ledger-manifest.v1", revision: "ledger-1" });
  writeBytes(path.join(repositoryRoot, "API台账系统", "manifest.json"), ledgerManifestBytes);
  const verificationCheckIds = ["development-gates", "typecheck", "lint", "test", "build"];
  const policy = {
    schemaVersion: "shanhai-development-gates.v1",
    providerContinuity: {
      sensitivePaths: ["scripts/development-gates/provider-continuity/**"],
      manifestPath: ".tmp/provider-continuity/provider-continuity.manifest.json",
      receiptPath: ".tmp/provider-continuity/provider-continuity.receipt.json",
      evidenceRoot: ".tmp/provider-continuity/evidence",
      trustStorePath: "config/provider-capture-trust.json",
      maxAgeHours: 168,
      developmentConsecutiveRuns: 3,
      releaseConsecutiveRuns: 5,
      forbiddenModes: ["mock", "fallback", "degraded", "placeholder"],
      requiredScenarios: [
        "ambiguous-discussion",
        "single-requirement-spec",
        "requirement-spec-and-ppt-outline",
        "main-agent-continuation",
      ].map((id) => ({ id })),
    },
    verification: {
      maxAgeHours: 24,
      requiredChecks: verificationCheckIds.map((id) => ({ id, program: "node", args: [id] })),
    },
  };
  const policyPath = path.join(repositoryRoot, "config", "development-gates.json");
  writeBytes(policyPath, jsonBytes(policy));
  const stage = {
    schemaVersion: "shanhai-active-stage.v1",
    stageId: "p0-05a-provider-continuity-readiness",
    status: "active",
    providerContinuity: {
      expiresOn: "2026-07-24",
      liveCallsAuthorized: true,
      requiredReceiptSchema: "shanhai-provider-continuity-receipt.v2",
      trustedCaptureKeyIds: ["capture-key-1"],
      trustedLedgerAuthorityKeyIds: ["ledger-authority-key-1"],
      liveAuthorization: {
        ...approvedAuthorization(),
        modelFingerprint: "a".repeat(64),
        providerLedgerManifestSha256: sha256(ledgerManifestBytes),
        trustedCapturePublicKeySha256: publicKeySha256,
        ledgerAuthorityPublicKeySha256: authorityPublicKeySha256,
      },
    },
  };
  const stagePath = path.join(repositoryRoot, "docs", "stages", "active-stage.json");
  writeBytes(stagePath, jsonBytes(stage));
  const subject = {
    headSha: "1".repeat(40),
    treeSha: "2".repeat(40),
    workingTreeDigest: "3".repeat(64),
    dirty: false,
    policySha256: sha256File(policyPath),
    stageSha256: sha256File(stagePath),
  };
  const verificationManifestPath = path.join(repositoryRoot, ".tmp", "verification", "development-verification.json");
  const verificationManifest = {
    schemaVersion: "shanhai-development-verification.v1",
    createdAt: "2026-07-18T00:00:00.000Z",
    subject,
    requiredCheckIds: verificationCheckIds,
    checks: verificationCheckIds.map((id) => ({
      id,
      exitCode: 0,
      durationMs: 1,
      outputSha256: "4".repeat(64),
    })),
  };
  writeBytes(verificationManifestPath, jsonBytes(verificationManifest));
  const trustedCaptureKeys = [{
    keyId: "capture-key-1",
    algorithm: "Ed25519",
    publicKeyPem,
    publicKeySha256,
  }, {
    keyId: "ledger-authority-key-1",
    algorithm: "Ed25519",
    publicKeyPem: authorityPublicKeyPem,
    publicKeySha256: authorityPublicKeySha256,
  }];
  writeBytes(path.join(repositoryRoot, "config", "provider-capture-trust.json"), jsonBytes({
    schemaVersion: "shanhai-provider-capture-trust.v1",
    keys: trustedCaptureKeys,
  }));
  const fixture = {
    repositoryRoot,
    privateKey,
    authorityPrivateKey: authorityKeyPair.privateKey,
    ledgerManifestBytes,
    stage,
    stagePath,
    policyPath,
    subject,
    verificationManifestPath,
    trustedCaptureKeys,
    serverInstanceIds,
    campaigns: [],
  };
  for (let sequence = 1; sequence <= runCount; sequence += 1) {
    fixture.campaigns.push(createV2CampaignFixture(fixture, sequence));
  }
  if (runCount > 0) finalizeV2ReceiptFixture(fixture);
  return fixture;
}

function createV2CampaignFixture(fixture, sequence) {
  const campaignId = `campaign-${sequence}`;
  const campaignRoot = path.join(fixture.repositoryRoot, ".tmp", "provider-continuity", "campaigns", campaignId);
  mkdirSync(path.join(campaignRoot, "capture"), { recursive: true });
  mkdirSync(path.join(campaignRoot, "facts"), { recursive: true });
  const scenarios = [
    scenarioFact("ambiguous-discussion", `a${sequence}`, true),
    scenarioFact("single-requirement-spec", `b${sequence}`, true),
    scenarioFact("requirement-spec-and-ppt-outline", `c${sequence}`, true),
    scenarioFact("main-agent-continuation", `c${sequence}`, false),
  ];
  const factsFiles = scenarios.map((scenario, index) => writeSource(campaignRoot, `facts/scenario-${index + 1}.json`, {
    schemaVersion: "shanhai-provider-scenario-facts.v1",
    scenario,
  }));
  const calls = [
    [scenarios[0], 1, "initial", scenarios[0].taskId],
    [scenarios[1], 1, "initial", scenarios[1].taskId],
    [scenarios[1], 2, "tool", scenarios[1].taskId],
    [scenarios[1], 3, "post_tool", scenarios[1].taskId],
    [scenarios[2], 1, "intake", `conversation-turn:${scenarios[2].teacherMessageId}`],
    [scenarios[2], 2, "initial", scenarios[2].taskId],
    [scenarios[2], 3, "tool", scenarios[2].taskId],
    [scenarios[2], 4, "tool", scenarios[2].taskId],
    [scenarios[3], 5, "post_tool", scenarios[3].taskId],
  ];
  const attempts = calls.map(([scenario, ordinal, phase, taskId], index) => {
    const eventId = `event-${sequence}-${index + 1}`;
    const reference = writeSource(campaignRoot, `capture/call-${index + 1}.json`,
      providerTrace({ campaignId, scenario, ordinal, phase, taskId, eventId, index }));
    return { ...reference, eventId, costMinorUnits: 1 };
  });
  const authorityPayload = {
    schemaVersion: "shanhai-provider-ledger-authority-attestation.v1",
    campaignId,
    runSequence: sequence,
    serverInstanceId: fixture.serverInstanceIds[sequence - 1] ?? "server-1",
    nonce: `nonce-${sequence}`,
    issuedAt: "2026-07-18T00:04:00.000Z",
    protectedEnvironment: "provider-continuity-prod-1",
    providerLedgerManifestSha256: sha256(fixture.ledgerManifestBytes),
    attemptCount: attempts.length,
    attempts,
    totalCostMinorUnits: attempts.length,
    factsFiles,
  };
  const ledgerAuthorityAttestation = signLedgerAuthorityAttestation(fixture, authorityPayload);
  const signerInput = {
    repositoryRoot: fixture.repositoryRoot,
    campaignRoot,
    runSequence: sequence,
    trustedCaptureKeys: fixture.trustedCaptureKeys,
    ledgerAuthorityAttestation,
    now: new Date("2026-07-18T00:05:00.000Z"),
    signBytes: (bytes) => sign(null, bytes, fixture.privateKey),
  };
  const signed = createSignedCaptureIndex(signerInput);
  writeBytes(path.join(campaignRoot, signed.sourceIndex.path), signed.indexBytes);
  return {
    campaignId,
    campaignRoot,
    capturePaths: attempts.map((entry) => path.join(campaignRoot, ...entry.path.split("/"))),
    ledgerAuthorityAttestation,
    signerInput,
    signed,
  };
}

function signLedgerAuthorityAttestation(fixture, payload) {
  return {
    payload,
    signature: {
      algorithm: "Ed25519",
      domain: PROVIDER_LEDGER_AUTHORITY_DOMAIN,
      keyId: "ledger-authority-key-1",
      signature: sign(null, Buffer.concat([
        Buffer.from(PROVIDER_LEDGER_AUTHORITY_DOMAIN, "utf8"),
        ledgerAuthorityPayloadBytes(payload),
      ]), fixture.authorityPrivateKey).toString("base64"),
    },
  };
}

function finalizeV2ReceiptFixture(fixture) {
  const first = fixture.campaigns[0].signed.index;
  const runs = fixture.campaigns.map((campaign) => ({
    sequence: campaign.signed.index.runSequence,
    campaignId: campaign.campaignId,
    sourceIndex: campaign.signed.sourceIndex,
  }));
  const manifest = {
    schemaVersion: "shanhai-provider-continuity-manifest.v2",
    generatedAt: "2026-07-18T00:10:00.000Z",
    mode: "development",
    subject: fixture.subject,
    binding: first.binding,
    runs,
  };
  const manifestBytes = jsonBytes(manifest);
  const receipt = {
    schemaVersion: "shanhai-provider-continuity-receipt.v2",
    verifiedAt: "2026-07-18T00:11:00.000Z",
    mode: "development",
    manifestSha256: sha256(manifestBytes),
    subject: fixture.subject,
    runs,
  };
  const receiptBytes = jsonBytes(receipt);
  fixture.manifestBytes = manifestBytes;
  fixture.receiptBytes = receiptBytes;
  fixture.verifierInput = {
    repositoryRoot: fixture.repositoryRoot,
    manifestBytes,
    receiptBytes,
    requiredRuns: fixture.campaigns.length,
    trustedCaptureKeys: fixture.trustedCaptureKeys,
    now: new Date("2026-07-18T00:12:00.000Z"),
    maxAgeHours: 168,
  };
}

function prepareGitBackedV2Fixture(fixture) {
  writeBytes(path.join(fixture.repositoryRoot, ".gitignore"), Buffer.from(".tmp/\n", "utf8"));
  git(fixture.repositoryRoot, "init", "--quiet");
  git(fixture.repositoryRoot, "config", "user.email", "provider-v2@example.invalid");
  git(fixture.repositoryRoot, "config", "user.name", "Provider V2 Test");
  git(fixture.repositoryRoot, "add", ".");
  git(fixture.repositoryRoot, "commit", "--quiet", "-m", "fixture");
  fixture.subject = collectGitVerificationSubject(fixture.repositoryRoot);
  mutateJson(fixture.verificationManifestPath, (manifest) => { manifest.subject = fixture.subject; });
  for (const campaign of fixture.campaigns) {
    campaign.signed = createSignedCaptureIndex(campaign.signerInput);
    writeBytes(path.join(campaign.campaignRoot, campaign.signed.sourceIndex.path), campaign.signed.indexBytes);
  }
  finalizeV2ReceiptFixture(fixture);
}

function providerTrace({ campaignId, scenario, ordinal, phase, taskId, eventId, index }) {
  const sequence = Number.parseInt(campaignId.split("-").at(-1) ?? "1", 10);
  const started = Date.parse("2026-07-18T00:01:00.000Z") + (sequence - 1) * 60_000 + index * 1000;
  return {
    schemaVersion: "shanhai-provider-call-trace.v1",
    eventId,
    campaignId,
    recordedAt: new Date(started + 500).toISOString(),
    context: {
      projectId: scenario.projectId,
      taskId,
      teacherMessageId: scenario.teacherMessageId,
      turnJobId: scenario.turnJobId,
    },
    continuity: { callOrdinal: ordinal, phase },
    provider: { kind: "openai_responses", mode: "real-provider", channel: "primary", modelFingerprint: "a".repeat(64) },
    timing: { startedAt: new Date(started).toISOString(), completedAt: new Date(started + 400).toISOString(), durationMs: 400 },
    result: {
      outcome: "succeeded",
      httpStatus: 200,
      timeout: false,
      requestIdDigest: "5".repeat(64),
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cachedTokens: 0, cacheWriteTokens: 0 },
      retryCount: 0,
      errorCategory: "none",
    },
  };
}

function mutateReceiptInput(fixture, mutate) {
  const receipt = JSON.parse(fixture.receiptBytes.toString("utf8"));
  mutate(receipt);
  return { ...fixture.verifierInput, receiptBytes: jsonBytes(receipt) };
}

function mutateManifestAndReceiptInput(fixture, mutate) {
  const manifest = JSON.parse(fixture.manifestBytes.toString("utf8"));
  const receipt = JSON.parse(fixture.receiptBytes.toString("utf8"));
  mutate(manifest, receipt);
  const manifestBytes = jsonBytes(manifest);
  receipt.manifestSha256 = sha256(manifestBytes);
  return { ...fixture.verifierInput, manifestBytes, receiptBytes: jsonBytes(receipt) };
}

function mutateJson(target, mutate) {
  const value = readJson(target);
  mutate(value);
  writeBytes(target, jsonBytes(value));
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeBytes(target, bytes) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(target) {
  return sha256(readBytes(target));
}

function readBytes(target) {
  return readFileSync(target);
}

function readText(target) {
  return readBytes(target).toString("utf8");
}

function readJson(target) {
  return JSON.parse(readText(target));
}

function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
