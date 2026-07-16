import "dotenv/config";

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { buildOpenAIResponseRequest } from "@/server/agent-runtime/openai-runtime";
import { createAgentRuntimeFromEnv } from "@/server/agent-runtime/runtime-factory";
import type { ApprovedArtifactInput } from "@/server/agent-runtime/types";
import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import { resolveProjectSemanticScope } from "@/server/conversation/project-semantic-scope";
import { resolveGenerationIntensityStrategy } from "@/server/generation-intensity/generation-intensity-policy";
import { pickOpenAICompatibleConfig } from "@/server/openai-compatible-config";
import { createConfiguredBusinessToolSkillRuntime } from "@/server/skills/business-tool-skill-runtime";

type SqliteRow = Record<string, string | number | null>;

async function main() {
  const startedAt = new Date();
  const runRoot = path.resolve(process.env.V1_9_RUN_ROOT || "test-results/v1-9-20260714212914-a036beb9");
  const databasePath = path.join(runRoot, "m67.sqlite");
  const task = query(databasePath, "select taskId,projectId,taskBriefJson,intentGrantJson from TaskAggregate order by updatedAt desc limit 1")[0];
  const project = query(databasePath, `select id,title,grade,subject,lessonTopic from Project where id='${safeSql(String(task.projectId))}'`)[0];
  const invocation = query(databasePath, "select requestJson from ToolInvocationRecord where toolName='generate_video_storyboard' order by startedAt desc limit 1")[0];
  const artifact = query(databasePath, `select id,nodeKey,kind,title,summary,markdownContent,structuredContentJson,version from Artifact where projectId='${safeSql(String(task.projectId))}' and kind='video_script_generate' order by version desc limit 1`)[0];
  if (!task || !project || !invocation || !artifact) throw new Error("storyboard_probe_input_missing");

  const taskBrief = JSON.parse(String(task.taskBriefJson));
  const intentGrant = JSON.parse(String(task.intentGrantJson));
  const toolArguments = JSON.parse(String(invocation.requestJson));
  const structuredContent = JSON.parse(String(artifact.structuredContentJson));
  const approvedArtifact: ApprovedArtifactInput = {
    artifactId: String(artifact.id),
    kind: String(artifact.kind),
    version: Number(artifact.version),
    digest: hashArtifactDraft({
      nodeKey: String(artifact.nodeKey),
      kind: String(artifact.kind),
      title: String(artifact.title),
      summary: String(artifact.summary),
      markdownContent: String(artifact.markdownContent),
      structuredContent,
    }),
    nodeKey: String(artifact.nodeKey),
    title: String(artifact.title),
    summary: String(artifact.summary),
    markdown: String(artifact.markdownContent),
  };
  const skillRuntime = createConfiguredBusinessToolSkillRuntime(process.env);
  if (!skillRuntime) throw new Error("storyboard_probe_skill_runtime_missing");
  const skill = await skillRuntime.loadForSelectedTool({ selectedBy: "main_agent", businessToolName: "generate_video_storyboard" });
  const provider = pickOpenAICompatibleConfig(process.env);
  if (!provider) throw new Error("storyboard_probe_provider_config_missing");
  const semanticScope = resolveProjectSemanticScope({
    title: String(project.title),
    grade: nullableString(project.grade),
    subject: nullableString(project.subject),
    lessonTopic: nullableString(project.lessonTopic),
  }, String(taskBrief.goal));
  const runtimeInput = {
    projectId: String(task.projectId),
    runId: `storyboard-health-${startedAt.getTime()}`,
    task: "storyboard_generate" as const,
    userMessage: String(toolArguments.userInstruction || taskBrief.goal),
    taskInput: {
      ...toolArguments,
      taskBrief,
      intentGrant,
      generationIntensity: "standard",
      intentEpoch: Number(taskBrief.intentEpoch),
    },
    projectContext: {
      ...semanticScope,
      teacherGoal: String(taskBrief.goal),
      requestedOutputs: [...taskBrief.requestedOutputs],
    },
    approvedArtifacts: [approvedArtifact],
    businessSkillContext: skill,
  };
  const intensityStrategy = resolveGenerationIntensityStrategy(runtimeInput.taskInput.generationIntensity);
  const request = buildOpenAIResponseRequest(runtimeInput, intensityStrategy.reasoningEffort);
  const requestMetrics = {
    instructionCharacters: request.instructions.length,
    inputCharacters: request.input.length,
    schemaCharacters: JSON.stringify(request.text.format.schema).length,
    totalCharacters: request.instructions.length + request.input.length + JSON.stringify(request.text.format.schema).length,
    approvedArtifactCount: 1,
    skillSemanticCharacters: skill.semanticSlice.guidance.reduce((sum, guidance) => sum + guidance.content.length, 0),
    skillReferenceCount: skill.provenance.references.length,
  };

  process.env.SHANHAI_OPENAI_NATIVE_TOOL_LOOP = "";
  const runtime = createAgentRuntimeFromEnv(process.env);
  const result = await runtime.run(runtimeInput);
  const finishedAt = new Date();
  const passed = result.status === "succeeded";
  const stamp = startedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const evidence = {
    schemaVersion: "provider-adapter-evidence.v1",
    evidenceId: `storyboard-runtime-health-${stamp}`,
    providerId: "agent_brain",
    capability: "storyboard_generate",
    purpose: "business_tool_structured_text",
    model: intensityStrategy.model,
    channel: provider.channel,
    reasoningEffort: intensityStrategy.reasoningEffort,
    ledgerDefaultReasoningEffort: provider.reasoningEffort,
    endpointCategory: provider.endpointCategory,
    status: passed ? "passed" : "failed",
    testedAt: startedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    requestCount: 1,
    retryCount: 0,
    requestMetrics,
    inputBinding: {
      taskId: String(task.taskId),
      projectId: String(task.projectId),
      intentEpoch: Number(taskBrief.intentEpoch),
      taskBriefDigest: String(taskBrief.digest),
      sourceArtifactId: approvedArtifact.artifactId,
      sourceArtifactDigest: approvedArtifact.digest,
      skillName: skill.skillName,
      skillVersion: skill.skillVersion,
      skillDigest: createHash("sha256").update(JSON.stringify({
        semanticSlice: skill.semanticSlice,
        provenance: skill.provenance,
      })).digest("hex"),
    },
    result: passed
      ? {
          runtimeKind: result.run.runtimeKind,
          artifactKind: result.artifactDraft.kind,
          generationMode: result.artifactDraft.generationMode,
          structuredStoryboardPresent: Boolean(result.artifactDraft.structuredContent?.videoStoryboardManifest),
        }
      : {
          runtimeKind: result.run.runtimeKind,
          errorCategory: result.failure?.category ?? "unknown",
          reasonCode: result.failure?.reasonCode ?? null,
          reasonDetails: result.failure?.details ?? [],
        },
  };
  const evidencePath = path.resolve("API台账系统", "evidence", "provider-adapter-tests", `${evidence.evidenceId}.json`);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  console.log(JSON.stringify({ evidencePath, ...evidence }));
  if (!passed) process.exitCode = 1;
}

function query(databasePath: string, sql: string): SqliteRow[] {
  const output = execFileSync("sqlite3", ["-json", databasePath, sql], { encoding: "utf8", windowsHide: true });
  return output.trim() ? JSON.parse(output) as SqliteRow[] : [];
}

function safeSql(value: string) {
  return value.replaceAll("'", "''");
}

function nullableString(value: string | number | null) {
  return typeof value === "string" ? value : null;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "storyboard_health_probe_failed");
  process.exitCode = 1;
});
