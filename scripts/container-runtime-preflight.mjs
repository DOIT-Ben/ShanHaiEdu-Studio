import { spawnSync } from "node:child_process";

const minimums = "Prisma requires Node 20.19+, 22.12+, or 24+";
const binaryProbes = [
  ["ffmpeg", ["-version"]],
  ["ffprobe", ["-version"]],
  ["soffice", ["--version"]],
  ["pdfinfo", ["-v"]],
  ["pdftoppm", ["-v"]],
  ["curl", ["--version"]],
  ["fc-match", ["--version"]],
];
const checks = [checkNode(), ...binaryProbes.map(([command, args]) => checkBinary(command, args)), checkChineseFont()];
const result = { ok: checks.every((item) => item.ok), stage: "v1_10c_container_runtime", checks };

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(2);

function checkNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const ok = major >= 24 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19);
  return { id: "node-engine", ok, version: process.versions.node, requirement: minimums };
}

function checkBinary(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 15_000 });
  return { id: `binary-${command}`, ok: result.status === 0 };
}

function checkChineseFont() {
  const result = spawnSync("fc-match", ["Noto Sans CJK SC"], { encoding: "utf8", windowsHide: true, timeout: 15_000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { id: "font-noto-cjk", ok: result.status === 0 && /NotoSansCJK/i.test(output) };
}
