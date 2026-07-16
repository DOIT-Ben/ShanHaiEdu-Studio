import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();
const scriptPath = path.join(root, "deploy", "switch-v1-container.sh");

test("V1 release switch is serialized and preflights before stopping the current container", () => {
  assert.equal(existsSync(scriptPath), true, "deploy/switch-v1-container.sh must exist");
  const source = readFileSync(scriptPath, "utf8");

  assert.match(source, /^#!\/usr\/bin\/env bash$/m);
  assert.match(source, /set -Eeuo pipefail/);
  assert.match(source, /flock -n/);
  assert.match(source, /release_switch_locked/);
  assert.match(source, /missing_argument_value/);
  assert.match(source, /production-preflight\.mjs/);

  const preflightIndex = source.indexOf("production-preflight.mjs");
  const stopIndex = source.indexOf('docker stop --time "$STOP_TIMEOUT_SECONDS" "$CONTAINER_NAME"');
  assert.ok(preflightIndex >= 0 && stopIndex > preflightIndex, "candidate preflight must run before the current container is stopped");
  const trapIndex = source.indexOf("trap handle_unexpected_error ERR INT TERM");
  assert.ok(trapIndex >= 0 && trapIndex < stopIndex, "rollback trap must be active before the current container is stopped");
  assert.match(source, /previous_ready/);
});

test("V1 release switch preserves the compose security and storage contract", () => {
  const source = readFileSync(scriptPath, "utf8");

  for (const contract of [
    '--user "$CONTAINER_USER"',
    "--cap-drop ALL",
    "--security-opt no-new-privileges:true",
    '--env-file "$ENV_FILE"',
    '127.0.0.1:${HOST_PORT}:3210',
    '${SHARED_DATA_ROOT}:/srv/shanhai/data',
    '${SHARED_ARTIFACT_ROOT}:/srv/shanhai/artifacts',
    "--health-cmd",
    "--health-interval 15s",
    "--health-timeout 5s",
    "--health-start-period 30s",
    "--health-retries 8",
  ]) {
    assert.match(source, new RegExp(escapeRegExp(contract)), contract);
  }

  assert.doesNotMatch(source, /--privileged/);
  assert.doesNotMatch(source, /network_mode|--network host/);
  assert.doesNotMatch(source, /docker logs/);
  assert.doesNotMatch(source, /release:data:restore|database-target|artifacts-target/);
});

test("V1 release switch requires both Docker health and HTTP readiness and has one rollback path", () => {
  const source = readFileSync(scriptPath, "utf8");

  assert.match(source, /\.State\.Health\.Status/);
  assert.match(source, /\.State\.Status/);
  assert.match(source, /exited\|dead/);
  assert.match(source, /\/api\/health/);
  assert.match(source, /\[ "\$docker_health" = "healthy" \] && \[ "\$http_status" = "200" \]/);
  assert.match(source, /already_current/);
  assert.match(source, /rollback_started/);
  assert.match(source, /rollback_succeeded/);
  assert.match(source, /rollback_failed/);
  assert.match(source, /docker rename "\$previous_name" "\$CONTAINER_NAME"/);
  assert.match(source, /docker rm -f "\$CONTAINER_NAME"/);
});

test("V1 release switch is exposed by the release runbook without embedding target secrets", () => {
  const runbook = readFileSync(path.join(root, "docs", "roadmap", "release", "v1-invited-release-recovery.md"), "utf8");
  assert.match(runbook, /deploy\/switch-v1-container\.sh/);
  assert.match(runbook, /flock|互斥/);
  assert.match(runbook, /Docker Health/);

  const source = readFileSync(scriptPath, "utf8");
  assert.doesNotMatch(source, /sk-[A-Za-z0-9_-]+/);
  assert.doesNotMatch(source, /OPENAI_API_KEY=|MINIMAX_API_KEY=|COZE_API_TOKEN=/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
