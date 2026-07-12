import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePptAssetImage } from "@/server/image-generation/image-generation-run";
import { validPptSampleFixtures } from "./support/ppt-sample-fixture";

describe("V1 Stage 3B PPT asset image generation bridge", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the disclosed asset request and verifies transparent PNG evidence", async () => {
    vi.stubEnv("IMAGE_PROVIDER_CHANNEL", "primary");
    vi.stubEnv("IMAGEGEN_MYSELF_PRIMARY_API_KEY", "test-key");
    vi.stubEnv("IMAGEGEN_MYSELF_PRIMARY_BASE_URL", "https://image.example.test");
    vi.stubEnv("IMAGEGEN_MYSELF_MODEL", "test-image-model");
    const png = minimalPng(1024, 1024, 6);
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response(JSON.stringify({
      id: "provider-request-1",
      data: [{ b64_json: png.toString("base64") }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", "x-request-id": "provider-request-1" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { requestBatch } = validPptSampleFixtures();
    const request = requestBatch.requests.find((candidate) => candidate.transparentBackground)!;

    const result = await generatePptAssetImage(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://image.example.test/v1/images/generations");
    expect(init?.headers).toMatchObject({ "X-Client-Request-Id": expect.any(String) });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "test-image-model",
      size: "1024x1024",
      quality: "high",
      background: "transparent",
    });
    expect(result).toMatchObject({
      width: 1024,
      height: 1024,
      mime: "image/png",
      transparentBackgroundVerified: true,
      provider: "primary",
      model: "test-image-model",
      providerRequestId: "provider-request-1",
      providerTaskId: null,
      sentReferenceAssetIds: [],
    });
  });

  it("blocks reference-dependent requests before any generation call", async () => {
    vi.stubEnv("IMAGE_PROVIDER_CHANNEL", "primary");
    vi.stubEnv("IMAGEGEN_MYSELF_PRIMARY_API_KEY", "test-key");
    vi.stubEnv("IMAGEGEN_MYSELF_PRIMARY_BASE_URL", "https://image.example.test");
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response());
    vi.stubGlobal("fetch", fetchMock);
    const { requestBatch } = validPptSampleFixtures();
    const request = { ...requestBatch.requests[0], referenceAssetIds: ["reference-a"] };

    await expect(generatePptAssetImage(request)).rejects.toThrow(/reference_transport_required/);
    expect(fetchMock).not.toHaveBeenCalled();
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
