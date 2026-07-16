import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  deriveV1_9ExternalAuditAffectedUnits,
  evaluateV1_9ExternalAcceptanceRound,
  normalizeV1_9ExternalAcceptanceReport,
} from "../scripts/lib/v1-9-external-acceptance";
import { createExternalAuditRepairHandoff } from "@/server/conversation/external-audit-repair-contract";

describe("V1-9 versioned external acceptance rounds", () => {
  it("keeps a P0 round immutable and derives a repair-only handoff from its locators", () => {
    const report = normalizeV1_9ExternalAcceptanceReport(reportFixture({
      findings: [findingFixture()],
    }));
    const reportDigest = digest(report);

    const evaluation = evaluateV1_9ExternalAcceptanceRound({ history: [], current: report });
    const handoff = createExternalAuditRepairHandoff({
      report,
      reportDigest,
      binding: repairBinding(),
    });

    expect(evaluation).toMatchObject({
      outcome: "repair_required",
      auditRound: 1,
      openP0FindingIds: ["finding-p0-page-3"],
      affectedUnits: [{
        unitId: "ppt_deck:page:3",
        kind: "page",
        artifactRole: "ppt_deck",
        artifactId: "pptx-1",
        artifactVersion: "course-v1",
        pageNumber: 3,
      }],
    });
    expect(handoff).toMatchObject({
      schemaVersion: "external-audit-repair-handoff.v1",
      reportId: report.reportId,
      reportDigest,
      auditRound: 1,
      runId: report.runId,
      manifestSha256: report.manifestSha256,
      packageArtifactId: report.packageArtifactId,
      packageArtifactVersion: 1,
      packageVersion: "course-v1",
      packageSha256: report.packageSha256,
      openFindingIds: ["finding-p0-page-3"],
      preserveUnlistedVersions: true,
      externalCodexBusinessToolCallCount: 0,
      taskBinding: repairBinding(),
    });
    expect(handoff.findings).toHaveLength(1);
    expect(handoff.findings[0]).toMatchObject({
      findingId: "finding-p0-page-3",
      responsibilityLayer: "quality_gate",
      category: "design_quality",
      feedback: {
        design: "第3页正文越过安全边距。",
        vulnerability: null,
      },
    });
    expect(handoff.handoffDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("allows a new package round to close exactly the prior open findings", () => {
    const first = normalizeV1_9ExternalAcceptanceReport(reportFixture({ findings: [findingFixture()] }));
    const firstDigest = digest(first);
    const second = normalizeV1_9ExternalAcceptanceReport(reportFixture({
      reportId: "external-acceptance-round-2",
      auditRound: 2,
      packageArtifactId: "package-2",
      packageArtifactVersion: 2,
      packageVersion: "course-v2",
      packageSha256: "c".repeat(64),
      reviewScope: {
        kind: "targeted_recheck",
        previousReportDigest: firstDigest,
        reviewedFindingIds: ["finding-p0-page-3"],
      },
      findings: [findingFixture({
        status: "closed",
        locator: {
          artifactRole: "ppt_deck",
          artifactId: "pptx-2",
          artifactVersion: "course-v2",
          pageNumber: 3,
          shotId: null,
          packageEntry: "materials/course-v2.pptx",
        },
        feedback: {
          design: "第3页已回到安全边距内。",
          vulnerability: null,
          engineering: "定点复验通过。",
        },
      })],
    }));

    const evaluation = evaluateV1_9ExternalAcceptanceRound({
      history: [{ report: first, reportDigest: firstDigest }],
      current: second,
    });

    expect(evaluation).toMatchObject({
      outcome: "accepted",
      auditRound: 2,
      reviewedFindingIds: ["finding-p0-page-3"],
      openP0FindingIds: [],
      affectedUnits: [],
    });
  });

  it.each([
    ["same package", { packageArtifactId: "package-1", packageArtifactVersion: 1, packageVersion: "course-v1", packageSha256: "b".repeat(64) }],
    ["missing open finding", { reviewScope: { kind: "targeted_recheck", previousReportDigest: "FIRST", reviewedFindingIds: [] } }],
    ["new finding outside scope", { findings: [findingFixture({ findingId: "new-p0", locator: { artifactRole: "ppt_deck", artifactId: "pptx-2", artifactVersion: "course-v2", pageNumber: 8, shotId: null, packageEntry: "materials/course-v2.pptx" } })] }],
    ["broadened unit", { findings: [findingFixture({ locator: { artifactRole: "intro_video", artifactId: "video-2", artifactVersion: "course-v2", pageNumber: null, shotId: "shot-9", packageEntry: "media/video.mp4" } })] }],
  ])("rejects a targeted recheck with %s", (_label, override) => {
    const first = normalizeV1_9ExternalAcceptanceReport(reportFixture({ findings: [findingFixture()] }));
    const firstDigest = digest(first);
    const normalizedOverride = JSON.parse(JSON.stringify(override).replaceAll("FIRST", firstDigest));
    const second = normalizeV1_9ExternalAcceptanceReport(reportFixture({
      reportId: "external-acceptance-round-2",
      auditRound: 2,
      packageArtifactId: "package-2",
      packageArtifactVersion: 2,
      packageVersion: "course-v2",
      packageSha256: "c".repeat(64),
      reviewScope: {
        kind: "targeted_recheck",
        previousReportDigest: firstDigest,
        reviewedFindingIds: ["finding-p0-page-3"],
      },
      findings: [findingFixture({
        status: "closed",
        locator: {
          artifactRole: "ppt_deck",
          artifactId: "pptx-2",
          artifactVersion: "course-v2",
          pageNumber: 3,
          shotId: null,
          packageEntry: "materials/course-v2.pptx",
        },
      })],
      ...normalizedOverride,
    }));

    expect(() => evaluateV1_9ExternalAcceptanceRound({
      history: [{ report: first, reportDigest: firstDigest }],
      current: second,
    })).toThrow(/v1_9_external_acceptance_(?:package_not_revised|recheck_scope_invalid)/);
  });

  it("keeps a newly discovered P0 open when it is inside the authorized affected unit", () => {
    const first = normalizeV1_9ExternalAcceptanceReport(reportFixture({ findings: [findingFixture()] }));
    const firstDigest = digest(first);
    const second = normalizeV1_9ExternalAcceptanceReport(reportFixture({
      reportId: "external-acceptance-round-2",
      auditRound: 2,
      packageArtifactId: "package-2",
      packageArtifactVersion: 2,
      packageVersion: "course-v2",
      packageSha256: "c".repeat(64),
      reviewScope: {
        kind: "targeted_recheck",
        previousReportDigest: firstDigest,
        reviewedFindingIds: ["finding-p0-page-3"],
      },
      findings: [
        findingFixture({ status: "closed", locator: page3LocatorV2() }),
        findingFixture({ findingId: "finding-p0-page-3-contrast", locator: page3LocatorV2() }),
      ],
    }));

    expect(evaluateV1_9ExternalAcceptanceRound({
      history: [{ report: first, reportDigest: firstDigest }],
      current: second,
    })).toMatchObject({
      outcome: "repair_required",
      reviewedFindingIds: ["finding-p0-page-3"],
      openP0FindingIds: ["finding-p0-page-3-contrast"],
      affectedUnits: [{ unitId: "ppt_deck:page:3" }],
    });
  });

  it("rejects any external audit business Tool call before deriving affected units", () => {
    expect(() => normalizeV1_9ExternalAcceptanceReport(reportFixture({
      auditBoundary: {
        businessToolCalls: 1,
        artifactMutations: 0,
        teacherApprovalActions: 0,
        packageRebuilds: 0,
      },
    }))).toThrow(/v1_9_external_acceptance_not_read_only/);

    expect(deriveV1_9ExternalAuditAffectedUnits([findingFixture({
      locator: {
        artifactRole: "intro_video",
        artifactId: "video-1",
        artifactVersion: "course-v1",
        pageNumber: null,
        shotId: "shot-4",
        packageEntry: "media/video.mp4",
      },
    })])).toEqual([expect.objectContaining({
      unitId: "intro_video:shot:shot-4",
      kind: "shot",
      shotId: "shot-4",
    })]);
  });

  it("does not widen the repair handoff with non-P0 findings", () => {
    const report = normalizeV1_9ExternalAcceptanceReport(reportFixture({
      findings: [
        findingFixture(),
        findingFixture({
          findingId: "finding-p1-page-8",
          severity: "P1",
          locator: {
            artifactRole: "ppt_deck",
            artifactId: "pptx-1",
            artifactVersion: "course-v1",
            pageNumber: 8,
            shotId: null,
            packageEntry: "materials/course-v1.pptx",
          },
        }),
      ],
    }));

    expect(evaluateV1_9ExternalAcceptanceRound({ history: [], current: report }).affectedUnits)
      .toEqual([expect.objectContaining({ unitId: "ppt_deck:page:3" })]);
  });
});

function reportFixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "v1-9-external-acceptance-report.v2",
    reportId: "external-acceptance-round-1",
    auditRound: 1,
    runId: "v1-9-audit-rounds",
    manifestSha256: "a".repeat(64),
    packageArtifactId: "package-1",
    packageArtifactVersion: 1,
    packageVersion: "course-v1",
    packageSha256: "b".repeat(64),
    rubricVersion: "v1-9-product-rubric.v1",
    auditMode: "external_read_only",
    auditBoundary: {
      businessToolCalls: 0,
      artifactMutations: 0,
      teacherApprovalActions: 0,
      packageRebuilds: 0,
    },
    reviewScope: {
      kind: "full_package",
      previousReportDigest: null,
      reviewedFindingIds: [],
    },
    findings: [],
    generatedAt: "2026-07-16T00:30:00.000Z",
    ...overrides,
  };
}

function findingFixture(overrides: Record<string, unknown> = {}) {
  return {
    findingId: "finding-p0-page-3",
    status: "open",
    severity: "P0",
    responsibilityLayer: "quality_gate",
    category: "design_quality",
    summary: "第3页存在阻断交付的版式问题。",
    feedback: {
      design: "第3页正文越过安全边距。",
      vulnerability: null,
      engineering: "仅返修第3页并复验安全边距。",
    },
    locator: {
      artifactRole: "ppt_deck",
      artifactId: "pptx-1",
      artifactVersion: "course-v1",
      pageNumber: 3,
      shotId: null,
      packageEntry: "materials/course-v1.pptx",
    },
    suggestedRegressionTest: "验证第3页正文位于安全边距内。",
    ...overrides,
  };
}

function page3LocatorV2() {
  return {
    artifactRole: "ppt_deck",
    artifactId: "pptx-2",
    artifactVersion: "course-v2",
    pageNumber: 3,
    shotId: null,
    packageEntry: "materials/course-v2.pptx",
  };
}

function repairBinding() {
  return {
    actorUserId: "teacher-1",
    actorAuthMode: "local" as const,
    projectId: "project-1",
    taskId: "task-1",
    intentEpoch: 0,
    taskBriefDigest: "d".repeat(64),
    planRevision: 8,
    turnJobId: "turn-job-1",
    teacherMessageId: "teacher-message-1",
    idempotencyKey: "external-audit:round-1",
  };
}

function digest(value: unknown) {
  return createHash("sha256").update(`${JSON.stringify(value, null, 2)}\n`).digest("hex");
}
