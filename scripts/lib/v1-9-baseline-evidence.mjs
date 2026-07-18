import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { verifyProviderContinuityEvidence } from "../development-gates/provider-continuity.mjs";
import {
  DEFAULT_VERIFICATION_MANIFEST_PATH,
  verifyVerificationManifest,
} from "../development-gates/verification-manifest.mjs";
import { collectGitVerificationSubject } from "../development-gates/verification-subject.mjs";

export function collectV1_9BaselineCandidateEvidence({ cwd, now } = {}) {
  const current = normalizeNow(now);
  try {
    const subject = collectGitVerificationSubject(cwd);
    if (subject.dirty !== false) fail("v1_9_baseline_worktree_dirty");
    const policyBytes = readOrdinaryRelativeFile(
      cwd,
      "config/development-gates.json",
      "v1_9_baseline_policy_invalid",
    );
    const policy = JSON.parse(policyBytes.toString("utf8"));
    const verification = policy?.verification;
    if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
      fail("v1_9_baseline_verification_policy_invalid");
    }
    const verificationManifestPath = safeRelativePath(
      verification.manifestPath ?? DEFAULT_VERIFICATION_MANIFEST_PATH,
      "v1_9_baseline_verification_manifest_invalid",
    );
    const verificationManifestBytes = readOrdinaryRelativeFile(
      cwd,
      verificationManifestPath,
      "v1_9_baseline_verification_manifest_invalid",
    );
    verifyVerificationManifest(JSON.parse(verificationManifestBytes.toString("utf8")), {
      subject,
      requiredChecks: verification.requiredChecks,
      maxAgeHours: verification.maxAgeHours,
      now: current.toISOString(),
    });
    const provider = verifyProviderContinuityEvidence({
      root: cwd,
      mode: "development",
      now: current,
    });
    const verificationManifestSha256 = sha256(verificationManifestBytes);
    if (provider?.passed !== true || provider.status !== "passed" ||
        !/^[a-f0-9]{64}$/.test(provider.receiptSha256 ?? "") ||
        !/^[a-f0-9]{64}$/.test(provider.manifestSha256 ?? "") ||
        !/^[a-f0-9]{64}$/.test(provider.evidenceRootDigest ?? "") ||
        provider.binding?.verificationManifestSha256 !== verificationManifestSha256 ||
        !isDeepStrictEqual(provider.subject, subject)) {
      fail("v1_9_baseline_provider_continuity_invalid");
    }
    return Object.freeze({
      subject: Object.freeze({ ...subject }),
      verificationManifestPath,
      verificationManifestBytes: Buffer.from(verificationManifestBytes),
      verificationManifestSha256,
      providerContinuityManifestSha256: provider.manifestSha256,
      providerContinuityReceiptSha256: provider.receiptSha256,
      providerContinuityEvidenceRootDigest: provider.evidenceRootDigest,
      providerContinuitySubjectDigest: digestProviderSubject(provider.subject),
    });
  } catch (error) {
    if (isStableError(error)) throw error;
    fail("v1_9_baseline_candidate_evidence_invalid");
  }
}

export function assertV1_9BaselineCandidateUnchanged(cwd, candidate) {
  try {
    const currentSubject = collectGitVerificationSubject(cwd);
    if (!isDeepStrictEqual(currentSubject, candidate.subject) ||
        !readOrdinaryRelativeFile(
          cwd,
          candidate.verificationManifestPath,
          "v1_9_baseline_verification_manifest_invalid",
        ).equals(candidate.verificationManifestBytes)) {
      fail("v1_9_baseline_subject_drift");
    }
  } catch (error) {
    if (isStableError(error)) throw error;
    fail("v1_9_baseline_subject_drift");
  }
}

function digestProviderSubject(subject) {
  const ordered = {
    headSha: subject.headSha,
    treeSha: subject.treeSha,
    workingTreeDigest: subject.workingTreeDigest,
    dirty: subject.dirty,
    policySha256: subject.policySha256,
    stageSha256: subject.stageSha256,
  };
  return createHash("sha256")
    .update("v1-9-provider-continuity-subject.v1\0", "utf8")
    .update(JSON.stringify(ordered), "utf8")
    .digest("hex");
}

function readOrdinaryRelativeFile(root, relativePath, reasonCode) {
  const safePath = safeRelativePath(relativePath, reasonCode);
  let current = path.resolve(root);
  try {
    for (const segment of safePath.split("/")) {
      current = path.join(current, segment);
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) fail(reasonCode);
    }
    if (!lstatSync(current).isFile()) fail(reasonCode);
    return readFileSync(current);
  } catch (error) {
    if (isStableError(error)) throw error;
    fail(reasonCode);
  }
}

function safeRelativePath(value, reasonCode) {
  const candidate = String(value ?? "");
  if (!candidate || candidate.includes("\\") || path.posix.isAbsolute(candidate) || path.win32.isAbsolute(candidate) ||
      candidate.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    fail(reasonCode);
  }
  return candidate;
}

function normalizeNow(value) {
  const date = value === undefined ? new Date() : value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) fail("v1_9_baseline_now_invalid");
  return date;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(reasonCode) {
  const error = new Error(reasonCode);
  error.reasonCode = reasonCode;
  throw error;
}

function isStableError(error) {
  return error instanceof Error &&
    typeof error.reasonCode === "string" &&
    error.message === error.reasonCode;
}
