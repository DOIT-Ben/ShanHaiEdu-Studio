import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createProviderCallTraceRecorder,
  digestProviderRequestId,
  resolveProviderCallTraceRecorderFromEnv,
  runWithProviderCallTraceContext,
} from "@/server/provider-ledger/provider-call-trace";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Provider call trace", () => {
  it("writes one immutable, sanitized fact bound to the active product turn", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "shanhai-provider-trace-"));
    roots.push(root);
    const recorder = createProviderCallTraceRecorder({ root, campaignId: "campaign-1" });

    await runWithProviderCallTraceContext(context(), async () => {
      await recorder.record({
        provider: "openai_responses",
        channel: "primary",
        model: "model-1",
        startedAt: "2026-07-17T08:00:00.000Z",
        completedAt: "2026-07-17T08:00:01.000Z",
        durationMs: 1000,
        outcome: "failed",
        httpStatus: 502,
        timeout: false,
        requestIdDigest: digestProviderRequestId("req-secret-1"),
        usage: null,
        retryCount: 0,
        errorCategory: "provider",
      });
    });

    const files = await readdir(root);
    expect(files).toHaveLength(1);
    const text = await readFile(path.join(root, files[0]), "utf8");
    const fact = JSON.parse(text);
    expect(fact).toMatchObject({
      schemaVersion: "shanhai-provider-call-trace.v1",
      campaignId: "campaign-1",
      context: context(),
      provider: { kind: "openai_responses", channel: "primary", modelFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) },
      continuity: { phase: "initial", callOrdinal: 1 },
      result: { outcome: "failed", httpStatus: 502, timeout: false, retryCount: 0, errorCategory: "provider" },
    });
    expect(fact.result.requestIdDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(text).not.toContain("req-secret-1");
    expect(text).not.toMatch(/authorization|bearer|api[_-]?key|https?:\/\//i);
  });

  it("fails closed when capture is enabled with an invalid configuration", () => {
    expect(() => resolveProviderCallTraceRecorderFromEnv({
      NODE_ENV: "test" as const,
      SHANHAI_PROVIDER_CALL_TRACE_ENABLED: "1",
      SHANHAI_PROVIDER_CALL_TRACE_MODE: "development",
    })).toThrow(/configuration is incomplete/i);
  });

  it("accepts only the matching campaign capture root and keeps ordinals across recorder instances", async () => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "shanhai-provider-repository-"));
    roots.push(repositoryRoot);
    const captureRoot = path.join(repositoryRoot, ".tmp", "provider-continuity", "campaigns", "campaign-1", "capture");
    await mkdir(captureRoot, { recursive: true });
    const env = {
      NODE_ENV: "test" as const,
      SHANHAI_PROVIDER_CALL_TRACE_ENABLED: "1",
      SHANHAI_PROVIDER_CALL_TRACE_MODE: "development",
      SHANHAI_PROVIDER_CALL_TRACE_ROOT: ".tmp/provider-continuity/campaigns/campaign-1/capture",
      SHANHAI_PROVIDER_CALL_TRACE_CAMPAIGN_ID: "campaign-1",
    };
    const first = resolveProviderCallTraceRecorderFromEnv(env, repositoryRoot)!;
    const second = resolveProviderCallTraceRecorderFromEnv(env, repositoryRoot)!;

    await runWithProviderCallTraceContext(context(), async () => {
      await first.record(successfulCall());
      await second.record(successfulCall());
    });

    const facts = await Promise.all((await readdir(captureRoot)).map(async (file) =>
      JSON.parse(await readFile(path.join(captureRoot, file), "utf8"))));
    expect(facts.map((fact) => fact.continuity.callOrdinal).sort()).toEqual([1, 2]);
    expect(() => resolveProviderCallTraceRecorderFromEnv({
      ...env,
      SHANHAI_PROVIDER_CALL_TRACE_ROOT: ".tmp/provider-continuity/campaigns/other/capture",
    }, repositoryRoot)).toThrow(/configuration|campaign/i);
  });

  it("does not write an orphan fact without an active product-turn context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "shanhai-provider-trace-"));
    roots.push(root);
    const recorder = createProviderCallTraceRecorder({ root, campaignId: "campaign-1" });
    const written = await recorder.record({
      provider: "openai_responses",
      channel: "primary",
      model: "model-1",
      startedAt: "2026-07-17T08:00:00.000Z",
      completedAt: "2026-07-17T08:00:01.000Z",
      durationMs: 1000,
      outcome: "succeeded",
      httpStatus: 200,
      timeout: false,
      requestIdDigest: null,
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, cachedTokens: 0, cacheWriteTokens: 0 },
      retryCount: 0,
      errorCategory: "none",
    });
    expect(written).toBe(false);
    expect(await readdir(root)).toEqual([]);
  });
});

function context() {
  return {
    projectId: "project-1",
    taskId: "task-1",
    runId: "turn:message-1",
    turnJobId: "turn-job-1",
    teacherMessageId: "message-1",
    intentEpoch: 2,
    phase: "initial" as const,
  };
}

function successfulCall() {
  return {
    provider: "openai_responses" as const,
    channel: "primary" as const,
    model: "model-1",
    startedAt: "2026-07-17T08:00:00.000Z",
    completedAt: "2026-07-17T08:00:01.000Z",
    durationMs: 1000,
    outcome: "succeeded" as const,
    httpStatus: 200,
    timeout: false,
    requestIdDigest: null,
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, cachedTokens: 0, cacheWriteTokens: 0 },
    retryCount: 0 as const,
    errorCategory: "none" as const,
  };
}
