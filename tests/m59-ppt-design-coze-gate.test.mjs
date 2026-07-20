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

test("M59 exposes the PPT quality path as independently callable capabilities and tools", () => {
  const capabilities = new Map(getCapabilityDefinitions().map((definition) => [definition.id, definition]));
  const tools = new Map(listToolDefinitions().map((definition) => [definition.id, definition]));
  const pptDesign = capabilities.get("ppt_design");
  const cozePpt = capabilities.get("coze_ppt");
  const designTool = tools.get("create_ppt_design_draft");
  const pptxTool = tools.get("generate_pptx_from_design");

  assert.equal(pptDesign.artifactKind, "ppt_design_draft");
  assert.deepEqual(pptDesign.upstreamCapabilities, ["ppt_outline"]);
  assert.equal(cozePpt.artifactKind, "pptx_artifact");
  assert.deepEqual(cozePpt.upstreamCapabilities, ["ppt_design"]);
  assert.deepEqual(cozePpt.inputSchema.required, ["ppt_design_draft"]);
  assert.equal(designTool.capabilityId, "ppt_design");
  assert.deepEqual(designTool.requiredArtifactKinds, ["ppt_draft"]);
  assert.equal(pptxTool.capabilityId, "coze_ppt");
  assert.equal(pptxTool.adapterKind, "provider");
  assert.deepEqual(pptxTool.requiredArtifactKinds, ["ppt_design_draft"]);
});

test("M59 publishes distinct data contracts for PPT design and real PPTX output", () => {
  const designContract = JSON.parse(readSource("config/node-contracts/ppt_design.json"));
  const pptxContract = JSON.parse(readSource("config/node-contracts/coze_ppt.json"));

  assert.equal(designContract.id, "ppt_design");
  assert.equal(designContract.artifactKind, "ppt_design_draft");
  assert.equal(designContract.providerPolicy, "internal");
  assert.equal(pptxContract.id, "coze_ppt");
  assert.equal(pptxContract.artifactKind, "pptx_artifact");
  assert.equal(pptxContract.providerPolicy, "external");
  assert.ok(pptxContract.requiredInputs.includes("approved_ppt_design_draft"));
});

test("M59 keeps the R5 design candidate contract separate from the production four-layer gate", () => {
  const runtimeTypes = readSource("src/server/agent-runtime/types.ts");
  const runnerSource = readSource("src/server/capabilities/capability-runner.ts");
  const guidanceSource = readSource("src/server/agent-runtime/task-guidance.ts");
  const openaiSource = readSource("src/server/agent-runtime/openai-runtime.ts");
  const cozeSource = readSource("src/server/coze-ppt/coze-ppt-run.ts");

  assert.match(runtimeTypes, /\| "ppt_design"/);
  assert.match(runnerSource, /ppt_design: "ppt_design"/);
  assert.match(runnerSource, /ppt_design: \{ nodeKey: "ppt_design_draft", kind: "ppt_design_draft" \}/);
  assert.match(guidanceSource, /任务语义[\s\S]*证据绑定[\s\S]*视觉方向[\s\S]*逐页结构[\s\S]*下游准备/);
  assert.match(openaiSource, /逐页紧凑设计候选/);
  assert.match(openaiSource, /不得使用页码范围或通用占位描述/);
  assert.match(cozeSource, /底图[\s\S]*元素[\s\S]*文字[\s\S]*排版/);
});

test("M59 Coze PPT only accepts ppt_design_draft and prompts from the four-layer design", () => {
  const cozeSource = readSource("src/server/coze-ppt/coze-ppt-run.ts");
  const routeSource = readSource("src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/coze-ppt/route.ts");
  const pptxTool = listToolDefinitions().find((definition) => definition.id === "generate_pptx_from_design");

  assert.match(cozeSource, /artifact\.kind !== "ppt_design_draft"/);
  assert.match(cozeSource, /需要先生成 PPT 设计稿|missing_ppt_design_draft/);
  assert.match(cozeSource, /逐页四层 PPT 设计稿/);
  assert.match(cozeSource, /底图[\s\S]*元素[\s\S]*文字[\s\S]*排版/);
  assert.match(cozeSource, /coze_ppt_disabled_by_model_gateway_only/);
  assert.match(cozeSource, /resolvePptDesignPageCount/);
  assert.match(cozeSource, /validatePptDesignDraftForCoze/);
  assert.match(cozeSource, /validation\.slideCount !== requestedPageCount/);
  assert.match(cozeSource, /coze_ppt_slide_count_mismatch/);
  assert.doesNotMatch(cozeSource, /页数：12 页/);
  assert.doesNotMatch(cozeSource, /完整 12 页课件/);
  assert.doesNotMatch(cozeSource, /当前 PPT 大纲：/);
  assert.match(routeSource, /kind !== "ppt_design_draft"/);
  assert.match(routeSource, /claimArtifactRouteToolExecution\([\s\S]*toolName: "generate_pptx_from_design"/);
  assert.match(routeSource, /createGenerationJob\([\s\S]*capabilityId: "coze_ppt"/);
  assert.match(routeSource, /routeToolCall\([\s\S]*toolName: "generate_pptx_from_design"[\s\S]*executionEnvelope: executionClaim\.executionEnvelope/);
  assert.ok(routeSource.indexOf("claimArtifactRouteToolExecution({") < routeSource.indexOf("createGenerationJob(projectId"));
  assert.ok(routeSource.indexOf("createGenerationJob(projectId") < routeSource.indexOf("routeToolCall({"));
  assert.equal(pptxTool.capabilityId, "coze_ppt");
  assert.equal(pptxTool.primarySourceArtifactKind, "ppt_design_draft");
  assert.equal(pptxTool.producedArtifactKind, "pptx_artifact");
});

test("M60 blocks merged PPT design ranges before Coze PPTX generation", () => {
  const validationSource = readSource("src/server/ppt-design/ppt-design-validation.ts");
  const runnerSource = readSource("src/server/capabilities/capability-runner.ts");
  const directorAdapterSource = readSource("src/server/ppt-quality/ppt-director-design-adapter.ts");
  const providerAdapterSource = readSource("src/server/tools/provider-tool-adapter.ts");
  const cozeSource = readSource("src/server/coze-ppt/coze-ppt-run.ts");
  const fixtureSource = readSource("tests/helpers/fixture-agent-runtime.ts");

  assert.match(validationSource, /range_merged_pages/);
  assert.match(validationSource, /第\\s\*\(\\d\{1,2\}\)\\s\*\[-—~至到\]/);
  assert.match(validationSource, /PPT 设计稿未逐页完整/);
  assert.match(runnerSource, /input\.capabilityId === "ppt_design"[\s\S]*status: "failed"[\s\S]*errorCategory: "validation"/);
  assert.match(directorAdapterSource, /validatePptDesignPackage\(designPackage\)/);
  assert.doesNotMatch(directorAdapterSource, /validatePptDesignPackageForProviderProduction\(designPackage\)/);
  assert.match(providerAdapterSource, /validatePptDesignPackageForProviderProduction\(packageValue as PptDesignPackage\)/);
  assert.match(cozeSource, /validatePptDesignDraftForCoze\(input\.artifact\.markdownContent\)/);
  const pptDesignBlock = fixtureSource.match(/ppt_design:[\s\S]*?intro_video_plan:/)?.[0] ?? fixtureSource;
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
