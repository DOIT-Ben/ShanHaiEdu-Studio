import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
}

function includes(relativePath, text) {
  return read(relativePath).includes(text);
}

const checks = [
  {
    id: "backend-workbench-api",
    owner: "Backend Workflow Lite",
    ok: exists("src/app/api/workbench"),
    required: "src/app/api/workbench must expose project/message/artifact/snapshot routes.",
  },
  {
    id: "agent-runtime-deterministic",
    owner: "Agent Runtime Adapter",
    ok: exists("src/server/agent-runtime") && includes("src/server/agent-runtime/index.ts", "Deterministic"),
    required: "src/server/agent-runtime must expose a deterministic runtime through the server boundary.",
  },
  {
    id: "frontend-api-backed-shell",
    owner: "Frontend API-backed Workbench",
    ok:
      !includes("src/components/layout/MediaWorkbench.tsx", "@/lib/mock-data") &&
      !includes("src/hooks/useWorkbenchController.ts", "@/lib/mock-data"),
    required: "Workbench shell must use an API-backed controller instead of the local mock data source.",
  },
  {
    id: "project-snapshot-contract",
    owner: "Backend Workflow Lite / Frontend API-backed Workbench",
    ok:
      includes("src/lib/workbench-api.ts", "snapshot") ||
      exists("src/app/api/workbench/projects") ||
      exists("src/app/api/workbench/projects/[projectId]/snapshot"),
    required: "A project snapshot contract must exist before refresh recovery can be verified.",
  },
];

const blockers = checks.filter((check) => !check.ok);
const result = {
  ok: blockers.length === 0,
  checkedAt: new Date().toISOString(),
  checks,
  blockers,
};

console.log(JSON.stringify(result, null, 2));

if (blockers.length > 0) {
  console.error(
    `Stage 2 preflight blocked: ${blockers.length} prerequisite(s) missing. See blockers[].owner and blockers[].required.`,
  );
  process.exit(1);
}
