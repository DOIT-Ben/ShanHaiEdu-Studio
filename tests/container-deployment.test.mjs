import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();

test("V1 container deployment keeps one non-root process and external shared data", () => {
  const dockerfilePath = path.join(root, "Dockerfile");
  const ignorePath = path.join(root, ".dockerignore");
  const composePath = path.join(root, "deploy", "v1-compose.yml");
  const runtimePreflightPath = path.join(root, "scripts", "container-runtime-preflight.mjs");
  for (const file of [dockerfilePath, ignorePath, composePath, runtimePreflightPath]) {
    assert.equal(existsSync(file), true, `${path.basename(file)} must exist`);
  }

  const dockerfile = readFileSync(dockerfilePath, "utf8");
  assert.match(dockerfile, /^FROM node:22-bookworm-slim/m);
  for (const dependency of ["ffmpeg", "libreoffice-impress", "poppler-utils", "curl", "fonts-noto-cjk", "tini"]) {
    assert.match(dockerfile, new RegExp(`\\b${dependency}\\b`));
  }
  assert.match(dockerfile, /ARG NEXT_PUBLIC_SHANHAI_AUTH_MODE=password/);
  assert.match(dockerfile, /ARG NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED=0/);
  assert.match(dockerfile, /npm run preflight:container-runtime/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /tini.+node.+\.next\/standalone\/server\.js/s);
  assert.doesNotMatch(dockerfile, /COPY\s+\.env/i);

  const ignore = readFileSync(ignorePath, "utf8");
  for (const entry of [".env*", "node_modules", ".next", "data", "artifact-storage-root", "API台账系统/PRIVATE-LOCAL-SECRETS", "test-results"]) {
    assert.match(ignore, new RegExp(`^${escapeRegExp(entry)}(?:/|$)`, "m"));
  }

  const compose = readFileSync(composePath, "utf8");
  assert.match(compose, /127\.0\.0\.1:\$\{SHANHAI_STAGING_PORT:-3210\}:3210/);
  assert.match(compose, /SHANHAI_APP_INSTANCE_COUNT:\s*"1"/);
  assert.match(compose, /SHANHAI_AUTH_MODE:\s*password/);
  assert.match(compose, /NEXT_PUBLIC_SHANHAI_AUTH_MODE:\s*password/);
  assert.match(compose, /SHANHAI_TRUST_PROXY:\s*"1"/);
  assert.match(compose, /SHANHAI_PUBLIC_REGISTRATION_ENABLED:\s*"0"/);
  assert.match(compose, /NEXT_PUBLIC_SHANHAI_PUBLIC_REGISTRATION_ENABLED:\s*"0"/);
  assert.match(compose, /DATABASE_URL:\s*file:\/srv\/shanhai\/data\/production\.db/);
  assert.match(compose, /ARTIFACT_STORAGE_ROOT:\s*\/srv\/shanhai\/artifacts/);
  assert.match(compose, /SHANHAI_SHARED_DATA_ROOT:\?[^}]+/);
  assert.match(compose, /SHANHAI_SHARED_ARTIFACT_ROOT:\?[^}]+/);
  assert.match(compose, /SHANHAI_ENV_FILE:\?[^}]+/);
  assert.match(compose, /user:\s*"1000:1000"/);
  assert.match(compose, /cap_drop:\s*\n\s*- ALL/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /healthcheck:/);
  assert.doesNotMatch(compose, /network_mode:\s*host/);
  assert.doesNotMatch(compose, /privileged:\s*true/);

  const preflight = readFileSync(runtimePreflightPath, "utf8");
  for (const binary of ["ffmpeg", "ffprobe", "soffice", "pdfinfo", "pdftoppm", "curl", "fc-match"]) {
    assert.match(preflight, new RegExp(`"${escapeRegExp(binary)}"`));
  }
  assert.match(preflight, /20\.19/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
