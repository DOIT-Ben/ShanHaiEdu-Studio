import { describe, expect, it } from "vitest";

import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { readAgentToolReportsFromMetadata } from "@/server/tools/agent-tool-report";

describe("persisted Agent Tool report integrity", () => {
  it("rejects unknown fields even when their injected value is included in a recomputed digest", () => {
    const payload = {
      projectId: "project-1",
      intentEpoch: 1,
      sourceMessageId: "message-1",
      invocationId: "invocation-1",
      toolId: "requirement_spec.create",
      status: "succeeded",
      assistantSummary: "Requirement specification created.",
      structuredOutput: { title: "Scope" },
      policyOutcome: null,
      approvedArtifactRefs: [],
      inputHash: "a".repeat(64),
      actionDigest: "b".repeat(64),
    };
    const report = {
      reportId: "report-1",
      reportDigest: hashRunInput(payload),
      ...payload,
      createdAt: "2026-07-19T00:00:00.000Z",
    };

    expect(readAgentToolReportsFromMetadata({ agentToolReports: [report] })).toHaveLength(1);

    const injectedPayload = { ...payload, authorityOverride: "main_agent" };
    const injected = {
      ...report,
      ...injectedPayload,
      reportDigest: hashRunInput(injectedPayload),
    };
    expect(readAgentToolReportsFromMetadata({ agentToolReports: [injected] })).toEqual([]);
  });
});
