import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { resolveModelGatewayConfig, resolveModelGatewayValueBag } from "@/server/model-gateway-config";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("unified model gateway configuration", () => {
  it("loads the server-only NewAPI JSON credential without serializing the key", async () => {
    const root = await mkdtemp(join(tmpdir(), "shanhai-model-gateway-"));
    roots.push(root);
    const file = join(root, "gateway.json");
    await writeFile(file, JSON.stringify({ _type: "newapi_channel_key", key: "private-value", url: "https://gateway.example" }), "utf8");
    const config = resolveModelGatewayConfig("image", { MODEL_GATEWAY_ENV_FILE: file });
    expect(config).toMatchObject({ baseUrl: "https://gateway.example/v1", model: "image-2" });
    expect(JSON.stringify(resolveModelGatewayValueBag("image", { MODEL_GATEWAY_ENV_FILE: file }))).not.toContain("private-value");
  });

  it("maps every model capability to the unified endpoint", () => {
    const env = { MODEL_GATEWAY_BASE_URL: "https://gateway.example/v1", MODEL_GATEWAY_API_KEY: "secret" };
    expect(resolveModelGatewayConfig("agent", env).model).toBe("gpt-5.6");
    expect(resolveModelGatewayConfig("text", env).model).toBe("deepseek");
    expect(resolveModelGatewayConfig("image", env).model).toBe("image-2");
    expect(resolveModelGatewayConfig("video", env).model).toBe("video-grok");
    expect(resolveModelGatewayConfig("tts", env)).toMatchObject({ model: "speech-2.8-hd", voiceId: "male-qn-qingse" });
  });

  it("fails closed without a gateway URL or credential", () => {
    expect(() => resolveModelGatewayConfig("agent", {})).toThrow("MODEL_GATEWAY_CONFIG_MISSING");
  });

  it("normalizes a gateway root URL to the shared /v1 base without duplicating /v1", () => {
    expect(resolveModelGatewayConfig("agent", { MODEL_GATEWAY_BASE_URL: "https://gateway.example", MODEL_GATEWAY_API_KEY: "secret" }).baseUrl).toBe("https://gateway.example/v1");
    expect(resolveModelGatewayConfig("agent", { MODEL_GATEWAY_BASE_URL: "https://gateway.example/v1", MODEL_GATEWAY_API_KEY: "secret" }).baseUrl).toBe("https://gateway.example/v1");
  });
});
