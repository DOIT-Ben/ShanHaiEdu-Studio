import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { generateImageFromArtifact, generatePptAssetImage } from "@/server/image-generation/image-generation-run";
import { validPptSampleFixtures } from "./support/ppt-sample-fixture";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function png() {
  return sharp({ create: { width: 1920, height: 1080, channels: 4, background: { r: 30, g: 90, b: 140, alpha: 1 } } }).png().toBuffer();
}

function gatewayEnv() {
  return {
    NODE_ENV: "test",
    MODEL_GATEWAY_BASE_URL: "https://gateway.example/v1",
    MODEL_GATEWAY_API_KEY: "gateway-test-key",
    MODEL_GATEWAY_IMAGE_MODEL: "image-2",
  };
}

describe("model gateway image generation", () => {
  it("uses the unified OpenAI image contract", async () => {
    const image = await png();
    vi.stubEnv("MODEL_GATEWAY_BASE_URL", gatewayEnv().MODEL_GATEWAY_BASE_URL);
    vi.stubEnv("MODEL_GATEWAY_API_KEY", gatewayEnv().MODEL_GATEWAY_API_KEY);
    vi.stubEnv("MODEL_GATEWAY_IMAGE_MODEL", gatewayEnv().MODEL_GATEWAY_IMAGE_MODEL);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [{ b64_json: image.toString("base64") }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { requestBatch } = validPptSampleFixtures();
    const result = await generatePptAssetImage(requestBatch.requests.find((request) => !request.transparentBackground)!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://gateway.example/v1/images/generations");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ model: "image-2", size: "1536x1024", response_format: "b64_json", n: 1 });
    expect(result.model).toBe("image-2");
  });

  it("fails closed when the gateway credential is missing", async () => {
    vi.stubEnv("MODEL_GATEWAY_BASE_URL", "");
    vi.stubEnv("MODEL_GATEWAY_API_KEY", "");
    vi.stubEnv("MODEL_GATEWAY_IMAGE_MODEL", "image-2");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { requestBatch } = validPptSampleFixtures();
    await expect(generatePptAssetImage(requestBatch.requests[0])).rejects.toThrow("MODEL_GATEWAY_CONFIG_MISSING");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps normalized image lineage on artifact generation", async () => {
    const image = await png();
    vi.stubEnv("MODEL_GATEWAY_BASE_URL", gatewayEnv().MODEL_GATEWAY_BASE_URL);
    vi.stubEnv("MODEL_GATEWAY_API_KEY", gatewayEnv().MODEL_GATEWAY_API_KEY);
    vi.stubEnv("MODEL_GATEWAY_IMAGE_MODEL", gatewayEnv().MODEL_GATEWAY_IMAGE_MODEL);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ data: [{ b64_json: image.toString("base64") }] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const result = await generateImageFromArtifact({
      project: { id: "project-image", title: "Image", grade: "三年级", subject: "科学", lessonTopic: "变化" } as never,
      artifact: { id: "artifact-image", kind: "storyboard_generate", title: "Storyboard", markdownContent: "画面", structuredContent: {} } as never,
    });
    expect(result.model).toBe("image-2");
    expect(result.normalizedAsset.bytes).toBeGreaterThan(32);
    expect(result.rawAsset.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
