import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { resolveLocalArtifactOutput } from "@/server/artifact-storage/local-artifact-storage";
import { generateImageFromArtifact, generatePptAssetImage } from "@/server/image-generation/image-generation-run";
import { validPptSampleFixtures } from "./support/ppt-sample-fixture";

const ledgerFixtureRoot = path.resolve(".tmp", "image-runtime-ledger-contract-test");
const lineageStorageRoot = path.resolve(".tmp", "ppt-image-lineage-test");

describe("V1 Stage 3B PPT asset image generation bridge", () => {
  beforeEach(async () => {
    await rm(ledgerFixtureRoot, { recursive: true, force: true });
    await rm(lineageStorageRoot, { recursive: true, force: true });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(ledgerFixtureRoot, { recursive: true, force: true });
    await rm(lineageStorageRoot, { recursive: true, force: true });
  });

  it("consumes MiniMax field bindings from the ledger runtime contract instead of a hard-coded env table", async () => {
    await writeImageLedgerFixture(ledgerFixtureRoot);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SHANHAI_PROVIDER_LEDGER_ROOT", ledgerFixtureRoot);
    vi.stubEnv("LEDGER_IMAGE_CHANNEL", "minimax");
    vi.stubEnv("LEDGER_IMAGE_SECRET", "ledger-bound-secret");
    vi.stubEnv("LEDGER_IMAGE_ENDPOINT", "https://ledger-minimax.example");
    vi.stubEnv("LEDGER_IMAGE_MODEL", "ledger-image-model");
    vi.stubEnv("MINIMAX_API_KEY", "legacy-secret-must-not-win");
    vi.stubEnv("MINIMAX_BASE_URL", "https://legacy.invalid");
    vi.stubEnv("MINIMAX_IMAGE_MODEL", "legacy-model");
    const png = minimalPng(1920, 1080, 2);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      base_resp: { status_code: 0 },
      data: { image_base64: [png.toString("base64")] },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { requestBatch } = validPptSampleFixtures();

    const result = await generatePptAssetImage(requestBatch.requests.find((candidate) => !candidate.transparentBackground)!);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://ledger-minimax.example/v1/image_generation");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer ledger-bound-secret" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "ledger-image-model" });
    expect(result.model).toBe("ledger-image-model");
  });

  it("fails closed when the ledger-bound image model is missing instead of using a default", async () => {
    await writeImageLedgerFixture(ledgerFixtureRoot);
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SHANHAI_PROVIDER_LEDGER_ROOT", ledgerFixtureRoot);
    vi.stubEnv("LEDGER_IMAGE_CHANNEL", "minimax");
    vi.stubEnv("LEDGER_IMAGE_SECRET", "ledger-bound-secret");
    vi.stubEnv("LEDGER_IMAGE_ENDPOINT", "https://ledger-minimax.example");
    vi.stubEnv("LEDGER_IMAGE_MODEL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { requestBatch } = validPptSampleFixtures();

    await expect(generatePptAssetImage(requestBatch.requests[0])).rejects.toMatchObject({
      code: "LEDGER_VALUE_MISSING",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not retain legacy image channel aliases or provider field tables in the production runtime", async () => {
    const source = await readFile(path.resolve("src/server/image-generation/image-generation-run.ts"), "utf8");

    expect(source).not.toMatch(/channelEnvMap|IMAGEGEN_(?:MYSELF|FREE)|myself_fallback|free_primary/);
    expect(source).not.toMatch(/requestOpenAICompatibleImage|generatePptAssetImageWith(?:Curl|Wrapper)/);
  });

  it("rejects non-MiniMax image channels before sending a request", async () => {
    vi.stubEnv("IMAGE_PROVIDER_CHANNEL", "primary");
    vi.stubEnv("IMAGEGEN_MYSELF_PRIMARY_API_KEY", "test-key");
    vi.stubEnv("IMAGEGEN_MYSELF_PRIMARY_BASE_URL", "https://image.example.test");
    vi.stubEnv("IMAGEGEN_MYSELF_MODEL", "test-image-model");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { requestBatch } = validPptSampleFixtures();
    const request = requestBatch.requests.find((candidate) => candidate.transparentBackground)!;

    await expect(generatePptAssetImage(request)).rejects.toThrow("image_provider_channel_not_allowed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks reference-dependent requests before any generation call", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("IMAGE_PROVIDER_CHANNEL", "minimax");
    vi.stubEnv("MINIMAX_API_KEY", "test-key");
    vi.stubEnv("MINIMAX_BASE_URL", "https://image.example.test");
    vi.stubEnv("MINIMAX_IMAGE_MODEL", "image-01");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response());
    vi.stubGlobal("fetch", fetchMock);
    const { requestBatch } = validPptSampleFixtures();
    const request = { ...requestBatch.requests[0], referenceAssetIds: ["reference-a"] };

    await expect(generatePptAssetImage(request)).rejects.toThrow(/reference_transport_required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the MiniMax native image contract and records MiniMax lineage", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("IMAGE_PROVIDER_CHANNEL", "minimax");
    vi.stubEnv("MINIMAX_API_KEY", "minimax-test-key");
    vi.stubEnv("MINIMAX_BASE_URL", "https://minimax.example");
    vi.stubEnv("MINIMAX_IMAGE_MODEL", "image-01");
    const png = minimalPng(1920, 1080, 2);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      base_resp: { status_code: 0, status_msg: "success" },
      data: { image_base64: [png.toString("base64")] },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { requestBatch } = validPptSampleFixtures();
    const request = requestBatch.requests.find((candidate) => !candidate.transparentBackground)!;

    const result = await generatePptAssetImage(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://minimax.example/v1/image_generation");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "image-01",
      prompt: expect.any(String),
      aspect_ratio: request.aspectRatio,
      response_format: "base64",
      n: 1,
      prompt_optimizer: false,
    });
    expect(result).toMatchObject({
      provider: "minimax",
      model: "image-01",
      providerRequestId: null,
      providerTaskId: null,
    });
  });

  it("normalizes a MiniMax data-URI WebP response to a verified PNG", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("IMAGE_PROVIDER_CHANNEL", "minimax");
    vi.stubEnv("MINIMAX_API_KEY", "minimax-test-key");
    vi.stubEnv("MINIMAX_BASE_URL", "https://minimax.example");
    vi.stubEnv("MINIMAX_IMAGE_MODEL", "image-01");
    vi.stubEnv("ARTIFACT_STORAGE_ROOT", lineageStorageRoot);
    const webp = await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: "#ffffff" },
    }).webp().toBuffer();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      base_resp: { status_code: 0 },
      data: { image_base64: [`data:image/webp;base64,${webp.toString("base64")}`] },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const { requestBatch } = validPptSampleFixtures();
    const request = requestBatch.requests.find((candidate) => !candidate.transparentBackground)!;

    const result = await generatePptAssetImage(request);

    expect(result).toMatchObject({
      provider: "minimax",
      model: "image-01",
      mime: "image/png",
      width: 1920,
      height: 1080,
      rawAsset: {
        fileName: expect.stringMatching(/provider-raw\.webp$/),
        storageRef: expect.any(String),
        bytes: webp.length,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        mime: "image/webp",
        width: 1920,
        height: 1080,
      },
      normalizedAsset: {
        fileName: expect.stringMatching(/normalized\.png$/),
        storageRef: expect.any(String),
        bytes: expect.any(Number),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        mime: "image/png",
        width: 1920,
        height: 1080,
      },
    });
    expect(result.rawAsset.storageRef).not.toBe(result.normalizedAsset.storageRef);
    const rawPath = resolveLocalArtifactOutput(result.rawAsset.storageRef);
    const normalizedPath = resolveLocalArtifactOutput(result.normalizedAsset.storageRef);
    expect(rawPath).not.toBeNull();
    expect(normalizedPath).not.toBeNull();
    expect(await readFile(rawPath!)).toEqual(webp);
    expect((await readFile(normalizedPath!)).length).toBe(result.normalizedAsset.bytes);
    expect(result.processingChain).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "format_conversion" }),
    ]));
  });

  it("builds a scoped video-asset prompt from TaskBrief and preserves MiniMax raw/normalized lineage", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("IMAGE_PROVIDER_CHANNEL", "minimax");
    vi.stubEnv("MINIMAX_API_KEY", "minimax-test-key");
    vi.stubEnv("MINIMAX_BASE_URL", "https://minimax.example");
    vi.stubEnv("MINIMAX_IMAGE_MODEL", "image-01");
    const png = minimalPng(1920, 1080, 2);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      base_resp: { status_code: 0, status_msg: "success" },
      data: { image_base64: [png.toString("base64")] },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateImageFromArtifact({
      project: {
        id: "project-minimax-wide",
        title: "海洋灯塔创意短片",
        grade: "通用",
        subject: "综合实践",
        lessonTopic: "海洋环保",
      } as Parameters<typeof generateImageFromArtifact>[0]["project"],
      artifact: {
        id: "artifact-minimax-wide",
        projectId: "project-minimax-wide",
        kind: "asset_brief_generate",
        title: "灯塔岛视频资产说明",
        summary: "生成横版视频参考图。",
        markdownContent: "# 灯塔岛",
        structuredContent: {},
      } as Parameters<typeof generateImageFromArtifact>[0]["artifact"],
      userInstruction: "只生成独立创意短片的灯塔守护者角色参考图。",
      toolInput: {
        taskBrief: {
          goal: "只做海洋灯塔独立创意短片的资产图",
          requestedOutputs: ["video"],
          constraints: ["脱离教材仍成立", "只有一个最小课程锚点"],
          excludedOutputs: ["lesson_plan", "ppt", "video_file", "package"],
        },
      },
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody).toMatchObject({
      aspect_ratio: "16:9",
      response_format: "base64",
      prompt_optimizer: false,
    });
    expect(requestBody.prompt).toContain("海洋灯塔独立创意短片");
    expect(requestBody.prompt).toContain("脱离教材仍成立");
    expect(requestBody.prompt).not.toContain("小学六年级数学百分数公开课");
    expect(requestBody.prompt).not.toMatch(/生成教案|制作PPT|生成成片|最终材料包/);
    expect(result).toMatchObject({
      provider: "minimax",
      model: "image-01",
      width: 1920,
      height: 1080,
      rawAsset: {
        localOutput: expect.any(String),
        bytes: png.length,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        mime: "image/png",
      },
      normalizedAsset: {
        localOutput: expect.any(String),
        bytes: png.length,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        mime: "image/png",
        width: 1920,
        height: 1080,
      },
    });
    expect(result.rawAsset.localOutput).not.toBe(result.normalizedAsset.localOutput);
  });

  it("preserves a sanitized MiniMax parameter reason for status 2013", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("IMAGE_PROVIDER_CHANNEL", "minimax");
    vi.stubEnv("MINIMAX_API_KEY", "minimax-test-key");
    vi.stubEnv("MINIMAX_BASE_URL", "https://minimax.example");
    vi.stubEnv("MINIMAX_IMAGE_MODEL", "image-01");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      base_resp: { status_code: 2013, status_msg: "invalid aspect_ratio" },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(generateImageFromArtifact({
      project: {
        id: "project-minimax-error",
        title: "百分数公开课",
      } as Parameters<typeof generateImageFromArtifact>[0]["project"],
      artifact: {
        id: "artifact-minimax-error",
        projectId: "project-minimax-error",
        kind: "ppt_draft",
        title: "百分数PPT大纲",
        summary: "课堂视觉图。",
        markdownContent: "# 百分数",
        structuredContent: {},
      } as Parameters<typeof generateImageFromArtifact>[0]["artifact"],
    })).rejects.toThrow("minimax_image_generation_request_failed:status_2013:invalid_aspect_ratio");
  });
});

function minimalPng(width: number, height: number, colorType: number): Buffer {
  const buffer = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  Buffer.from("IHDR").copy(buffer, 12);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer[24] = 8;
  buffer[25] = colorType;
  return buffer;
}

async function writeImageLedgerFixture(root: string) {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "manifest.json"), `${JSON.stringify({
    version: 1,
    providers: [{
      id: "image_generation",
      env_vars: [
        "LEDGER_IMAGE_CHANNEL",
        "LEDGER_IMAGE_SECRET",
        "LEDGER_IMAGE_ENDPOINT",
        "LEDGER_IMAGE_MODEL",
      ],
      runtime_contract: {
        schema_version: "provider-runtime-contract.v1",
        kind: "minimax_image",
        selected_channel_env: "LEDGER_IMAGE_CHANNEL",
        required_channel: "minimax",
        credential_env: "LEDGER_IMAGE_SECRET",
        base_url_env: "LEDGER_IMAGE_ENDPOINT",
        model_env: "LEDGER_IMAGE_MODEL",
      },
    }],
  }, null, 2)}\n`, "utf8");
}
