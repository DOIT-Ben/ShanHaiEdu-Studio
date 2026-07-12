import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("M59 keeps coze_ppt available while V1 full delivery uses the quality PPT path", () => {
  const typesSource = readSource("src/server/capabilities/types.ts");
  const registrySource = readSource("src/server/capabilities/capability-registry.ts");
  const plannerSource = readSource("src/server/capabilities/capability-planner.ts");

  assert.match(typesSource, /\| "ppt_design"/);
  assert.match(registrySource, /id: "ppt_design"/);
  assert.match(registrySource, /artifactKind: "ppt_design_draft"/);
  assert.match(registrySource, /workflowNodeKey: "ppt_design_draft"/);
  assert.match(registrySource, /id: "coze_ppt"[\s\S]*upstreamCapabilities: \["ppt_design"\]/);
  assert.match(registrySource, /id: "coze_ppt"[\s\S]*inputSchema: \{ required: \["ppt_design_draft"\] \}/);
  assert.match(plannerSource, /"ppt_outline",\s*\n\s*"ppt_design",\s*\n\s*"ppt_sample_assets",\s*\n\s*"ppt_key_samples",\s*\n\s*"ppt_full_assets",\s*\n\s*"ppt_full_deck"/);
  assert.match(plannerSource, /buildPlan\("coze_ppt"/);
});

test("M59 adds a distinct ppt_design_draft workflow artifact and teacher mapping", () => {
  const workbenchTypes = readSource("src/server/workbench/types.ts");
  const clientTypes = readSource("src/lib/types.ts");
  const workflowDefaults = readSource("src/server/workbench/workflow-defaults.ts");
  const mapperSource = readSource("src/lib/workbench-mappers.ts");
  const artifactRouteSource = readSource("src/app/api/workbench/projects/[projectId]/artifacts/route.ts");

  assert.match(workbenchTypes, /\| "ppt_design_draft"/);
  assert.match(clientTypes, /\| "ppt_design_draft"/);
  assert.match(workflowDefaults, /key: "ppt_design_draft"/);
  assert.match(workflowDefaults, /upstreamNodeKeys: \["ppt_draft"\]/);
  assert.match(mapperSource, /ppt_design_draft/);
  assert.match(mapperSource, /PPT 设计稿|课件设计稿/);
  assert.match(artifactRouteSource, /"ppt_design_draft"/);
  assert.match(artifactRouteSource, /"pptx_artifact"/);
});

test("M59 agent runtime can produce a four-layer PPT design draft", () => {
  const runtimeTypes = readSource("src/server/agent-runtime/types.ts");
  const runnerSource = readSource("src/server/capabilities/capability-runner.ts");
  const guidanceSource = readSource("src/server/agent-runtime/task-guidance.ts");
  const deterministicSource = readSource("src/server/agent-runtime/deterministic-runtime.ts");
  const openaiSource = readSource("src/server/agent-runtime/openai-runtime.ts");

  assert.match(runtimeTypes, /\| "ppt_design"/);
  assert.match(runnerSource, /ppt_design: "ppt_design"/);
  assert.match(runnerSource, /ppt_design: \{ nodeKey: "ppt_design_draft", kind: "ppt_design_draft" \}/);
  for (const source of [guidanceSource, deterministicSource, openaiSource]) {
    assert.match(source, /底图/);
    assert.match(source, /元素/);
    assert.match(source, /文字/);
    assert.match(source, /排版/);
  }
});

test("M59 Coze PPT only accepts ppt_design_draft and prompts from the four-layer design", () => {
  const cozeSource = readSource("src/server/coze-ppt/coze-ppt-run.ts");
  const routeSource = readSource("src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/coze-ppt/route.ts");
  const conversationSource = readSource("src/server/conversation/conversation-turn-service.ts");

  assert.match(cozeSource, /artifact\.kind !== "ppt_design_draft"/);
  assert.match(cozeSource, /需要先生成 PPT 设计稿|missing_ppt_design_draft/);
  assert.match(cozeSource, /逐页四层 PPT 设计稿/);
  assert.match(cozeSource, /底图[\s\S]*元素[\s\S]*文字[\s\S]*排版/);
  assert.match(cozeSource, /\/v3\/chat/);
  assert.match(cozeSource, /COZE_PPT_BOT_ID/);
  assert.match(cozeSource, /resolvePptDesignPageCount/);
  assert.match(cozeSource, /validatePptDesignDraftForCoze/);
  assert.match(cozeSource, /validation\.slideCount !== requestedPageCount/);
  assert.match(cozeSource, /coze_ppt_slide_count_mismatch/);
  assert.doesNotMatch(cozeSource, /页数：12 页/);
  assert.doesNotMatch(cozeSource, /完整 12 页课件/);
  assert.doesNotMatch(cozeSource, /当前 PPT 大纲：/);
  assert.match(routeSource, /kind !== "ppt_design_draft"/);
  assert.match(routeSource, /routeToolCall\([\s\S]*capabilityId: "coze_ppt"/);
  assert.match(conversationSource, /input\.toolRouter\([\s\S]*capabilityId: toolPlan\.capabilityId/);
  assert.match(conversationSource, /findProviderSourceArtifact[\s\S]*ppt_design_draft/);
  assert.match(conversationSource, /failGenerationJob[\s\S]*result\.observation\.teacherSafeSummary/);
});

test("M60 blocks merged PPT design ranges before Coze PPTX generation", () => {
  const validationSource = readSource("src/server/ppt-design/ppt-design-validation.ts");
  const runnerSource = readSource("src/server/capabilities/capability-runner.ts");
  const cozeSource = readSource("src/server/coze-ppt/coze-ppt-run.ts");
  const deterministicSource = readSource("src/server/agent-runtime/deterministic-runtime.ts");

  assert.match(validationSource, /range_merged_pages/);
  assert.match(validationSource, /第\\s\*\(\\d\{1,2\}\)\\s\*\[-—~至到\]/);
  assert.match(validationSource, /PPT 设计稿未逐页完整/);
  assert.match(runnerSource, /input\.capabilityId === "ppt_design"[\s\S]*validatePptDesignDraftForCoze/);
  assert.match(cozeSource, /validatePptDesignDraftForCoze\(input\.artifact\.markdownContent\)/);
  const pptDesignBlock = deterministicSource.match(/ppt_design:[\s\S]*?intro_video_plan:/)?.[0] ?? deterministicSource;
  assert.doesNotMatch(pptDesignBlock, /第 4-8 页/);
  assert.doesNotMatch(pptDesignBlock, /第 9-12 页/);
  assert.doesNotMatch(pptDesignBlock, /第 3-12 页四层延展规则/);
});

test("M59 does not expose PPTX download for text-only PPT outlines", () => {
  const pptxHookSource = readSource("src/hooks/useArtifactPptxDownload.ts");
  const pptxServerSource = readSource("src/server/pptx/artifact-pptx.ts");

  assert.match(pptxHookSource, /item\.nodeKey === "pptx_artifact"/);
  assert.doesNotMatch(pptxHookSource, /item\.nodeKey === "ppt_draft"/);
  assert.match(pptxServerSource, /buildStoredOrGeneratedArtifactPptxDownload[\s\S]*return buildStoredArtifactPptxDownload\(artifact\)/);
});

test("M59 media validation rejects thin fake image and video files", () => {
  const imageSource = readSource("src/server/image-generation/artifact-image.ts");
  const videoSource = readSource("src/server/video-generation/artifact-video.ts");
  const videoRunSource = readSource("src/server/video-generation/video-generation-run.ts");

  assert.match(imageSource, /MIN_IMAGE_BYTES/);
  assert.match(imageSource, /IHDR|SOF0|SOF2/);
  assert.match(videoSource, /MIN_VIDEO_BYTES/);
  assert.match(videoSource, /moov/);
  assert.match(videoRunSource, /MIN_VIDEO_BYTES/);
  assert.match(videoRunSource, /moov/);
});
