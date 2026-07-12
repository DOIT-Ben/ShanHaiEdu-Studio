import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveEvolinkShotReferences,
  type LocalVideoReferenceAsset,
} from "@/server/video-generation/evolink-reference-upload";

const root = path.join(process.cwd(), ".tmp", "video-reference-upload-tests");

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

function localReference(overrides: Partial<LocalVideoReferenceAsset> = {}): LocalVideoReferenceAsset {
  mkdirSync(root, { recursive: true });
  const localPath = path.join(root, "basket.jpg");
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 32 }, (_, index) => index)]);
  writeFileSync(localPath, bytes);
  return {
    assetId: "video_basket_reference",
    assetDomain: "video",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    applicableShotIds: ["shot_03"],
    purpose: "保持篮子道具和场景连续性",
    localPath,
    ...overrides,
  };
}

describe("V1 Stage 4B Evolink local video reference upload", () => {
  it("uploads a verified local video-domain image and binds returned evidence to the shot", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key" });
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.get("upload_path")).toBe("shanhai-video-inputs");
      expect(form.get("file_name")).toBe("basket.jpg");
      expect((form.get("file") as File).size).toBeGreaterThan(0);
      return new Response(JSON.stringify({
        success: true,
        data: {
          file_id: "file_video_basket",
          file_url: "https://files.evolink.example/video-basket.jpg",
          download_url: "https://files.evolink.example/download/video-basket.jpg",
          expires_at: "2026-07-15T00:00:00Z",
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const [resolved] = await resolveEvolinkShotReferences({
      shotId: "shot_03",
      references: [localReference()],
      apiKey: "test-key",
      filesBaseUrl: "https://files-api.evolink.ai",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resolved).toMatchObject({
      shotId: "shot_03",
      assetId: "video_basket_reference",
      assetDomain: "video",
      uploadFileId: "file_video_basket",
      uploadedUrl: "https://files.evolink.example/video-basket.jpg",
    });
    expect(resolved.localSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects PPT-domain references before any provider request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveEvolinkShotReferences({
      shotId: "shot_03",
      references: [localReference({ assetDomain: "ppt" as never })],
      apiKey: "test-key",
    })).rejects.toThrow("video_reference_asset_domain_invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects hash or shot-binding mismatches before upload", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveEvolinkShotReferences({
      shotId: "shot_03",
      references: [localReference({ sha256: "a".repeat(64) })],
      apiKey: "test-key",
    })).rejects.toThrow("video_reference_sha256_mismatch");
    await expect(resolveEvolinkShotReferences({
      shotId: "shot_02",
      references: [localReference()],
      apiKey: "test-key",
    })).rejects.toThrow("video_reference_shot_binding_invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
