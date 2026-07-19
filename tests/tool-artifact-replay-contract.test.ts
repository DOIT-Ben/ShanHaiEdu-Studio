import { describe, expect, it } from "vitest";

import type {
  Artifact,
  GenerationJob,
  RunInputSnapshot,
  ToolInvocationRecord,
} from "@/generated/prisma/client";
import {
  canonicalizeRunInput,
  hashRunInput,
} from "@/server/execution/run-input-snapshot";
import { matchesGenerationInvocationContract } from "@/server/conversation/tool-artifact-replay-contract";

describe("GenerationJob Invocation replay contract", () => {
  it("uses the registry-declared design source as primary for a multi-input Provider Tool", () => {
    const fixture = generationFixture({
      authority: "main_agent",
      sourceKinds: ["ppt_design_draft", "image_prompts"],
      primaryIndex: 0,
      primarySourceArtifactKind: "ppt_design_draft",
      request: { mode: "full_deck" },
      generationKind: "image",
      requiredArtifactKinds: ["ppt_design_draft", "image_prompts"],
    });

    expect(matchesGenerationInvocationContract(fixture.input)).toBe(true);
  });

  it("accepts a trusted current-epoch compatibility source without inventing current task provenance", () => {
    const fixture = generationFixture({
      authority: "main_agent",
      sourceKinds: ["ppt_design_draft"],
      primaryIndex: 0,
      request: { pageIds: ["page-1"] },
      generationKind: "image",
      requiredArtifactKinds: ["ppt_design_draft"],
    });
    const compatibleSource = {
      ...fixture.input.sourceArtifacts[0],
      taskId: null,
      taskBriefDigest: null,
      origin: "tool_result",
    } as Artifact;

    expect(matchesGenerationInvocationContract({
      ...fixture.input,
      sourceArtifacts: [compatibleSource],
    })).toBe(true);
  });

  it("rejects an unbound source outside the current intent or without a trusted compatibility origin", () => {
    const fixture = generationFixture({
      authority: "main_agent",
      sourceKinds: ["ppt_design_draft"],
      primaryIndex: 0,
      request: { pageIds: ["page-1"] },
      generationKind: "image",
      requiredArtifactKinds: ["ppt_design_draft"],
    });
    const compatibleSource = {
      ...fixture.input.sourceArtifacts[0],
      taskId: null,
      taskBriefDigest: null,
    } as Artifact;

    expect(matchesGenerationInvocationContract({
      ...fixture.input,
      sourceArtifacts: [{ ...compatibleSource, intentEpoch: 1, origin: "tool_result" } as Artifact],
    })).toBe(false);
    expect(matchesGenerationInvocationContract({
      ...fixture.input,
      sourceArtifacts: [{ ...compatibleSource, origin: "system_candidate" } as Artifact],
    })).toBe(false);
  });

  it("rejects draft, fake-approved, and placeholder compatibility sources", () => {
    const fixture = generationFixture({
      authority: "main_agent",
      sourceKinds: ["ppt_design_draft"],
      primaryIndex: 0,
      request: { pageIds: ["page-1"] },
      generationKind: "image",
      requiredArtifactKinds: ["ppt_design_draft"],
    });
    const compatibleSource = {
      ...fixture.input.sourceArtifacts[0],
      taskId: null,
      taskBriefDigest: null,
      origin: "tool_result",
    } as Artifact;
    const untrustedSources = [
      { ...compatibleSource, status: "draft", isApproved: false, structuredContentJson: "{}" },
      { ...compatibleSource, status: "approved", isApproved: true, structuredContentJson: "{}" },
      {
        ...compatibleSource,
        structuredContentJson: JSON.stringify({
          placeholder: true,
          artifactQualityState: trustedQualityState(),
        }),
      },
    ] as Artifact[];

    for (const source of untrustedSources) {
      expect(matchesGenerationInvocationContract({
        ...fixture.input,
        sourceArtifacts: [source],
      })).toBe(false);
    }
  });

  it("rejects a self-consistent Job with the wrong generation kind or source Artifact kind", () => {
    const wrongKind = generationFixture({
      authority: "artifact_route",
      sourceKinds: ["ppt_design_draft"],
      primaryIndex: 0,
      request: { sourceArtifactId: "source-0", sourceArtifactVersion: 1 },
      generationKind: "image",
      expectedGenerationKind: "pptx",
      requiredArtifactKinds: ["ppt_design_draft"],
    });
    const wrongSource = generationFixture({
      authority: "artifact_route",
      sourceKinds: ["ppt_draft"],
      primaryIndex: 0,
      request: { sourceArtifactId: "source-0", sourceArtifactVersion: 1 },
      generationKind: "pptx",
      requiredArtifactKinds: ["ppt_design_draft"],
    });

    expect(matchesGenerationInvocationContract(wrongKind.input)).toBe(false);
    expect(matchesGenerationInvocationContract(wrongSource.input)).toBe(false);
  });

  it("rejects a GenerationJob bound to a different page or shot unit", () => {
    const fixture = generationFixture({
      authority: "artifact_route",
      sourceKinds: ["video_segment_plan"],
      primaryIndex: 0,
      request: { sourceArtifactId: "source-0", sourceArtifactVersion: 1, shotId: "shot-1" },
      generationKind: "video",
      requiredArtifactKinds: ["video_segment_plan"],
      unitId: "shot-2",
    });

    expect(matchesGenerationInvocationContract(fixture.input)).toBe(false);
  });

  it("binds a native video Job to the single production shotIds value", () => {
    const valid = generationFixture({
      authority: "main_agent",
      toolName: "generate_video_shot",
      sourceKinds: ["video_segment_plan"],
      primaryIndex: 0,
      request: { shotIds: ["shot-1"] },
      generationKind: "video",
      requiredArtifactKinds: ["video_segment_plan"],
      unitId: "shot-1",
    });
    const missingUnit = generationFixture({
      authority: "main_agent",
      toolName: "generate_video_shot",
      sourceKinds: ["video_segment_plan"],
      primaryIndex: 0,
      request: { shotIds: ["shot-1"] },
      generationKind: "video",
      requiredArtifactKinds: ["video_segment_plan"],
    });

    expect(matchesGenerationInvocationContract(valid.input)).toBe(true);
    expect(matchesGenerationInvocationContract(missingUnit.input)).toBe(false);
  });

  it.each([
    { shotIds: [] },
    { shotIds: ["shot-1", "shot-2"] },
    { shotIds: ["shot-1"], unitId: "shot-2" },
  ])("rejects invalid native video unit input %#", (request) => {
    const fixture = generationFixture({
      authority: "main_agent",
      toolName: "generate_video_shot",
      sourceKinds: ["video_segment_plan"],
      primaryIndex: 0,
      request,
      generationKind: "video",
      requiredArtifactKinds: ["video_segment_plan"],
      unitId: "shot-1",
    });

    expect(matchesGenerationInvocationContract(fixture.input)).toBe(false);
  });

  it("keeps multi-page batches unbound to an arbitrary first page", () => {
    const batch = generationFixture({
      authority: "main_agent",
      sourceKinds: ["ppt_design_draft"],
      primaryIndex: 0,
      request: { pageIds: ["page-1", "page-2"] },
      generationKind: "image",
      requiredArtifactKinds: ["ppt_design_draft"],
    });
    const firstPage = generationFixture({
      authority: "main_agent",
      sourceKinds: ["ppt_design_draft"],
      primaryIndex: 0,
      request: { pageIds: ["page-1", "page-2"] },
      generationKind: "image",
      requiredArtifactKinds: ["ppt_design_draft"],
      unitId: "page-1",
    });

    expect(matchesGenerationInvocationContract(batch.input)).toBe(true);
    expect(matchesGenerationInvocationContract(firstPage.input)).toBe(false);
  });

  it("rejects a Job whose primary Artifact kind conflicts with the Tool contract", () => {
    const fixture = generationFixture({
      authority: "main_agent",
      sourceKinds: ["ppt_design_draft", "image_prompts"],
      primaryIndex: 1,
      primarySourceArtifactKind: "ppt_design_draft",
      request: { mode: "full_deck" },
      generationKind: "image",
      requiredArtifactKinds: ["ppt_design_draft", "image_prompts"],
    });

    expect(matchesGenerationInvocationContract(fixture.input)).toBe(false);
  });
});

function generationFixture(options: {
  authority: "main_agent" | "artifact_route";
  toolName?: string;
  sourceKinds: string[];
  primaryIndex: number;
  request: Record<string, unknown>;
  generationKind: string;
  expectedGenerationKind?: string;
  requiredArtifactKinds: string[];
  primarySourceArtifactKind?: string;
  unitId?: string;
}) {
  const now = new Date("2026-07-19T00:00:00.000Z");
  const projectId = "project-generation-contract";
  const taskId = "task-generation-contract";
  const taskBriefDigest = "a".repeat(64);
  const sourceArtifacts = options.sourceKinds.map((kind, index) => ({
    id: `source-${index}`,
    projectId,
    taskId,
    taskBriefDigest,
    intentEpoch: 0,
    planRevision: 0,
    origin: "tool_result",
    nodeKey: kind,
    kind,
    title: kind,
    status: "approved",
    summary: kind,
    markdownContent: "",
    structuredContentJson: JSON.stringify({ artifactQualityState: trustedQualityState() }),
    version: 1,
    isApproved: true,
    createdAt: now,
    updatedAt: now,
  })) as Artifact[];
  const primary = sourceArtifacts[options.primaryIndex];
  const invocation = {
    invocationId: "invocation-generation-contract",
    projectId,
    taskId,
    intentEpoch: 0,
    planRevision: 0,
    toolName: options.toolName ?? "provider_tool",
    executionEnvelopeJson: JSON.stringify({ taskBriefDigest }),
    requestJson: JSON.stringify(options.request),
    idempotencyKey: "invocation-idempotency-key",
    status: "running",
    artifactId: null,
    observationId: null,
    startedAt: now,
    finishedAt: null,
  } as ToolInvocationRecord;
  const sourceDescriptors = sourceArtifacts.map((artifact) => ({
    artifactId: artifact.id,
    kind: artifact.kind,
    version: artifact.version,
  }));
  const routeDescriptors = sourceArtifacts.map((artifact) => ({
    id: artifact.id,
    kind: artifact.kind,
    nodeKey: artifact.nodeKey,
    version: artifact.version,
  }));
  const generationInput = options.authority === "main_agent"
    ? {
        toolName: invocation.toolName,
        arguments: options.request,
        taskBriefDigest,
        intentEpoch: 0,
        sourceArtifacts: sourceDescriptors,
        ...(options.unitId ? { unitId: options.unitId } : {}),
      }
    : {
        source: routeDescriptors[0],
        upstream: routeDescriptors.slice(1),
        ...(options.unitId ? { unitId: options.unitId } : {}),
      };
  const payload = {
    projectId,
    intentEpoch: 0,
    capabilityId: "provider_capability",
    kind: options.generationKind,
    sourceArtifactIds: sourceArtifacts.map((artifact) => artifact.id),
    sourceArtifact: {
      id: primary.id,
      nodeKey: primary.nodeKey,
      kind: primary.kind,
      version: primary.version,
      updatedAt: primary.updatedAt,
    },
    input: generationInput,
  };
  const inputHash = hashRunInput(payload);
  const snapshot = {
    id: "snapshot-generation-contract",
    projectId,
    intentEpoch: 0,
    capabilityId: "provider_capability",
    sourceArtifactIdsJson: JSON.stringify(sourceArtifacts.map((artifact) => artifact.id)),
    payloadJson: canonicalizeRunInput(payload),
    inputHash,
    createdAt: now,
  } as RunInputSnapshot;
  const generationJob = {
    id: "job-generation-contract",
    projectId,
    kind: options.generationKind,
    sourceArtifactId: primary.id,
    unitId: options.unitId ?? null,
    runInputSnapshotId: snapshot.id,
    intentEpoch: 0,
    idempotencyKey: options.authority === "main_agent" ? invocation.idempotencyKey : "route-job-key",
    inputHash,
    providerTaskId: null,
    pollState: "running",
    providerAcceptedAt: null,
    lastPolledAt: null,
    status: "running",
    attempts: 1,
    maxAttempts: 2,
    resultArtifactId: null,
    providerResultJson: null,
    countsAsProviderSubmission: true,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: null,
  } as GenerationJob;
  return {
    input: {
      authority: options.authority,
      invocation,
      request: options.request,
      capabilityId: snapshot.capabilityId,
      expectedGenerationKind: options.expectedGenerationKind ?? options.generationKind,
      requiredArtifactKinds: options.requiredArtifactKinds,
      primarySourceArtifactKind: options.primarySourceArtifactKind ?? options.requiredArtifactKinds[0],
      sourceArtifacts,
      generationJob,
      snapshot,
    },
  };
}

function trustedQualityState() {
  return {
    validationStatus: "passed",
    reviewStatus: "passed",
    downstreamEligibility: "eligible",
  };
}
