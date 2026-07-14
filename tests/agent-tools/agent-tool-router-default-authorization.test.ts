import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import { createAgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import { routeAgentToolCall } from "@/server/tools/agent-tool-router";
import type { AgentToolExecutor } from "@/server/tools/agent-tool-types";
import { videoCourseAnchorHardGateIds } from "@/server/tools/video-course-anchor-gate";
import { validPptDirectorOutput } from "../support/ppt-director-output-fixture";

const root = process.cwd();
const stageRoot = path.join(root, ".tmp", "agent-tool-auth-tests");
const databasePath = path.join(stageRoot, `authorization-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;

let client: PrismaClient;

beforeAll(() => {
  mkdirSync(stageRoot, { recursive: true });
  const initialized = spawnSync(process.execPath, ["scripts/init-sqlite-schema.mjs"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, SHANHAI_DB_INIT_SKIP_DOTENV: "1" },
    encoding: "utf8",
  });
  if (initialized.status !== 0) {
    throw new Error(initialized.stderr || initialized.stdout || "Agent Tool authorization database initialization failed.");
  }
  client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
});

afterAll(async () => {
  await client?.$disconnect();
  for (const suffix of ["", "-shm", "-wal"]) rmSync(`${databasePath}${suffix}`, { force: true });
});

type Fixture = Awaited<ReturnType<typeof createFixture>>;

describe("V1-2 Agent Tool default database authorization", () => {
  it("authorizes a matching actor, project, IntentEpoch, source message and approved Artifact digest", async () => {
    const fixture = await createFixture();
    const executor = successfulExecutor(fixture.invocationId);

    const result = await routeAgentToolCall(buildEnvelope(fixture), { executor, authorizationDb: client });

    expect(result.status).toBe("succeeded");
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["needs_review", { status: "needs_review", isApproved: false }],
    ["approved", { status: "approved", isApproved: true }],
  ])("authorizes an exact latest %s Artifact as an independent Critic target", async (_name, reviewApproval) => {
    const fixture = await createFixture({ reviewApproval });
    const executor = successfulCriticExecutor(
      fixture.criticInvocationId,
      fixture.reviewArtifactId,
      fixture.reviewArtifactKind,
    );

    const result = await routeAgentToolCall(buildCriticEnvelope(fixture), { executor, authorizationDb: client });

    expect(result.status).toBe("succeeded");
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["stale version", (fixture: Fixture) => ({
      artifactId: fixture.oldReviewArtifactId,
      kind: fixture.reviewArtifactKind,
      version: fixture.oldReviewArtifactVersion,
      digest: fixture.oldReviewArtifactDigest,
    }), "agent_tool_unauthorized"],
    ["other project", (fixture: Fixture) => ({
      artifactId: fixture.otherReviewArtifactId,
      kind: fixture.reviewArtifactKind,
      version: fixture.reviewArtifactVersion,
      digest: fixture.otherReviewArtifactDigest,
    }), "agent_tool_unauthorized"],
    ["wrong kind", (fixture: Fixture) => ({
      artifactId: fixture.reviewArtifactId,
      kind: "pptx_artifact",
      version: fixture.reviewArtifactVersion,
      digest: fixture.reviewArtifactDigest,
    }), "agent_tool_arguments_invalid"],
    ["wrong digest", (fixture: Fixture) => ({
      artifactId: fixture.reviewArtifactId,
      kind: fixture.reviewArtifactKind,
      version: fixture.reviewArtifactVersion,
      digest: "e".repeat(64),
    }), "agent_tool_unauthorized"],
  ])("rejects an invalid Critic review target: %s", async (_name, createRef, expectedCategory) => {
    const fixture = await createFixture();
    const reviewTargetRef = createRef(fixture);
    const executor = successfulCriticExecutor(
      fixture.criticInvocationId,
      reviewTargetRef.artifactId,
      reviewTargetRef.kind,
    );

    const result = await routeAgentToolCall(buildCriticEnvelope(fixture, reviewTargetRef), {
      executor,
      authorizationDb: client,
    });
    expect(result).toMatchObject({ status: "failed", errorCategory: expectedCategory, artifactCreated: false });
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects an actor and session mismatch", async () => {
    const fixture = await createFixture();
    const executor = successfulExecutor(fixture.invocationId);
    const envelope = buildEnvelope(fixture, {
      identity: { actorUserId: fixture.otherUserId, actorAuthMode: "password", authSessionId: fixture.ownerSessionId },
    });

    await expectUnauthorized(envelope, executor);
  });

  it("rejects an actor without project write permission", async () => {
    const fixture = await createFixture();
    const executor = successfulExecutor(fixture.invocationId);
    const envelope = buildEnvelope(fixture, {
      identity: { actorUserId: fixture.otherUserId, actorAuthMode: "password", authSessionId: fixture.otherSessionId },
    });

    await expectUnauthorized(envelope, executor);
  });

  it("rejects a source message from another project", async () => {
    const fixture = await createFixture();
    const executor = successfulExecutor(fixture.invocationId);

    await expectUnauthorized(buildEnvelope(fixture, { sourceMessageId: fixture.otherMessageId }), executor);
  });

  it("rejects a stale IntentEpoch", async () => {
    const fixture = await createFixture();
    const executor = successfulExecutor(fixture.invocationId);

    await expectUnauthorized(buildEnvelope(fixture, { intentEpoch: fixture.intentEpoch - 1 }), executor);
  });

  it.each([
    ["status", { status: "needs_review", isApproved: true }],
    ["approval flag", { status: "approved", isApproved: false }],
  ])("rejects an Artifact with invalid approval %s", async (_name, approval) => {
    const fixture = await createFixture({ artifactApproval: approval });
    const executor = successfulExecutor(fixture.invocationId);

    await expectUnauthorized(buildEnvelope(fixture), executor);
  });

  it.each([
    ["needs_review with approval flag", { status: "needs_review", isApproved: true }],
    ["approved without approval flag", { status: "approved", isApproved: false }],
  ])("rejects a review target with inconsistent approval state: %s", async (_name, reviewApproval) => {
    const fixture = await createFixture({ reviewApproval });
    await expect(client.artifact.findUnique({
      where: { id: fixture.reviewArtifactId },
      select: { status: true, isApproved: true },
    })).resolves.toEqual(reviewApproval);
    const executor = successfulCriticExecutor(
      fixture.criticInvocationId,
      fixture.reviewArtifactId,
      fixture.reviewArtifactKind,
    );

    await expectUnauthorized(buildCriticEnvelope(fixture), executor);
  });

  it("rejects malformed structured content for approved inputs and review targets", async () => {
    const approvedFixture = await createFixture();
    await client.artifact.update({
      where: { id: approvedFixture.artifactId },
      data: { structuredContentJson: "{" },
    });
    await expectUnauthorized(
      buildEnvelope(approvedFixture),
      successfulExecutor(approvedFixture.invocationId),
    );

    const reviewFixture = await createFixture();
    await client.artifact.update({
      where: { id: reviewFixture.reviewArtifactId },
      data: { structuredContentJson: "[]" },
    });
    await expectUnauthorized(
      buildCriticEnvelope(reviewFixture),
      successfulCriticExecutor(
        reviewFixture.criticInvocationId,
        reviewFixture.reviewArtifactId,
        reviewFixture.reviewArtifactKind,
      ),
    );
  });

  it("rejects an approved Artifact from another project", async () => {
    const fixture = await createFixture();
    const executor = successfulExecutor(fixture.invocationId);

    await expectUnauthorized(buildEnvelope(fixture, {
      approvedArtifactRefs: [{
        artifactId: fixture.otherArtifactId,
        kind: fixture.artifactKind,
        version: fixture.artifactVersion,
        digest: fixture.otherArtifactDigest,
      }],
    }), executor);
  });

  it("rejects an Artifact version mismatch", async () => {
    const fixture = await createFixture();
    const executor = successfulExecutor(fixture.invocationId);

    await expectUnauthorized(buildEnvelope(fixture, {
      approvedArtifactRefs: [{
        artifactId: fixture.artifactId,
        kind: fixture.artifactKind,
        version: fixture.artifactVersion + 1,
        digest: fixture.artifactDigest,
      }],
    }), executor);
  });

  it("rejects an Artifact digest mismatch", async () => {
    const fixture = await createFixture();
    const executor = successfulExecutor(fixture.invocationId);

    await expectUnauthorized(buildEnvelope(fixture, {
      approvedArtifactRefs: [{
        artifactId: fixture.artifactId,
        kind: fixture.artifactKind,
        version: fixture.artifactVersion,
        digest: "f".repeat(64),
      }],
    }), executor);
  });
});

async function expectUnauthorized(
  envelope: ReturnType<typeof buildEnvelope>,
  executor: AgentToolExecutor<ReturnType<typeof buildEnvelope>>,
) {
  const result = await routeAgentToolCall(envelope, { executor, authorizationDb: client });
  expect(result).toMatchObject({ status: "failed", errorCategory: "agent_tool_unauthorized", artifactCreated: false });
  expect(executor).not.toHaveBeenCalled();
}

function buildEnvelope(
  fixture: Fixture,
  overrides: Partial<Parameters<typeof createAgentToolInvocationEnvelope>[0]> = {},
) {
  return createAgentToolInvocationEnvelope({
    invocationId: fixture.invocationId,
    toolId: "ppt_director.plan_or_repair",
    identity: { actorUserId: fixture.ownerUserId, actorAuthMode: "password", authSessionId: fixture.ownerSessionId },
    projectId: fixture.projectId,
    intentEpoch: fixture.intentEpoch,
    sourceMessageId: fixture.sourceMessageId,
    reviewTargetRef: null,
    approvedArtifactRefs: [{
      artifactId: fixture.artifactId,
      kind: fixture.artifactKind,
      version: fixture.artifactVersion,
      digest: fixture.artifactDigest,
    }],
    arguments: { goal: "审查课件", stage: "page_repair", targetPageIds: ["page_01"], focus: null },
    ...overrides,
  });
}

function buildCriticEnvelope(
  fixture: Fixture,
  reviewTargetRef = {
    artifactId: fixture.reviewArtifactId,
    kind: fixture.reviewArtifactKind,
    version: fixture.reviewArtifactVersion,
    digest: fixture.reviewArtifactDigest,
  },
) {
  return createAgentToolInvocationEnvelope({
    invocationId: fixture.criticInvocationId,
    toolId: "delivery_critic.review",
    identity: { actorUserId: fixture.ownerUserId, actorAuthMode: "password", authSessionId: fixture.ownerSessionId },
    projectId: fixture.projectId,
    intentEpoch: fixture.intentEpoch,
    sourceMessageId: fixture.sourceMessageId,
    reviewTargetRef,
    approvedArtifactRefs: [{
      artifactId: fixture.artifactId,
      kind: fixture.artifactKind,
      version: fixture.artifactVersion,
      digest: fixture.artifactDigest,
    }],
    arguments: {
      domain: "video",
      stage: "course_anchor",
      targetLocators: [{
        kind: "artifact",
        artifactKind: reviewTargetRef.kind,
        artifactId: reviewTargetRef.artifactId,
      }],
      reviewFocus: "独立创意与最小课程回接",
      courseAnchorRef: {
        artifactId: reviewTargetRef.artifactId,
        version: reviewTargetRef.version,
        digest: reviewTargetRef.digest,
      },
      rubricRef: { id: "video-course-anchor", version: "v1", digest: "b".repeat(64) },
      generatorInvocationId: "generator-invocation-1",
    },
  });
}

function successfulExecutor(invocationId: string) {
  return vi.fn(async () => ({
    status: "succeeded" as const,
    toolId: "ppt_director.plan_or_repair" as const,
    invocationId,
    structuredOutput: { ...validPptDirectorOutput(), decision: "repair", targetLocators: ["page_01"] },
    assistantSummary: "建议定点返修。",
    artifactCreated: false as const,
  }));
}

function successfulCriticExecutor(invocationId: string, artifactId: string, artifactKind: string) {
  return vi.fn(async () => ({
    status: "succeeded" as const,
    toolId: "delivery_critic.review" as const,
    invocationId,
    structuredOutput: {
      recommendation: "pass",
      summary: "课程锚点审查通过。",
      findings: [],
      targetLocators: [{ kind: "artifact", artifactKind, artifactId }],
      responsibleStage: "video_concept_selection",
      minimalFix: "无需返修。",
      inconclusiveReasons: [],
      hardGateResults: videoCourseAnchorHardGateIds.map((gateId) => ({
        gateId,
        status: "passed",
        evidenceRefs: [`evidence:${gateId}`],
        rationale: "证据充分。",
        findingIds: [],
      })),
    },
    assistantSummary: "独立审查通过。",
    artifactCreated: false as const,
  }));
}

async function createFixture(input: {
  artifactApproval?: { status: string; isApproved: boolean };
  reviewApproval?: { status: string; isApproved: boolean };
} = {}) {
  const suffix = randomUUID();
  const ownerUserId = `owner-${suffix}`;
  const otherUserId = `other-${suffix}`;
  const ownerSessionId = `owner-session-${suffix}`;
  const otherSessionId = `other-session-${suffix}`;
  const projectId = `project-${suffix}`;
  const otherProjectId = `other-project-${suffix}`;
  const invocationId = `invocation-${suffix}`;
  const criticInvocationId = `critic-invocation-${suffix}`;
  const intentEpoch = 3;

  await client.localUser.createMany({
    data: [
      { id: ownerUserId, displayName: "Owner", role: "teacher", authMode: "password" },
      { id: otherUserId, displayName: "Other", role: "teacher", authMode: "password" },
    ],
  });
  await client.authSession.createMany({
    data: [
      { id: ownerSessionId, userId: ownerUserId, sessionTokenHash: `owner-hash-${suffix}`, authMode: "password", expiresAt: new Date("2999-01-01T00:00:00.000Z") },
      { id: otherSessionId, userId: otherUserId, sessionTokenHash: `other-hash-${suffix}`, authMode: "password", expiresAt: new Date("2999-01-01T00:00:00.000Z") },
    ],
  });
  await client.project.createMany({
    data: [
      { id: projectId, title: "Owner Project", currentNodeKey: "requirement_spec", ownerUserId, intentEpoch },
      { id: otherProjectId, title: "Other Project", currentNodeKey: "requirement_spec", ownerUserId: otherUserId, intentEpoch },
    ],
  });
  const sourceMessage = await client.conversationMessage.create({
    data: { projectId, role: "teacher", content: "审查当前课件" },
  });
  const otherMessage = await client.conversationMessage.create({
    data: { projectId: otherProjectId, role: "teacher", content: "其他项目消息" },
  });

  const artifactKind = "pptx_artifact";
  const artifactVersion = 2;
  const artifactDraft = {
    nodeKey: "ppt_full_deck",
    kind: artifactKind,
    title: "可编辑课件",
    summary: "已批准课件",
    markdownContent: "课件说明",
    structuredContent: { slideCount: 12 },
  };
  const artifact = await client.artifact.create({
    data: {
      id: `artifact-${suffix}`,
      projectId,
      nodeKey: artifactDraft.nodeKey,
      kind: artifactDraft.kind,
      title: artifactDraft.title,
      summary: artifactDraft.summary,
      markdownContent: artifactDraft.markdownContent,
      structuredContentJson: JSON.stringify(artifactDraft.structuredContent),
      status: input.artifactApproval?.status ?? "approved",
      isApproved: input.artifactApproval?.isApproved ?? true,
      version: artifactVersion,
    },
  });
  const otherArtifactDraft = { ...artifactDraft, title: "其他项目课件" };
  const otherArtifact = await client.artifact.create({
    data: {
      id: `other-artifact-${suffix}`,
      projectId: otherProjectId,
      nodeKey: otherArtifactDraft.nodeKey,
      kind: otherArtifactDraft.kind,
      title: otherArtifactDraft.title,
      summary: otherArtifactDraft.summary,
      markdownContent: otherArtifactDraft.markdownContent,
      structuredContentJson: JSON.stringify(otherArtifactDraft.structuredContent),
      status: "approved",
      isApproved: true,
      version: artifactVersion,
    },
  });

  const reviewArtifactKind = "creative_theme_generate";
  const reviewNodeKey = "creative_theme_generate";
  const oldReviewArtifactVersion = 1;
  const reviewArtifactVersion = 2;
  const oldReviewArtifactDraft = {
    nodeKey: reviewNodeKey,
    kind: reviewArtifactKind,
    title: "独立创意候选 v1",
    summary: "旧的课程锚点候选",
    markdownContent: "旧候选",
    structuredContent: { courseAnchor: { anchorCount: 1 } },
  };
  const reviewArtifactDraft = {
    ...oldReviewArtifactDraft,
    title: "独立创意候选 v2",
    summary: "当前待审查课程锚点候选",
    markdownContent: "当前候选",
  };
  const oldReviewArtifact = await client.artifact.create({
    data: {
      id: `old-review-artifact-${suffix}`,
      projectId,
      nodeKey: reviewNodeKey,
      kind: reviewArtifactKind,
      title: oldReviewArtifactDraft.title,
      summary: oldReviewArtifactDraft.summary,
      markdownContent: oldReviewArtifactDraft.markdownContent,
      structuredContentJson: JSON.stringify(oldReviewArtifactDraft.structuredContent),
      status: "needs_review",
      isApproved: false,
      version: oldReviewArtifactVersion,
    },
  });
  const reviewArtifact = await client.artifact.create({
    data: {
      id: `review-artifact-${suffix}`,
      projectId,
      nodeKey: reviewNodeKey,
      kind: reviewArtifactKind,
      title: reviewArtifactDraft.title,
      summary: reviewArtifactDraft.summary,
      markdownContent: reviewArtifactDraft.markdownContent,
      structuredContentJson: JSON.stringify(reviewArtifactDraft.structuredContent),
      status: input.reviewApproval?.status ?? "needs_review",
      isApproved: input.reviewApproval?.isApproved ?? false,
      version: reviewArtifactVersion,
    },
  });
  const otherReviewArtifactDraft = { ...reviewArtifactDraft, title: "其他项目创意候选" };
  const otherReviewArtifact = await client.artifact.create({
    data: {
      id: `other-review-artifact-${suffix}`,
      projectId: otherProjectId,
      nodeKey: reviewNodeKey,
      kind: reviewArtifactKind,
      title: otherReviewArtifactDraft.title,
      summary: otherReviewArtifactDraft.summary,
      markdownContent: otherReviewArtifactDraft.markdownContent,
      structuredContentJson: JSON.stringify(otherReviewArtifactDraft.structuredContent),
      status: "needs_review",
      isApproved: false,
      version: reviewArtifactVersion,
    },
  });

  return {
    invocationId,
    criticInvocationId,
    ownerUserId,
    otherUserId,
    ownerSessionId,
    otherSessionId,
    projectId,
    intentEpoch,
    sourceMessageId: sourceMessage.id,
    otherMessageId: otherMessage.id,
    artifactId: artifact.id,
    artifactKind,
    artifactVersion,
    artifactDigest: hashArtifactDraft(artifactDraft),
    otherArtifactId: otherArtifact.id,
    otherArtifactDigest: hashArtifactDraft(otherArtifactDraft),
    reviewArtifactId: reviewArtifact.id,
    reviewArtifactKind,
    reviewArtifactVersion,
    reviewArtifactDigest: hashArtifactDraft(reviewArtifactDraft),
    oldReviewArtifactId: oldReviewArtifact.id,
    oldReviewArtifactVersion,
    oldReviewArtifactDigest: hashArtifactDraft(oldReviewArtifactDraft),
    otherReviewArtifactId: otherReviewArtifact.id,
    otherReviewArtifactDigest: hashArtifactDraft(otherReviewArtifactDraft),
  };
}
