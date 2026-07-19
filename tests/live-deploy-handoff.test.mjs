import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();

test("release roadmap defers live deployment while preserving real readiness and rollback gates", () => {
  const roadmapPath = path.join(root, "docs", "roadmap", "release", "README.md");
  const runbookPath = path.join(root, "docs", "roadmap", "release", "v1-invited-release-recovery.md");
  assert.equal(existsSync(roadmapPath), true);
  assert.equal(existsSync(runbookPath), true);

  const roadmap = readFileSync(roadmapPath, "utf8");
  const runbook = readFileSync(runbookPath, "utf8");
  assert.match(roadmap, /当前产品优先深度重构关闭、重新规划并通过唯一V1-9真实全链路后/);
  assert.match(roadmap, /不得提前启动/);
  assert.match(roadmap, /V1-9通过后仍需当次授权/);
  assert.match(runbook, /npm run preflight:production/);
  assert.match(runbook, /反向代理|nginx|reverse proxy/i);
  assert.match(runbook, /HTTPS/);
  assert.match(runbook, /Provider\s*配置存在/);
  assert.match(runbook, /\/api\/health/);
  assert.match(runbook, /代码 Release 回滚/);
  assert.match(runbook, /deploy\/switch-v1-container\.sh/);
});
