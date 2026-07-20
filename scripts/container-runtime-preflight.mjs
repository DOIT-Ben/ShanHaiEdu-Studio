import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const CONTAINER_RUNTIME_NODE_REQUIREMENT = "Prisma requires Node 20.19+, 22.12+, or 24+";
export const CONTAINER_RUNTIME_BINARY_PROBES = Object.freeze([
  ["ffmpeg", ["-version"]],
  ["ffprobe", ["-version"]],
  ["soffice", ["--version"]],
  ["pdfinfo", ["-v"]],
  ["pdftoppm", ["-v"]],
  ["curl", ["--version"]],
  ["fc-match", ["--version"]],
]);

export function evaluateContainerRuntime({
  nodeVersion = process.versions.node,
  probe = probeBinary,
} = {}) {
  const checks = [checkNode(nodeVersion), ...CONTAINER_RUNTIME_BINARY_PROBES.map(([command, args]) => checkBinary(command, args, probe)), checkChineseFont(probe)];
  return { ok: checks.every((item) => item.ok), stage: "v1_10c_container_runtime", checks };
}

function checkNode(nodeVersion) {
  const [major, minor] = nodeVersion.split(".").map(Number);
  const ok = major >= 24 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19);
  return { id: "node-engine", ok, version: nodeVersion, requirement: CONTAINER_RUNTIME_NODE_REQUIREMENT };
}

function checkBinary(command, args, probe) {
  const result = probe(command, args);
  return { id: `binary-${command}`, ok: result.status === 0 };
}

function checkChineseFont(probe) {
  const result = probe("fc-match", ["Noto Sans CJK SC"]);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { id: "font-noto-cjk", ok: result.status === 0 && /NotoSansCJK/i.test(output) };
}

function probeBinary(command, args) {
  return spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 15_000 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = evaluateContainerRuntime();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(2);
}
