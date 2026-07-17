import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_VERIFICATION_MANIFEST_PATH,
  createVerificationManifest,
  verifyVerificationManifest,
} from "../../scripts/development-gates/verification-manifest.mjs";

test("verification manifest is created only from the complete successful check set", () => {
  const manifest = createVerificationManifest({
    subject: verificationSubject(),
    requiredChecks: requiredChecks(),
    checks: passingChecks(),
    createdAt: "2026-07-17T08:00:00.000Z",
  });

  assert.equal(DEFAULT_VERIFICATION_MANIFEST_PATH, ".tmp/verification/development-verification.json");
  assert.deepEqual(manifest.requiredCheckIds, ["gate", "test"]);
  assert.deepEqual(manifest.checks.map((entry) => entry.id), ["gate", "test"]);
  assert.equal(manifest.subject.workingTreeDigest, "d".repeat(64));

  assert.throws(() => createVerificationManifest({
    subject: verificationSubject(),
    requiredChecks: requiredChecks(),
    checks: passingChecks().slice(0, 1),
  }), /missing.*test/i);

  const failed = passingChecks();
  failed[1].exitCode = 1;
  assert.throws(() => createVerificationManifest({
    subject: verificationSubject(),
    requiredChecks: requiredChecks(),
    checks: failed,
  }), /test.*failed/i);
});

test("verification manifest rejects duplicate, unknown, and malformed checks", () => {
  assert.throws(() => createVerificationManifest({
    subject: verificationSubject(),
    requiredChecks: requiredChecks(),
    checks: [passingChecks()[0], passingChecks()[0], passingChecks()[1]],
  }), /duplicate.*gate/i);

  assert.throws(() => createVerificationManifest({
    subject: verificationSubject(),
    requiredChecks: requiredChecks(),
    checks: [...passingChecks(), { id: "extra", exitCode: 0, durationMs: 1, outputSha256: "9".repeat(64) }],
  }), /unexpected.*extra/i);

  const malformed = passingChecks();
  malformed[0].outputSha256 = "not-a-digest";
  assert.throws(() => createVerificationManifest({
    subject: verificationSubject(),
    requiredChecks: requiredChecks(),
    checks: malformed,
  }), /outputSha256/i);
});

test("verification rejects any subject binding or check-set tampering", () => {
  const expected = {
    subject: verificationSubject(),
    requiredChecks: requiredChecks(),
    maxAgeHours: 24,
    now: "2026-07-17T09:00:00.000Z",
  };
  const manifest = createVerificationManifest({
    subject: expected.subject,
    requiredChecks: expected.requiredChecks,
    checks: passingChecks(),
    createdAt: "2026-07-17T08:00:00.000Z",
  });
  assert.equal(verifyVerificationManifest(manifest, expected).ok, true);

  for (const field of ["headSha", "treeSha", "workingTreeDigest", "policySha256", "stageSha256"]) {
    const tampered = structuredClone(manifest);
    tampered.subject[field] = field.endsWith("Sha") ? "1".repeat(40) : "1".repeat(64);
    assert.throws(() => verifyVerificationManifest(tampered, expected), new RegExp(field, "i"));
  }

  const reordered = structuredClone(manifest);
  reordered.requiredCheckIds.reverse();
  assert.throws(() => verifyVerificationManifest(reordered, expected), /required check.*mismatch/i);
});

test("verification rejects expired manifests and dirty-state drift", () => {
  const subject = verificationSubject();
  const manifest = createVerificationManifest({
    subject,
    requiredChecks: requiredChecks(),
    checks: passingChecks(),
    createdAt: "2026-07-15T08:00:00.000Z",
  });
  assert.throws(() => verifyVerificationManifest(manifest, {
    subject,
    requiredChecks: requiredChecks(),
    maxAgeHours: 24,
    now: "2026-07-17T09:00:00.000Z",
  }), /expired/i);

  const current = createVerificationManifest({
    subject,
    requiredChecks: requiredChecks(),
    checks: passingChecks(),
    createdAt: "2026-07-17T08:00:00.000Z",
  });
  assert.throws(() => verifyVerificationManifest(current, {
    subject: { ...subject, dirty: false },
    requiredChecks: requiredChecks(),
  }), /dirty/i);
});

function requiredChecks() {
  return [{ id: "gate" }, { id: "test" }];
}

function passingChecks() {
  return [
    { id: "gate", exitCode: 0, durationMs: 10, outputSha256: "a".repeat(64) },
    { id: "test", exitCode: 0, durationMs: 20, outputSha256: "b".repeat(64) },
  ];
}

function verificationSubject() {
  return {
    headSha: "b".repeat(40),
    treeSha: "c".repeat(40),
    workingTreeDigest: "d".repeat(64),
    dirty: true,
    policySha256: "e".repeat(64),
    stageSha256: "f".repeat(64),
  };
}
