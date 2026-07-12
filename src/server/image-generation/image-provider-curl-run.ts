import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function generateImageWithCurlProvider(input: { url: string; apiKey: string; body: Record<string, unknown>; timeoutMs: number }): Promise<unknown> {
  const dir = await mkdtemp(path.join(tmpdir(), "shanhaiedu-image-curl-"));
  const requestPath = path.join(dir, "request.json");
  const responsePath = path.join(dir, "response.json");
  try {
    await writeFile(requestPath, JSON.stringify(input.body), "utf8");
    await new Promise<void>((resolve, reject) => {
      const child = spawn("curl.exe", ["--config", "-"], { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`curl_image_provider_failed:${code}:${stderr.slice(0, 200)}`)));
      const seconds = Math.max(1, Math.ceil(input.timeoutMs / 1000));
      child.stdin.end([
        `url = \"${input.url}\"`, "request = \"POST\"", `header = \"Authorization: Bearer ${input.apiKey}\"`,
        "header = \"Content-Type: application/json\"", `data-binary = \"@${requestPath.replace(/\\/g, "/")}\"`,
        `output = \"${responsePath.replace(/\\/g, "/")}\"`, `max-time = ${seconds}`, "http1.1", "ssl-revoke-best-effort", "silent", "show-error",
      ].join("\n"));
    });
    return JSON.parse(await readFile(responsePath, "utf8"));
  } finally { await rm(dir, { recursive: true, force: true }); }
}
