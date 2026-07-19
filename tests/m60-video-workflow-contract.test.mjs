import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

const videoNodeKeys = [
  "knowledge_anchor_extract",
  "creative_theme_generate",
  "video_script_generate",
  "storyboard_generate",
  "asset_brief_generate",
  "asset_image_generate",
  "video_segment_plan",
  "video_segment_generate",
  "video_narration_generate",
  "concat_only_assemble",
];

test("M60 registers atomic video capabilities without a fixed requirement-spec prerequisite", () => {
  const workbenchTypes = readSource("src/server/workbench/types.ts");
  const workflowDefaults = readSource("src/server/workbench/workflow-defaults.ts");
  const capabilityTypes = readSource("src/server/capabilities/types.ts");
  const registrySource = readSource("src/server/capabilities/capability-registry.ts");
  const plannerSource = readSource("src/server/capabilities/capability-planner.ts");

  for (const nodeKey of videoNodeKeys) {
    assert.match(workbenchTypes, new RegExp(`\\| "${nodeKey}"`));
    assert.match(workflowDefaults, new RegExp(`key: "${nodeKey}"`));
    assert.match(capabilityTypes, new RegExp(`\\| "${nodeKey}"`));
    assert.match(registrySource, new RegExp(`id: "${nodeKey}"`));
    assert.match(plannerSource, new RegExp(`"${nodeKey}"`));
  }

  assert.match(registrySource, /id: "knowledge_anchor_extract"[\s\S]*inputSchema: \{ required: \["taskBrief"\] \}[\s\S]*upstreamCapabilities: \[\]/);
  assert.match(registrySource, /id: "creative_theme_generate"[\s\S]*inputSchema: \{ required: \["taskBrief"\] \}[\s\S]*upstreamCapabilities: \[\]/);
  assert.match(registrySource, /id: "video_script_generate"[\s\S]*upstreamCapabilities: \["creative_theme_generate"\]/);
  assert.match(registrySource, /id: "storyboard_generate"[\s\S]*upstreamCapabilities: \["video_script_generate"\]/);
  assert.match(registrySource, /id: "asset_image_generate"[\s\S]*upstreamCapabilities: \["asset_brief_generate"\]/);
  assert.match(registrySource, /id: "video_segment_generate"[\s\S]*upstreamCapabilities: \["video_segment_plan", "storyboard_generate", "asset_image_generate"\]/);
  assert.match(registrySource, /id: "video_narration_generate"[\s\S]*upstreamCapabilities: \["video_script_generate"\]/);
  assert.match(registrySource, /id: "concat_only_assemble"[\s\S]*upstreamCapabilities: \["video_segment_generate", "storyboard_generate", "video_script_generate", "video_narration_generate"\]/);
});

test("M60 runtime guidance requires structured video pre-artifacts before segment generation", () => {
  const runtimeTypes = readSource("src/server/agent-runtime/types.ts");
  const guidanceSource = readSource("src/server/agent-runtime/task-guidance.ts");
  const deterministicSource = readSource("src/server/agent-runtime/deterministic-runtime.ts");
  const openaiSource = readSource("src/server/agent-runtime/openai-runtime.ts");

  for (const task of [
    "knowledge_anchor_extract",
    "creative_theme_generate",
    "video_script_generate",
    "storyboard_generate",
    "asset_brief_generate",
    "video_segment_plan",
    "concat_only_assemble",
  ]) {
    assert.match(runtimeTypes, new RegExp(`\\| "${task}"`));
    assert.match(guidanceSource, new RegExp(`${task}: \\{`));
  }

  for (const requiredTerm of ["最小课程锚点", "独立创意", "视频脚本", "分镜", "资产", "每镜头时长", "课堂边界约束", "只拼接"]) {
    assert.match(guidanceSource, new RegExp(requiredTerm));
    assert.match(openaiSource, new RegExp(requiredTerm));
  }

  assert.doesNotMatch(openaiSource, /按知识锚点、创意主题/);
  assert.doesNotMatch(guidanceSource, /知识锚点是否来自结构化教案/);

  for (const teacherVisibleSource of [guidanceSource, deterministicSource, openaiSource]) {
    assert.doesNotMatch(teacherVisibleSource, /provider 限制|视频 provider|调用视频 provider/);
  }
});

test("M60/M68 does not let deterministic execution masquerade as real video assets or assembly", () => {
  const registrySource = readSource("src/server/capabilities/capability-registry.ts");
  const runnerSource = readSource("src/server/capabilities/capability-runner.ts");
  const conversationTurnSource = readSource("src/server/conversation/conversation-turn-service.ts");
  const toolRegistrySource = readSource("src/server/tools/tool-registry.ts");
  const toolRouterSource = readSource("src/server/tools/tool-router.ts");

  assert.match(registrySource, /id: "asset_image_generate"[\s\S]*providerMode: "external"[\s\S]*deterministicFallback: "blocked"/);
  assert.match(registrySource, /id: "concat_only_assemble"[\s\S]*providerMode: "package"[\s\S]*deterministicFallback: "blocked"/);
  assert.match(runnerSource, /generationMode === "deterministic_draft"[\s\S]*deterministicFallback === "blocked"/);
  assert.match(runnerSource, /deterministic_runtime_blocked_real_asset/);
  assert.match(toolRegistrySource, /function providerTool[\s\S]*adapterKind: "provider"[\s\S]*implemented: true/);
  assert.match(toolRegistrySource, /providerTool\(\{[\s\S]*id: "asset_image_generate"[\s\S]*producedArtifactKind: "asset_image_generate"/);
  assert.match(toolRegistrySource, /function packageTool[\s\S]*adapterKind: "package"[\s\S]*implemented: true/);
  assert.match(toolRegistrySource, /packageTool\(\{[\s\S]*id: "concat_only_assemble"[\s\S]*producedArtifactKind: "concat_only_assemble"/);
  assert.match(toolRegistrySource, /id: "intro_video"[\s\S]*blockedReason:/);
  assert.match(toolRouterSource, /!tool\.implemented \|\| tool\.blockedReason/);
  assert.match(toolRouterSource, /artifactCreated: false/);
  assert.match(conversationTurnSource, /listToolDefinitions\(\)[\s\S]*input\.toolRouter/);
});

test("M60 Evolink provider profile is conservative and does not claim start/end frame support", () => {
  const videoRunSource = readSource("src/server/video-generation/video-generation-run.ts");

  assert.match(videoRunSource, /EVOLINK_GROK_IMAGINE_VIDEO_PROVIDER_PROFILE/);
  assert.match(videoRunSource, /textToVideoModel:\s*"grok-imagine-text-to-video-beta"/);
  assert.match(videoRunSource, /imageToVideoModel:\s*"grok-imagine-image-to-video-beta"/);
  assert.match(videoRunSource, /imageUrls:\s*\{\s*min:\s*1,\s*max:\s*7\s*\}/);
  assert.match(videoRunSource, /durationSeconds:\s*\{\s*min:\s*6,\s*max:\s*30\s*\}/);
  assert.match(videoRunSource, /startEndFrame:\s*"unverified"/);
  assert.match(videoRunSource, /resultUrlTtlHours:\s*24/);
  assert.match(videoRunSource, /concurrency:\s*"low"/);
  assert.doesNotMatch(videoRunSource, /startEndFrame:\s*"supported"/);
});

test("M60 refuses to call the video provider without required upstream artifacts", () => {
  const videoRunSource = readSource("src/server/video-generation/video-generation-run.ts");
  const routeSource = readSource("src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/video/route.ts");

  assert.match(videoRunSource, /assertVideoProviderPreconditions/);
  assert.match(videoRunSource, /missing_video_workflow_preconditions/);
  assert.match(videoRunSource, /video_segment_plan/);
  assert.match(videoRunSource, /artifact\.isApproved/);
  assert.match(videoRunSource, /artifact\.status !== "approved"/);
  assert.match(videoRunSource, /asset_image_generate/);
  assert.match(videoRunSource, /storyboard_generate/);
  assert.match(routeSource, /assertVideoProviderPreconditions/);
  assert.ok(
    routeSource.indexOf("assertVideoProviderPreconditions") < routeSource.indexOf("createGenerationJob"),
    "video route must gate source video_segment_plan approval before creating a generation job",
  );
  assert.doesNotMatch(routeSource, /sourceArtifact\.nodeKey !== "intro_video_plan"/);
});
