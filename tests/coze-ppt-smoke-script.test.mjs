import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import JSZip from "jszip";
import { test } from "node:test";

import {
  extractCozePptResult,
  validatePptxBuffer,
} from "../scripts/coze-ppt-smoke.mjs";

test("extracts Coze PPT result from plain and fenced JSON", () => {
  const plain = extractCozePptResult({
    messages: [
      {
        role: "assistant",
        content: JSON.stringify({
          status: "completed",
          pptx_url: "https://download.example.test/file",
          file_name: "lesson.pptx",
        }),
      },
    ],
  });

  assert.equal(plain.status, "completed");
  assert.equal(plain.fileName, "lesson.pptx");

  const fenced = extractCozePptResult({
    messages: [
      {
        role: "assistant",
        content: "```json\n{\"status\":\"completed\",\"pptx_url\":\"https://download.example.test/file\"}\n```",
      },
    ],
  });

  assert.equal(fenced.status, "completed");
  assert.equal(fenced.fileName, "coze-ppt-smoke.pptx");
});

test("validates PPTX zip structure", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types />");
  zip.file("ppt/presentation.xml", "<presentation />");
  const buffer = await zip.generateAsync({ type: "nodebuffer" });

  const result = await validatePptxBuffer(buffer);

  assert.equal(result.valid, true);
  assert.equal(result.hasPresentationXml, true);
});

test("Coze PPT smoke fails without env and does not leak credentials", () => {
  const env = { ...process.env, SHANHAI_COZE_SKIP_DOTENV: "1" };
  delete env.COZE_API_TOKEN;
  delete env.COZE_PPT_RUN_URL;

  const result = spawnSync(process.execPath, ["scripts/coze-ppt-smoke.mjs"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /missing_COZE_PPT_RUN_ENV/);
  assert.doesNotMatch(result.stdout, /Bearer\s+[A-Za-z0-9._-]+/);
  assert.doesNotMatch(result.stderr, /Bearer\s+[A-Za-z0-9._-]+/);
  assert.doesNotMatch(result.stdout, /https:\/\/.+pptx/i);
  assert.doesNotMatch(result.stderr, /https:\/\/.+pptx/i);
});
