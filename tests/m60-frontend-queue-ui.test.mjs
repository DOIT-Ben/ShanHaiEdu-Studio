import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("M60 frontend separates short submit state from long project generation state", () => {
  const controllerSource = readSource("src/hooks/useWorkbenchController.ts");
  const stateSource = readSource("src/hooks/useWorkbenchProjectState.ts");
  const composerControllerSource = readSource("src/hooks/useWorkbenchComposerController.ts");
  const composerSource = readSource("src/components/conversation/PromptComposer.tsx");
  const workbenchSource = readSource("src/components/conversation/ConversationWorkbench.tsx");

  assert.match(controllerSource, /const \[composerSubmitting, setComposerSubmitting\] = useState\(false\)/);
  assert.match(stateSource, /const projectBusy = useMemo\(/);
  assert.doesNotMatch(controllerSource, /if \(sendingRef\.current \|\| sending\) \{/);
  assert.match(composerControllerSource, /if \(!activeProjectId \|\| composerSubmittingRef\.current \|\| composerSubmitting\) return/);
  assert.match(controllerSource, /composerSubmitting,/);
  assert.match(stateSource, /projectBusy,/);

  assert.match(composerSource, /composerSubmitting: boolean/);
  assert.match(composerSource, /projectBusy: boolean/);
  assert.match(composerSource, /disabled=\{composerSubmitting\}/);
  assert.doesNotMatch(composerSource, /<Textarea[\s\S]*disabled=\{projectBusy\}/);
  assert.doesNotMatch(composerSource, /上一条还在回复/);

  assert.match(workbenchSource, /composerSubmitting=\{composerSubmitting\}/);
  assert.match(workbenchSource, /projectBusy=\{projectBusy\}/);
});

test("M60 frontend maps persisted turn jobs to teacher-readable queue labels", () => {
  const typesSource = readSource("src/lib/types.ts");
  const mapperSource = readSource("src/lib/workbench-mappers.ts");
  const transcriptSource = readSource("src/components/conversation/assistant-ui/ShanHaiThread.tsx");
  const indicatorSource = readSource("src/components/conversation/messages/GeneratingIndicator.tsx");

  assert.match(typesSource, /ConversationTurnJobStatus = "queued" \| "running" \| "succeeded" \| "failed" \| "canceled" \| "blocked"/);
  assert.match(typesSource, /turnJobs: ConversationTurnJob\[\]/);
  assert.match(typesSource, /turnStatus\?: ConversationTurnJobStatus/);

  assert.match(mapperSource, /turnJobs\?: BackendConversationTurnJobRecord\[\]/);
  assert.match(mapperSource, /queued:\s*"排队中"/);
  assert.match(mapperSource, /running:\s*"正在生成"/);

  assert.match(transcriptSource, /custom\.turnStatusLabel/);
  assert.match(transcriptSource, /data-turn-status/);
  assert.match(indicatorSource, /排队中/);
  assert.match(indicatorSource, /正在生成/);
});

test("M60 refreshes queued turns through versioned snapshots and disables polling for assistant-ui events", () => {
  const controllerSource = readSource("src/hooks/useWorkbenchProjectSync.ts");
  const stateSource = readSource("src/hooks/useWorkbenchProjectState.ts");
  const refreshSource = `${controllerSource}\n${stateSource}`;

  assert.match(controllerSource, /const snapshotPollingIntervalMs = \d+/);
  assert.match(stateSource, /function hasPendingTurnStatus/);
  assert.match(refreshSource, /status === "queued" \|\| status === "running"/);
  assert.match(controllerSource, /if \(eventDrivenMessages \|\| !activeProjectId \|\| !projectBusy \|\| composerSubmitting/);
  assert.match(controllerSource, /window\.setTimeout\(async \(\) => \{[\s\S]*beginSnapshotRequest\(activeProjectId\)[\s\S]*dataSource\.getProjectSnapshot\(activeProjectId\)[\s\S]*applySnapshot\(snapshot, snapshotRequest\)[\s\S]*scheduleNextSnapshotRefresh\(\)/s);
  assert.match(controllerSource, /eventSnapshotCoordinatorRef\.current\?\.request\(\{ projectId: event\.projectId, requiredSequence: event\.sequence \}\)/);
  assert.match(controllerSource, /window\.clearTimeout\(snapshotPollingTimer\)/);
});

test("M60 teacher visible queue UI avoids internal engineering words", () => {
  const visibleSources = [
    "src/components/conversation/PromptComposer.tsx",
    "src/components/conversation/ConversationWorkbench.tsx",
    "src/components/conversation/assistant-ui/ShanHaiThread.tsx",
    "src/components/conversation/messages/GeneratingIndicator.tsx",
  ];

  const forbidden = [
    /schema/i,
    /provider/i,
    /node_id/i,
    /storage/i,
    /debug/i,
    /local path/i,
    /capabilityId/i,
    /runtimeKind/i,
    /providerStatus/i,
  ];

  for (const relativePath of visibleSources) {
    const source = readSource(relativePath);
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${relativePath} should not expose ${pattern}`);
    }
  }
});
