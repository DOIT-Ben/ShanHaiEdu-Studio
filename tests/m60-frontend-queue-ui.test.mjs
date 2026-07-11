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
  const composerSource = readSource("src/components/conversation/PromptComposer.tsx");
  const workbenchSource = readSource("src/components/conversation/ConversationWorkbench.tsx");

  assert.match(controllerSource, /const \[composerSubmitting, setComposerSubmitting\] = useState\(false\)/);
  assert.match(controllerSource, /const projectBusy = useMemo\(/);
  assert.doesNotMatch(controllerSource, /if \(sendingRef\.current \|\| sending\) \{/);
  assert.match(controllerSource, /if \(composerSubmittingRef\.current \|\| composerSubmitting\) \{/);
  assert.match(controllerSource, /composerSubmitting,/);
  assert.match(controllerSource, /projectBusy,/);

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
  const transcriptSource = readSource("src/components/conversation/ChatTranscript.tsx");
  const indicatorSource = readSource("src/components/conversation/messages/GeneratingIndicator.tsx");

  assert.match(typesSource, /ConversationTurnJobStatus = "queued" \| "running" \| "succeeded" \| "failed" \| "canceled" \| "blocked"/);
  assert.match(typesSource, /turnJobs: ConversationTurnJob\[\]/);
  assert.match(typesSource, /turnStatus\?: ConversationTurnJobStatus/);

  assert.match(mapperSource, /turnJobs\?: BackendConversationTurnJobRecord\[\]/);
  assert.match(mapperSource, /queued:\s*"排队中"/);
  assert.match(mapperSource, /running:\s*"正在生成"/);

  assert.match(transcriptSource, /message\.turnStatusLabel/);
  assert.match(transcriptSource, /data-turn-status/);
  assert.match(indicatorSource, /排队中/);
  assert.match(indicatorSource, /正在生成/);
});

test("M60 frontend keeps refreshing snapshots while a turn is queued or running", () => {
  const controllerSource = readSource("src/hooks/useWorkbenchController.ts");

  assert.match(controllerSource, /const snapshotPollingIntervalMs = \d+/);
  assert.match(controllerSource, /function hasPendingTurnStatus/);
  assert.match(controllerSource, /status === "queued" \|\| status === "running"/);
  assert.match(controllerSource, /useEffect\(\(\) => \{[\s\S]*!projectBusy[\s\S]*composerSubmitting[\s\S]*return/s);
  assert.match(controllerSource, /window\.setTimeout\(async \(\) => \{[\s\S]*dataSource\.getProjectSnapshot\(activeProjectId\)[\s\S]*applySnapshot\(snapshot\)[\s\S]*scheduleNextSnapshotRefresh\(\)/s);
  assert.match(controllerSource, /window\.clearTimeout\(snapshotPollingTimer\)/);
});

test("M60 teacher visible queue UI avoids internal engineering words", () => {
  const visibleSources = [
    "src/components/conversation/PromptComposer.tsx",
    "src/components/conversation/ConversationWorkbench.tsx",
    "src/components/conversation/ChatTranscript.tsx",
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
