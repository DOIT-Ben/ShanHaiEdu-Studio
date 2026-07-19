import "dotenv/config";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { hashArtifactDraft } from "@/server/contracts/contract-validator";
import { adaptPptDirectorOutputToDesignArtifact } from "@/server/ppt-quality/ppt-director-design-adapter";
import { validatePptDesignPackage, validatePptDesignPackageForProviderProduction } from "@/server/ppt-quality/ppt-design-validator";
import type { PptDesignPackage } from "@/server/ppt-quality/ppt-quality-types";
import { createAgentToolInvocationEnvelope } from "@/server/tools/agent-tool-invocation";
import { createAgentToolExecutorFromEnv } from "@/server/tools/openai-agent-tool-executor";
import { routeAgentToolCall } from "@/server/tools/agent-tool-router";

const evidencePath = path.join(process.cwd(), "test-results", "v1-9r-ppt-director-probe.json");

async function main() {
  const source = {
    id: "probe-approved-ppt-outline",
    kind: "ppt_draft",
    nodeKey: "ppt_draft",
    title: "五年级百分数公开课十页大纲",
    summary: "以两组投篮记录为叙事线索，完成冲突、统一尺度、百分数意义、辨析、迁移和回扣。",
    markdownContent: concreteOutline(),
    structuredContent: {},
    status: "approved",
    isApproved: true,
    version: 1,
  };
  const digest = hashArtifactDraft({
    nodeKey: source.nodeKey,
    kind: source.kind,
    title: source.title,
    summary: source.summary,
    markdownContent: source.markdownContent,
    structuredContent: source.structuredContent,
  });
  const envelope = createAgentToolInvocationEnvelope({
    invocationId: `ppt-director-probe-${Date.now()}`,
    toolId: "ppt_director.plan_or_repair",
    identity: { actorUserId: "probe-teacher", actorAuthMode: "local", authSessionId: null },
    projectId: "v1-9r-ppt-director-probe",
    intentEpoch: 1,
    generationIntensity: "standard",
    sourceMessageId: "probe-source-message",
    reviewTargetRef: null,
    approvedArtifactRefs: [{ artifactId: source.id, kind: source.kind, version: source.version, digest }],
    arguments: {
      goal: "为五年级数学百分数公开课形成完整十页逐页设计，使用投篮命中率叙事，不虚构教材页码。",
      stage: "page_design",
      targetPageIds: [],
      focus: "完整逐页设计、可编辑数学层、可执行组合层、投影可读性和代表性样张计划",
    },
  });
  const executor = createAgentToolExecutorFromEnv(process.env, {
    loadContext: async () => [{
      id: source.id,
      kind: source.kind,
      title: source.title,
      summary: source.summary,
      markdownExcerpt: source.markdownContent,
      structuredContent: source.structuredContent,
      status: source.status,
      isApproved: source.isApproved,
      version: source.version,
      digest,
    }],
  });
  if (!executor) throw new Error("configured_model_channel_missing");

  const startedAt = Date.now();
  const routed = await routeAgentToolCall(envelope, { executor, authorize: async () => true });
  const elapsedMs = Date.now() - startedAt;
  if (routed.status !== "succeeded") {
    writeEvidence({
      status: "failed",
      elapsedMs,
      runtimeKind: "openai",
      agentToolChannel: agentToolChannel(),
      toolId: envelope.toolId,
      errorCategory: routed.errorCategory ?? routed.observation.kind,
      failureReason: routed.observation.internalReasonSanitized,
      artifactCreated: false,
    });
    process.exitCode = 1;
    return;
  }

  try {
    const artifact = adaptPptDirectorOutputToDesignArtifact({
      invocationId: envelope.invocationId,
      structuredOutput: routed.structuredOutput,
      approvedArtifactRefs: envelope.approvedArtifactRefs,
    });
    const design = artifact.structuredContent?.pptDesignPackage as PptDesignPackage;
    const structural = validatePptDesignPackage(design);
    const production = validatePptDesignPackageForProviderProduction(design);
    writeEvidence({
      status: "succeeded",
      elapsedMs,
      runtimeKind: "openai",
      agentToolChannel: agentToolChannel(),
      toolId: envelope.toolId,
      artifactCreated: true,
      artifactKind: artifact.kind,
      pageCount: design.pageSpecs.length,
      targetSlideCount: design.brief.targetSlideCount,
      structuralValid: structural.valid,
      productionValid: production.valid,
      structuralIssueCodes: structural.issues.map((issue) => issue.code),
      productionIssueCodes: production.issues.map((issue) => issue.code),
      evidenceBindingCount: design.evidenceBindings.length,
      directorInvocationBound: artifact.structuredContent?.directorInvocationId === envelope.invocationId,
    });
  } catch (error) {
    writeEvidence({
      status: "failed",
      elapsedMs,
      runtimeKind: "openai",
      agentToolChannel: agentToolChannel(),
      toolId: envelope.toolId,
      errorCategory: "adapter_or_quality_gate_failed",
      failureReason: error instanceof Error ? error.message : "unknown_failure",
      artifactCreated: false,
    });
    process.exitCode = 1;
  }
}

function writeEvidence(value: Record<string, unknown>) {
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  const entry = { ...value, recordedAt: new Date().toISOString() };
  const previous = readPreviousAttempts();
  writeFileSync(evidencePath, `${JSON.stringify({ ...entry, attempts: [...previous, entry] }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(value));
}

function agentToolChannel() {
  return process.env.AGENT_TOOL_MODEL_CHANNEL?.trim().toLowerCase() || "responses";
}

function readPreviousAttempts(): Record<string, unknown>[] {
  if (!existsSync(evidencePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(evidencePath, "utf8")) as Record<string, unknown>;
    if (Array.isArray(parsed.attempts)) {
      return parsed.attempts.filter((entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null && !Array.isArray(entry));
    }
    const entry = { ...parsed };
    delete entry.attempts;
    return [entry];
  } catch {
    return [];
  }
}

function concreteOutline() {
  return [
    "# 五年级数学《百分数的意义》公开课大纲",
    "",
    "已知约束：五年级、数学、百分数、10页；未提供教材版本与页码，不得虚构教材页码。",
    "",
    "1. 两名球员投中数不同，先让学生直觉选择，制造认知冲突。",
    "2. 补充两人的投篮总次数，追问怎样比较才公平。",
    "3. 将两组记录表示为投中数与总次数的关系。",
    "4. 借助百格图建立共同尺度，观察整体与部分。",
    "5. 把命中关系写成分母为100的分数，再引出百分数写法。",
    "6. 解释百分数表示一个数是另一个数的百分之几。",
    "7. 比较投篮次数不同但命中率相同的两组记录。",
    "8. 辨析命中数更多是否必然代表命中率更高。",
    "9. 迁移到完成率和折扣情境，先辨认整体。",
    "10. 回到开场选择，用命中率给出有依据的判断。",
  ].join("\n");
}

main().catch((error) => {
  writeEvidence({
    status: "failed",
    runtimeKind: "openai",
    agentToolChannel: agentToolChannel(),
    toolId: "ppt_director.plan_or_repair",
    errorCategory: "probe_setup_or_execution_failed",
    failureReason: error instanceof Error ? error.message : "unknown_failure",
    artifactCreated: false,
  });
  process.exitCode = 1;
});
