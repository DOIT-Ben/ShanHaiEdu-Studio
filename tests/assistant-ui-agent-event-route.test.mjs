import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("assistant-ui consumes a read-only resumable teacher-safe event stream", () => {
  const routePath = "src/app/api/workbench/projects/[projectId]/events/route.ts";
  const hookPath = "src/components/conversation/assistant-ui/useProjectAgentEvents.ts";
  assert.equal(existsSync(path.join(root, routePath)), true);
  assert.equal(existsSync(path.join(root, hookPath)), true);

  const route = read(routePath);
  const snapshotRoute = read("src/app/api/workbench/projects/[projectId]/snapshot/route.ts");
  const hook = read(hookPath);
  const runtime = read("src/components/conversation/assistant-ui/ShanHaiAssistantRuntime.tsx");
  const workbench = read("src/components/conversation/ConversationWorkbench.tsx");

  assert.match(route, /withLocalWorkbenchActor/);
  assert.match(route, /service\.getProject\(projectId\)/);
  assert.match(route, /listEvents\(projectId/);
  assert.match(route, /projectTeacherAgentEvent/);
  assert.match(route, /text\/event-stream/);
  assert.match(route, /afterSequence/);
  assert.match(route, /last-event-id/i);
  assert.match(route, /waitForProjectAgentEvent/);
  assert.doesNotMatch(route, /waitForNextPoll\([^,]+,\s*750\)/);
  assert.doesNotMatch(route, /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)/);
  assert.match(snapshotRoute, /getLatestEventSequence\(projectId\)[\s\S]*getProjectSnapshot\(projectId\)/);
  assert.match(snapshotRoute, /agentEventSequence/);

  assert.match(hook, /new EventSource/);
  assert.match(hook, /source\.onerror/);
  assert.match(hook, /source\.onopen/);
  assert.match(hook, /confirmProjectAgentEventCursor/);
  assert.match(hook, /parseTeacherAgentEvent/);
  assert.match(hook, /appendTeacherAgentEvent/);
  assert.match(runtime, /useProjectAgentEvents/);
  assert.match(runtime, /mergeTeacherAgentEventsIntoMessages/);
  assert.doesNotMatch(workbench, /useProjectAgentEvents|new EventSource/);
});
