import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { require as requireTypeScript } from "tsx/cjs/api";

const root = process.cwd();

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function loadTypeScriptModule(relativePath) {
  return requireTypeScript(path.join(root, relativePath), import.meta.url);
}

const { getCapabilityDefinitions } = loadTypeScriptModule("src/server/capabilities/capability-registry.ts");
const { listToolDefinitions } = loadTypeScriptModule("src/server/tools/tool-registry.ts");

const videoCapabilityIds = [
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

test("M60 registers independently callable video capabilities without a fixed requirement-spec prerequisite", () => {
  const capabilities = new Map(getCapabilityDefinitions().map((definition) => [definition.id, definition]));

  for (const capabilityId of videoCapabilityIds) {
    assert.equal(capabilities.has(capabilityId), true, `${capabilityId} must be registered`);
  }

  assert.deepEqual(capabilities.get("knowledge_anchor_extract").inputSchema.required, ["taskBrief"]);
  assert.deepEqual(capabilities.get("knowledge_anchor_extract").upstreamCapabilities, []);
  assert.deepEqual(capabilities.get("creative_theme_generate").inputSchema.required, ["taskBrief"]);
  assert.deepEqual(capabilities.get("creative_theme_generate").upstreamCapabilities, []);
  assert.deepEqual(capabilities.get("video_script_generate").upstreamCapabilities, ["creative_theme_generate"]);
  assert.deepEqual(capabilities.get("storyboard_generate").upstreamCapabilities, ["video_script_generate"]);
  assert.deepEqual(capabilities.get("asset_image_generate").upstreamCapabilities, ["asset_brief_generate"]);
  assert.deepEqual(capabilities.get("video_segment_generate").upstreamCapabilities, ["video_segment_plan", "storyboard_generate", "asset_image_generate"]);
  assert.deepEqual(capabilities.get("video_narration_generate").upstreamCapabilities, ["video_script_generate"]);
  assert.deepEqual(capabilities.get("concat_only_assemble").upstreamCapabilities, ["video_segment_generate", "storyboard_generate", "video_script_generate", "video_narration_generate"]);
});

test("M60 runtime guidance requires structured video pre-artifacts before segment generation", () => {
  const runtimeTypes = readSource("src/server/agent-runtime/types.ts");
  const guidanceSource = readSource("src/server/agent-runtime/task-guidance.ts");
  const fixtureSource = readSource("tests/helpers/fixture-agent-runtime.ts");
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

  for (const teacherVisibleSource of [guidanceSource, fixtureSource, openaiSource]) {
    assert.doesNotMatch(teacherVisibleSource, /provider 限制|视频 provider|调用视频 provider/);
  }
});

test("M60/M68 binds real video outputs to executable provider or package adapters", () => {
  const tools = new Map(listToolDefinitions().map((definition) => [definition.id, definition]));
  const imageTool = tools.get("asset_image_generate");
  const segmentTool = tools.get("generate_video_segment");
  const narrationTool = tools.get("generate_video_narration");
  const assemblyTool = tools.get("concat_only_assemble");
  const legacyIntroTool = tools.get("intro_video");

  assert.equal(imageTool.adapterKind, "provider");
  assert.equal(imageTool.implemented, true);
  assert.equal(imageTool.sideEffectLevel, "external_call");
  assert.equal(segmentTool.adapterKind, "provider");
  assert.equal(segmentTool.implemented, true);
  assert.equal(narrationTool.adapterKind, "provider");
  assert.equal(narrationTool.implemented, true);
  assert.equal(assemblyTool.adapterKind, "package");
  assert.equal(assemblyTool.implemented, true);
  assert.equal(assemblyTool.sideEffectLevel, "package_write");
  assert.equal(legacyIntroTool.implemented, false);
  assert.equal(typeof legacyIntroTool.blockedReason, "string");
  assert.ok(legacyIntroTool.blockedReason.length > 0);
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
