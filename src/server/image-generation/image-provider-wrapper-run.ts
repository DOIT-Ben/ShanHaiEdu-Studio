import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function generateImageWithExternalWrapper(input: {
  powerShell: string;
  script: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  size: string;
  quality: string;
  timeoutMs: number;
}): Promise<Buffer> {
  const workingDir = await mkdtemp(path.join(tmpdir(), "shanhaiedu-image-wrapper-"));
  const outputPath = path.join(workingDir, "provider-output.png");
  try {
    await execFileAsync(input.powerShell, [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", input.script,
      "generate", "--prompt", input.prompt, "--model", input.model, "--size", input.size,
      "--quality", input.quality, "--out", outputPath, "--force", "--dimension-policy", "strict",
    ], {
      windowsHide: true,
      timeout: input.timeoutMs,
      env: {
        ...process.env,
        IMAGEGEN_MYSELF_PRIMARY_API_KEY: input.apiKey,
        IMAGEGEN_MYSELF_PRIMARY_BASE_URL: input.baseUrl,
        IMAGEGEN_MYSELF_FALLBACK_API_KEY: input.apiKey,
        IMAGEGEN_MYSELF_FALLBACK_BASE_URL: input.baseUrl,
      },
    });
    return await readFile(outputPath);
  } catch {
    throw new Error("ppt_asset_image_wrapper_failed");
  } finally {
    await rm(workingDir, { recursive: true, force: true });
  }
}

export async function generateImageWithMiniMaxCli(input: { cliScript: string; prompt: string; aspectRatio: string; timeoutMs: number }): Promise<Buffer> {
  const workingDir = await mkdtemp(path.join(tmpdir(), "shanhaiedu-minimax-image-"));
  try {
    await waitForMiniMaxOutput({ workingDir, cliScript: input.cliScript, prompt: input.prompt, aspectRatio: input.aspectRatio, timeoutMs: input.timeoutMs });
    const output = (await readdir(workingDir)).find((file) => /^provider_001\.(jpg|jpeg|png|webp)$/i.test(file));
    if (!output) throw new Error("minimax_image_output_missing");
    return await readFile(path.join(workingDir, output));
  } catch (error) {
    const stderr = error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
      ? error.stderr.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 240)
      : "";
    throw new Error(`minimax_image_generation_failed:${stderr || "process_failed"}`);
  } finally { await rm(workingDir, { recursive: true, force: true }); }
}

function waitForMiniMaxOutput(input: { workingDir: string; cliScript: string; prompt: string; aspectRatio: string; timeoutMs: number }) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", input.cliScript, "image", "generate", "--prompt", input.prompt, "--aspect-ratio", input.aspectRatio, "--n", "1", "--out-dir", input.workingDir, "--out-prefix", "provider", "--non-interactive", "--timeout", String(Math.max(1, Math.ceil(input.timeoutMs / 1000))), "--output", "json"], { windowsHide: true, stdio: "ignore" });
    const finish = (error?: Error) => {
      clearInterval(poll);
      clearTimeout(timeout);
      child.kill();
      if (error) reject(error);
      else resolve();
    };
    let previousSize = 0;
    const poll = setInterval(async () => {
      const files = await readdir(input.workingDir).catch(() => [] as string[]);
      const output = files.find((file) => /^provider_001\.(jpg|jpeg|png|webp)$/i.test(file));
      if (!output) return;
      const bytes = await readFile(path.join(input.workingDir, output)).then((buffer) => buffer.length).catch(() => 0);
      if (bytes > 0 && bytes === previousSize) finish();
      previousSize = bytes;
    }, 400);
    const timeout = setTimeout(() => finish(new Error("minimax_image_timeout")), input.timeoutMs);
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => { if (code !== 0) finish(new Error(`minimax_image_process_exit:${code}`)); });
  });
}
