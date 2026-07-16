import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type AgentBrainSyncChannel = "primary" | "third" | "fallback";

const channelFields: Record<AgentBrainSyncChannel, readonly string[]> = {
  primary: ["AGENT_BRAIN_API_KEY", "AGENT_BRAIN_BASE_URL", "AGENT_BRAIN_MODEL", "AGENT_BRAIN_TIER"],
  third: ["AGENT_BRAIN_THIRD_API_KEY", "AGENT_BRAIN_THIRD_BASE_URL", "AGENT_BRAIN_THIRD_MODEL", "AGENT_BRAIN_THIRD_TIER"],
  fallback: ["AGENT_BRAIN_FALLBACK_API_KEY", "AGENT_BRAIN_FALLBACK_BASE_URL", "AGENT_BRAIN_FALLBACK_MODEL", "AGENT_BRAIN_FALLBACK_TIER"],
};

export function syncAgentBrainLedgerEnvText(input: {
  source: string;
  target: string;
  channels: AgentBrainSyncChannel[];
}) {
  const channels = uniqueChannels(input.channels);
  const sourceValues = parseEnv(input.source);
  let updatedText = input.target;
  let changedFieldCount = 0;

  for (const channel of channels) {
    const fields = channelFields[channel];
    for (const required of fields.slice(0, 3)) {
      if (!sourceValues.get(required)?.trim()) throw new Error(`agent_brain_sync_source_incomplete:${channel}`);
    }
    for (const field of fields) {
      const value = sourceValues.get(field);
      if (!value?.trim()) continue;
      const current = parseEnv(updatedText).get(field);
      if (current === value) continue;
      updatedText = replaceOrAppendEnvValue(updatedText, field, value);
      changedFieldCount += 1;
    }
  }

  return {
    updatedText,
    report: { channels, changedFieldCount },
  };
}

export function syncAgentBrainLedgerEnvFiles(input: {
  sourcePath: string;
  targetPath: string;
  channels: AgentBrainSyncChannel[];
}) {
  const result = syncAgentBrainLedgerEnvText({
    source: readFileSync(input.sourcePath, "utf8"),
    target: readFileSync(input.targetPath, "utf8"),
    channels: input.channels,
  });
  if (result.report.changedFieldCount > 0) {
    const temporaryPath = `${input.targetPath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, result.updatedText, { encoding: "utf8", flag: "wx" });
    renameSync(temporaryPath, input.targetPath);
  }
  return result.report;
}

function parseEnv(text: string) {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values.set(match[1], unquote(match[2].trim()));
  }
  return values;
}

function replaceOrAppendEnvValue(text: string, key: string, value: string) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => new RegExp(`^\\s*${escapeRegExp(key)}=`).test(line));
  const nextLine = `${key}=${quoteIfNeeded(value)}`;
  if (index >= 0) lines[index] = nextLine;
  else {
    if (lines.at(-1) === "") lines.splice(lines.length - 1, 0, nextLine);
    else lines.push(nextLine);
  }
  return lines.join(newline);
}

function quoteIfNeeded(value: string) {
  return /\s|#/.test(value) ? JSON.stringify(value) : value;
}

function unquote(value: string) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

function uniqueChannels(channels: AgentBrainSyncChannel[]) {
  const unique = [...new Set(channels)];
  if (unique.length === 0 || unique.some((channel) => !Object.hasOwn(channelFields, channel))) throw new Error("agent_brain_sync_channels_invalid");
  return unique;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isMainModule() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const cwd = process.cwd();
  const channelsArgument = process.argv.find((argument) => argument.startsWith("--channels="))?.slice("--channels=".length) ?? "primary,fallback";
  const channels = channelsArgument.split(",").map((value) => value.trim()).filter(Boolean) as AgentBrainSyncChannel[];
  const report = syncAgentBrainLedgerEnvFiles({
    sourcePath: path.resolve(cwd, ".env"),
    targetPath: path.resolve(cwd, "API台账系统", "PRIVATE-LOCAL-SECRETS", "apps-api", ".env"),
    channels,
  });
  process.stdout.write(`${JSON.stringify({ ok: true, ...report })}\n`);
}
