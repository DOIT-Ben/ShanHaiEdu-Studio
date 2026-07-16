import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveProviderLedgerValueBag } from "@/server/provider-ledger/provider-ledger-adapter";

const fixtureRoot = path.resolve(".tmp", "provider-ledger-all-providers");
const productionConfigFiles = [
  "src/server/coze-ppt/coze-ppt-run.ts",
  "src/server/image-generation/image-generation-run.ts",
  "src/server/video-generation/video-generation-run.ts",
  "src/server/video-generation/video-narration-provider.ts",
  "src/server/tools/openai-agent-tool-executor.ts",
  "src/server/capabilities/capability-availability.ts",
  "src/server/tools/provider-tool-adapter.ts",
];

describe("provider ledger all-provider boundary", () => {
  beforeEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
    await mkdir(path.join(fixtureRoot, "PRIVATE-LOCAL-SECRETS", "apps-api"), { recursive: true });
    await writeFile(path.join(fixtureRoot, "manifest.json"), JSON.stringify({
      version: 1,
      providers: [
        { id: "text_llm", env_vars: ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL"] },
        { id: "image_generation", env_vars: ["IMAGEGEN_MYSELF_PRIMARY_API_KEY", "IMAGEGEN_MYSELF_PRIMARY_BASE_URL", "IMAGEGEN_MYSELF_MODEL"] },
        { id: "video_generation", env_vars: ["EVOLINK_API_KEY", "EVOLINK_BASE_URL", "EVOLINK_VIDEO_MODEL"] },
        { id: "tts_minimax", env_vars: ["MINIMAX_API_KEY", "MINIMAX_BASE_URL", "MINIMAX_TTS_MODEL"] },
        { id: "coze_ppt", env_vars: ["COZE_API_TOKEN", "COZE_API_BASE", "COZE_PPT_BOT_ID"] },
      ],
    }), "utf8");
    await writeFile(
      path.join(fixtureRoot, "PRIVATE-LOCAL-SECRETS", "apps-api", ".env"),
      [
        "DEEPSEEK_API_KEY=text-fixture-value",
        "DEEPSEEK_BASE_URL=https://text.invalid/v1",
        "DEEPSEEK_MODEL=text-model",
        "IMAGEGEN_MYSELF_PRIMARY_API_KEY=image-fixture-value",
        "IMAGEGEN_MYSELF_PRIMARY_BASE_URL=https://image.invalid/v1",
        "IMAGEGEN_MYSELF_MODEL=image-model",
        "EVOLINK_API_KEY=video-fixture-value",
        "EVOLINK_BASE_URL=https://video.invalid/v1",
        "EVOLINK_VIDEO_MODEL=video-model",
        "MINIMAX_API_KEY=tts-fixture-value",
        "MINIMAX_BASE_URL=https://tts.invalid",
        "MINIMAX_TTS_MODEL=tts-model",
        "COZE_API_TOKEN=coze-fixture-value",
        "COZE_API_BASE=https://coze.invalid",
        "COZE_PPT_BOT_ID=coze-bot",
      ].join("\n"),
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("resolves only manifest-declared values and keeps credentials non-enumerable", () => {
    const values = resolveProviderLedgerValueBag({
      ledgerRoot: fixtureRoot,
      capability: "image_generation",
      ambientEnv: {},
    });

    expect(values.get("IMAGEGEN_MYSELF_PRIMARY_API_KEY")).toBe("image-fixture-value");
    expect(values.get("IMAGEGEN_MYSELF_PRIMARY_BASE_URL")).toBe("https://image.invalid/v1");
    expect(() => values.get("DEEPSEEK_API_KEY")).toThrow(/not declared/i);
    expect(JSON.stringify(values)).not.toContain("image-fixture-value");
  });

  it("keeps production Provider configuration files free of direct credential reads", async () => {
    for (const file of productionConfigFiles) {
      const source = await readFile(path.resolve(file), "utf8");
      expect(source, file).not.toMatch(/(?:process\.)?env(?:\.|\[)[^\n]*(?:API_KEY|API_TOKEN)/);
    }
  });
});
