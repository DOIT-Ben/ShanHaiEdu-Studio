import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import {
  buildImageGenerationsUrl,
  extractImageResult,
  validateImageBuffer,
} from "../scripts/image-smoke.mjs";

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

test("extracts image result from b64 and url responses", () => {
  const b64 = extractImageResult({ data: [{ b64_json: tinyPngBase64 }] });
  assert.equal(b64.kind, "b64");
  assert.equal(Buffer.isBuffer(b64.buffer), true);

  const url = extractImageResult({ data: [{ url: "https://image.example.test/generated" }] });
  assert.equal(url.kind, "url");
  assert.equal(url.url, "https://image.example.test/generated");
});

test("validates PNG and JPEG image buffers", () => {
  const png = validateImageBuffer(Buffer.from(tinyPngBase64, "base64"));
  assert.equal(png.valid, true);
  assert.equal(png.mime, "image/png");

  const jpeg = validateImageBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]));
  assert.equal(jpeg.valid, true);
  assert.equal(jpeg.mime, "image/jpeg");

  const invalid = validateImageBuffer(Buffer.from("not an image"));
  assert.equal(invalid.valid, false);
});

test("builds image generations endpoint from root, v1, or full endpoint base urls", () => {
  assert.equal(
    buildImageGenerationsUrl("https://image.example.test"),
    "https://image.example.test/v1/images/generations",
  );
  assert.equal(
    buildImageGenerationsUrl("https://image.example.test/v1"),
    "https://image.example.test/v1/images/generations",
  );
  assert.equal(
    buildImageGenerationsUrl("https://image.example.test/v1/images/generations"),
    "https://image.example.test/v1/images/generations",
  );
});

test("image smoke fails without env and does not leak credentials", () => {
  const env = { ...process.env, SHANHAI_IMAGE_SKIP_DOTENV: "1", IMAGE_PROVIDER_CHANNEL: "primary" };
  delete env.IMAGEGEN_MYSELF_PRIMARY_API_KEY;
  delete env.IMAGEGEN_MYSELF_PRIMARY_BASE_URL;
  delete env.IMAGEGEN_FREE_API_KEY;
  delete env.IMAGEGEN_FREE_BASE_URL;

  const result = spawnSync(process.execPath, ["scripts/image-smoke.mjs"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 5000,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /missing_IMAGE_PROVIDER_ENV/);
  assert.doesNotMatch(result.stdout, /Bearer\s+[A-Za-z0-9._-]+/);
  assert.doesNotMatch(result.stderr, /Bearer\s+[A-Za-z0-9._-]+/);
  assert.doesNotMatch(result.stdout, /https:\/\/.+/);
  assert.doesNotMatch(result.stderr, /https:\/\/.+/);
});

test("image smoke can select the fixed free ledger channel without leaking it", () => {
  const env = {
    ...process.env,
    SHANHAI_IMAGE_SKIP_DOTENV: "1",
    IMAGE_PROVIDER_CHANNEL: "free",
    IMAGEGEN_FREE_API_KEY: "test-free-image-key-do-not-print",
    IMAGEGEN_FREE_BASE_URL: "http://127.0.0.1:9",
    IMAGE_SMOKE_TIMEOUT_MS: "1000",
  };
  delete env.IMAGEGEN_MYSELF_PRIMARY_API_KEY;
  delete env.IMAGEGEN_MYSELF_PRIMARY_BASE_URL;

  const result = spawnSync(process.execPath, ["scripts/image-smoke.mjs"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 5000,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /image_smoke_failed/);
  assert.match(result.stdout, /"channel":"free"/);
  assert.doesNotMatch(result.stdout, /test-free-image-key-do-not-print/);
  assert.doesNotMatch(result.stdout, /127\.0\.0\.1/);
  assert.doesNotMatch(result.stderr, /test-free-image-key-do-not-print/);
  assert.doesNotMatch(result.stderr, /127\.0\.0\.1/);
});
