import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, "utf8") : "";
}

function includes(relativePath, text) {
  return read(relativePath).includes(text);
}

function includesAll(relativePath, values) {
  const content = read(relativePath);
  return values.every((value) => content.includes(value));
}

const requiredRuntimeTasks = [
  "textbook_evidence",
  "lesson_plan",
  "ppt_outline",
  "intro_video_plan",
  "final_delivery_checklist",
];

const requiredWorkflowNodes = [
  "textbook_evidence",
  "lesson_plan",
  "ppt_draft",
  "intro_video_plan",
  "image_prompts",
  "video_storyboard",
  "final_delivery",
];

const messageRoute = "src/app/api/workbench/projects/[projectId]/messages/route.ts";
const workbenchApi = "src/lib/workbench-api.ts";

const checks = [
  {
    id: "runtime-stage3-tasks",
    owner: "Agent Runtime Adapter",
    ok: includesAll("src/server/agent-runtime/types.ts", requiredRuntimeTasks) &&
      includesAll("src/server/agent-runtime/deterministic-runtime.ts", requiredRuntimeTasks),
    required: "DeterministicRuntime must support all Stage 3 text tasks.",
    canE2EBypass: false,
  },
  {
    id: "workflow-stage3-nodes",
    owner: "Backend Workflow Lite",
    ok: includesAll("src/server/workbench/workflow-defaults.ts", requiredWorkflowNodes),
    required: "Backend workflow defaults must expose every Stage 3 node.",
    canE2EBypass: false,
  },
  {
    id: "runtime-workflow-key-mapping",
    owner: "Backend Workflow Lite / Agent Runtime Adapter",
    ok: includes(messageRoute, "ppt_outline") && includes(messageRoute, "ppt_draft") &&
      includes(messageRoute, "final_delivery_checklist") && includes(messageRoute, "final_delivery"),
    required: "The server boundary must map runtime tasks such as ppt_outline/final_delivery_checklist to workflow nodes such as ppt_draft/final_delivery.",
    canE2EBypass: false,
  },
  {
    id: "multi-node-progressor",
    owner: "Backend Workflow Lite",
    ok: includes(messageRoute, "textbook_evidence") && includes(messageRoute, "lesson_plan") &&
      includes(messageRoute, "intro_video_plan") && !includes(messageRoute, 'task: "requirement_spec"'),
    required: "Message or workflow API must advance beyond the hard-coded requirement_spec task after upstream confirmation.",
    canE2EBypass: false,
  },
  {
    id: "frontend-multi-artifact-display",
    owner: "Frontend API-backed Workbench",
    ok: includes(workbenchApi, "normalizeSnapshot") && includes(workbenchApi, "artifacts") &&
      includes(workbenchApi, "textbook_evidence") && includes(workbenchApi, "lesson_plan") &&
      includes(workbenchApi, "intro_video_plan"),
    required: "Frontend API client must normalize and display multiple backend artifacts.",
    canE2EBypass: false,
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
  console.error(`Stage 3 preflight blocked: ${blockers.length} prerequisite(s) missing.`);
  process.exit(1);
}
