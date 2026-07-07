import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import {
  buildVideoEndpointUrl,
  buildVideoQueryUrl,
  classifyVideoWaitFailure,
  extractTaskId,
  extractVideoResultUrl,
  resolveVideoTaskId,
  summarizeVideoTaskPayload,
  normalizeVideoStatus,
  validateMp4Buffer,
} from "../scripts/video-smoke.mjs";

test("extracts video task ids from common provider response shapes", () => {
  assert.equal(extractTaskId({ id: "task-a" }), "task-a");
  assert.equal(extractTaskId({ task_id: "task-b" }), "task-b");
  assert.equal(extractTaskId({ data: { id: "task-c" } }), "task-c");
  assert.equal(extractTaskId({ data: { task_id: "task-d" } }), "task-d");
  assert.throws(() => extractTaskId({ data: {} }), /missing_video_task_id/);
});

test("normalizes video task statuses", () => {
  assert.equal(normalizeVideoStatus("queued"), "processing");
  assert.equal(normalizeVideoStatus("IN_PROGRESS"), "processing");
  assert.equal(normalizeVideoStatus("completed"), "completed");
  assert.equal(normalizeVideoStatus("SUCCESS"), "completed");
  assert.equal(normalizeVideoStatus("failed"), "failed");
  assert.equal(normalizeVideoStatus("FAILURE"), "failed");
});

test("extracts video result urls from common provider response shapes", () => {
  assert.equal(extractVideoResultUrl({ video_url: "https://video.example.test/a.mp4" }), "https://video.example.test/a.mp4");
  assert.equal(extractVideoResultUrl({ data: { result_url: "https://video.example.test/b.mp4" } }), "https://video.example.test/b.mp4");
  assert.equal(extractVideoResultUrl({ result: { url: "https://video.example.test/c.mp4" } }), "https://video.example.test/c.mp4");
  assert.throws(() => extractVideoResultUrl({ data: {} }), /missing_video_result_url/);
});

test("builds video submit endpoint from root, v1, or full endpoint base urls", () => {
  assert.equal(buildVideoEndpointUrl("https://video.example.test"), "https://video.example.test/v1/videos");
  assert.equal(buildVideoEndpointUrl("https://video.example.test/v1"), "https://video.example.test/v1/videos");
  assert.equal(buildVideoEndpointUrl("https://video.example.test/v1/videos"), "https://video.example.test/v1/videos");
});

test("builds video query endpoint without exposing raw task ids in public output", () => {
  assert.equal(buildVideoQueryUrl("https://video.example.test/v1", "task id/1"), "https://video.example.test/v1/videos/task%20id%2F1");
});

test("resolves video resume task id from explicit env before cached task metadata", () => {
  assert.deepEqual(resolveVideoTaskId({ VIDEO_SMOKE_TASK_ID: " explicit-task " }, { taskId: "cached-task" }), {
    taskId: "explicit-task",
    source: "env",
  });
  assert.deepEqual(resolveVideoTaskId({}, { taskId: " cached-task " }), {
    taskId: "cached-task",
    source: "cache",
  });
  assert.equal(resolveVideoTaskId({}, null), null);
});

test("summarizes video task payload without leaking task ids or result urls", () => {
  const summary = summarizeVideoTaskPayload({
    id: "secret-task-id",
    status: "queued",
    progress: 0,
    result: { url: "https://video.example.test/private/result.mp4" },
  });

  assert.deepEqual(summary, {
    status: "processing",
    progress: 0,
    hasResultUrl: true,
  });
  assert.doesNotMatch(JSON.stringify(summary), /secret-task-id/);
  assert.doesNotMatch(JSON.stringify(summary), /https:\/\/video\.example\.test/);
});

test("classifies long-running queued video tasks as stuck instead of generic timeout", () => {
  assert.equal(classifyVideoWaitFailure({ lastStatus: "processing", hasTaskId: true }), "video_task_stuck");
  assert.equal(classifyVideoWaitFailure({ lastStatus: "unknown", hasTaskId: true }), "video_task_timeout");
  assert.equal(classifyVideoWaitFailure({ lastStatus: "processing", hasTaskId: false }), "video_task_timeout");
});

test("validates MP4 buffers by ftyp box", () => {
  const mp4 = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(16)]);
  const validation = validateMp4Buffer(mp4);
  assert.equal(validation.valid, true);
  assert.equal(validation.mime, "video/mp4");

  const invalid = validateMp4Buffer(Buffer.from("not a video"));
  assert.equal(invalid.valid, false);
});

test("video smoke fails without env and does not leak credentials", () => {
  const env = { ...process.env, SHANHAI_VIDEO_SKIP_DOTENV: "1" };
  delete env.OCTO_API_KEY;
  delete env.OCTO_BASE_URL;

  const result = spawnSync(process.execPath, ["scripts/video-smoke.mjs"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 5000,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /missing_VIDEO_PROVIDER_ENV/);
  assert.doesNotMatch(result.stdout, /Bearer\s+[A-Za-z0-9._-]+/);
  assert.doesNotMatch(result.stderr, /Bearer\s+[A-Za-z0-9._-]+/);
  assert.doesNotMatch(result.stdout, /https:\/\/.+/);
  assert.doesNotMatch(result.stderr, /https:\/\/.+/);
});

test("video smoke failure output does not leak selected channel credentials", () => {
  const env = {
    ...process.env,
    SHANHAI_VIDEO_SKIP_DOTENV: "1",
    OCTO_API_KEY: "test-video-key-do-not-print",
    OCTO_BASE_URL: "http://127.0.0.1:9",
    VIDEO_SMOKE_TIMEOUT_MS: "1000",
  };

  const result = spawnSync(process.execPath, ["scripts/video-smoke.mjs"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 5000,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /video_smoke_failed/);
  assert.match(result.stdout, /"reason":"video_/);
  assert.doesNotMatch(result.stdout, /test-video-key-do-not-print/);
  assert.doesNotMatch(result.stdout, /127\.0\.0\.1/);
  assert.doesNotMatch(result.stderr, /test-video-key-do-not-print/);
  assert.doesNotMatch(result.stderr, /127\.0\.0\.1/);
});
