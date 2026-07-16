import { describe, expect, it, vi } from "vitest";

import { createExecutionEnvelope, createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { SkillInvocationGateway, type SkillGatewayInput } from "@/server/skills/skill-invocation-gateway";
import type { RegisteredSkill, SkillInvocation, SkillResult } from "@/server/skills/skill-runtime-types";

describe("ShanHai Skill invocation gateway", () => {
  it("constructs the protocol v1 invocation behind the existing ExecutionEnvelope", async () => {
    const { taskBrief, intentGrant, executionEnvelope } = executionScope();
    const executeSkill = skillExecutor();
    const gateway = gatewayFor(skill());

    const outcome = await gateway.invoke({
      selection: {
        selectedBy: "main_agent",
        skillName: "shanhai-ppt",
        mode: "from_source",
        businessToolName: "create_ppt_outline",
        businessToolArguments: { projectId: "project-1", userInstruction: "制作课堂PPT" },
      },
      taskBrief,
      intentGrant,
      executionEnvelope,
      current: currentScope(taskBrief.digest),
      inputArtifacts: [],
      runId: "run-1",
      invocationId: "invoke-1",
      humanGateGrants: [],
      executeSkill,
    });

    expect(outcome).toMatchObject({
      kind: "candidate_result",
      promotionEligible: false,
      requiresToolResultCommit: true,
    });
    expect(executeSkill).toHaveBeenCalledTimes(1);
    expect(executeSkill.mock.calls[0][0]).toEqual({
      schemaVersion: "shanhai-skill-invocation/v1",
      invocationId: "invoke-1",
      runId: "run-1",
      projectId: "project-1",
      skill: { name: "shanhai-ppt", version: "1.0", mode: "from_source" },
      objective: "制作课堂PPT",
      inputs: [],
      constraints: {
        contentBoundary: "只制作课堂PPT",
        mustNotPreteach: ["完整教案", "视频成片"],
        language: "zh-CN",
      },
      authorization: {
        grantedCapabilities: ["artifact.read", "artifact.write", "quality.validate", "source.read"],
        allowedSideEffects: ["artifact_write"],
        humanGateGrants: [],
      },
      resumeToken: null,
    });
  });

  it("fails closed for a missing capability or stale envelope before invoking the Skill", async () => {
    const { taskBrief, intentGrant, executionEnvelope } = executionScope();
    const executeSkill = skillExecutor();
    const missingCapabilityGateway = new SkillInvocationGateway({
      resolveSkill: () => skill(),
      capabilityBindings: [{ capability: "source.read", toolName: "source_reader", available: true }],
      resolveBusinessSkillName: () => "shanhai-ppt",
      resolveBusinessToolSideEffects: () => ["artifact_write"],
    });

    expect(await missingCapabilityGateway.invoke(baseInvocation({ taskBrief, intentGrant, executionEnvelope, executeSkill }))).toMatchObject({
      kind: "blocked",
      reasonCode: "skill_capability_unavailable",
    });
    expect(executeSkill).not.toHaveBeenCalled();

    const stale = { ...executionEnvelope, planRevision: executionEnvelope.planRevision + 1 };
    expect(await gatewayFor(skill()).invoke(baseInvocation({ taskBrief, intentGrant, executionEnvelope: stale, executeSkill }))).toMatchObject({
      kind: "blocked",
      reasonCode: "execution_envelope_invalid",
    });
    expect(executeSkill).not.toHaveBeenCalled();
  });

  it("maps external generation to the existing HumanGate instead of letting the Skill self-authorize", async () => {
    const { taskBrief, executionEnvelope, intentGrant } = executionScope({
      budgetPolicyVersion: null,
      maxExternalProviderCalls: null,
    });
    const executeSkill = skillExecutor();
    const outcome = await gatewayFor(skill({ sideEffects: ["artifact_write", "external_generation"] })).invoke(
      baseInvocation({ taskBrief, intentGrant, executionEnvelope, executeSkill }),
    );

    expect(outcome).toMatchObject({
      kind: "human_gate",
      reasonCode: "budget_not_disclosed",
      pendingDecision: { kind: "budget_disclosure", projectId: "project-1", taskId: "task-1" },
    });
    expect(executeSkill).not.toHaveBeenCalled();
  });

  it("returns an unresolved business choice to Main Agent instead of creating a mechanical material-choice HumanGate", async () => {
    const { taskBrief, executionEnvelope, intentGrant } = executionScope();
    const executeSkill = skillExecutor();
    const outcome = await gatewayFor(skill()).invoke({
      ...baseInvocation({ taskBrief, intentGrant, executionEnvelope, executeSkill }),
      unresolvedBusinessChoice: true,
    });

    expect(outcome).toEqual({
      kind: "blocked",
      reasonCode: "skill_business_choice_unresolved",
    });
    expect(executeSkill).not.toHaveBeenCalled();
  });

  it("uses the selected business Tool side effect rather than gating every optional Skill capability", async () => {
    const { taskBrief, executionEnvelope, intentGrant } = executionScope({
      budgetPolicyVersion: null,
      maxExternalProviderCalls: null,
    });
    const broadSkill = skill({ sideEffects: ["artifact_write", "external_generation"] });
    const executeSkill = skillExecutor();
    const outcome = await gatewayFor(broadSkill, ["artifact_write"]).invoke(
      baseInvocation({ taskBrief, intentGrant, executionEnvelope, executeSkill }),
    );

    expect(outcome.kind).toBe("candidate_result");
    expect(executeSkill).toHaveBeenCalledTimes(1);
  });

  it("validates the ExecutionEnvelope before calculating a Skill HumanGate", async () => {
    const { taskBrief, executionEnvelope, intentGrant } = executionScope({
      budgetPolicyVersion: null,
      maxExternalProviderCalls: null,
    });
    const stale = { ...executionEnvelope, planRevision: executionEnvelope.planRevision + 1 };
    const executeSkill = skillExecutor();
    const outcome = await gatewayFor(skill({ sideEffects: ["artifact_write", "external_generation"] })).invoke(
      baseInvocation({ taskBrief, intentGrant, executionEnvelope: stale, executeSkill }),
    );

    expect(outcome).toEqual({ kind: "blocked", reasonCode: "execution_envelope_invalid" });
    expect(executeSkill).not.toHaveBeenCalled();
  });

  it("fails closed when protocol identifiers cannot satisfy the v1 invocation schema", async () => {
    const { taskBrief, executionEnvelope, intentGrant } = executionScope();
    const executeSkill = skillExecutor();
    const outcome = await gatewayFor(skill()).invoke({
      ...baseInvocation({ taskBrief, intentGrant, executionEnvelope, executeSkill }),
      runId: "invalid:run",
    });

    expect(outcome).toEqual({ kind: "blocked", reasonCode: "skill_invocation_invalid" });
    expect(executeSkill).not.toHaveBeenCalled();
  });

  it("rejects a completed result without a real artifact and never promotes artifacts directly", async () => {
    const { taskBrief, intentGrant, executionEnvelope } = executionScope();
    const executeSkill = skillExecutor(() => ({ ...completedSkillResult(), artifacts: [] }));
    const outcome = await gatewayFor(skill()).invoke(baseInvocation({ taskBrief, intentGrant, executionEnvelope, executeSkill }));

    expect(outcome).toEqual({ kind: "blocked", reasonCode: "skill_result_invalid" });
  });

  it("rejects a completed result that only points to a draft candidate", async () => {
    const { taskBrief, intentGrant, executionEnvelope } = executionScope();
    const executeSkill = skillExecutor(() => ({
      ...completedSkillResult(),
      artifacts: completedSkillResult().artifacts.map((artifact) => ({ ...artifact, status: "draft" as const })),
    }));

    await expect(gatewayFor(skill()).invoke(baseInvocation({
      taskBrief,
      intentGrant,
      executionEnvelope,
      executeSkill,
    }))).resolves.toEqual({ kind: "blocked", reasonCode: "skill_result_invalid" });
  });

  it.each([
    ["artifact type", { artifactType: "video-package" }],
    ["contract version", { contractVersion: "shanhai-ppt/v999" }],
  ] as const)("rejects a result whose %s is outside the selected Skill produces contract", async (_label, override) => {
    const { taskBrief, intentGrant, executionEnvelope } = executionScope();
    const executeSkill = skillExecutor(() => ({
      ...candidateSkillResult(),
      artifacts: candidateSkillResult().artifacts.map((artifact) => ({ ...artifact, ...override })),
    }));

    await expect(gatewayFor(skill()).invoke(baseInvocation({
      taskBrief,
      intentGrant,
      executionEnvelope,
      executeSkill,
    }))).resolves.toEqual({ kind: "blocked", reasonCode: "skill_result_invalid" });
  });

  it.each(["retry", "change_route"] as const)(
    "keeps Skill nextAction=%s advisory and does not grant retry or routing authority",
    async (nextAction) => {
      const { taskBrief, intentGrant, executionEnvelope } = executionScope();
      const executeSkill = skillExecutor(() => ({
        ...candidateSkillResult(),
        nextAction: { type: nextAction, label: "仅供 Main Agent 判断" },
      }));

      const outcome = await gatewayFor(skill()).invoke(baseInvocation({
        taskBrief,
        intentGrant,
        executionEnvelope,
        executeSkill,
      }));

      expect(executeSkill).toHaveBeenCalledTimes(1);
      expect(outcome).toMatchObject({
        kind: "candidate_result",
        orchestrationAuthority: "main_agent",
        advisoryNextAction: { type: nextAction },
        promotionEligible: false,
        requiresToolResultCommit: true,
      });
      if (outcome.kind === "candidate_result") {
        expect(outcome.result).not.toHaveProperty("nextAction");
      }
    },
  );

  it("rejects compatibility-layer selection and business Tool/Skill mismatches", async () => {
    const { taskBrief, intentGrant, executionEnvelope } = executionScope();
    const executeSkill = skillExecutor();

    expect(await gatewayFor(skill()).invoke({
      ...baseInvocation({ taskBrief, intentGrant, executionEnvelope, executeSkill }),
      selection: {
        ...baseInvocation({ taskBrief, intentGrant, executionEnvelope, executeSkill }).selection,
        selectedBy: "compatibility_layer" as "main_agent",
      },
    })).toEqual({ kind: "blocked", reasonCode: "skill_selection_not_owned_by_main_agent" });

    expect(await gatewayFor(skill()).invoke({
      ...baseInvocation({ taskBrief, intentGrant, executionEnvelope, executeSkill }),
      selection: {
        ...baseInvocation({ taskBrief, intentGrant, executionEnvelope, executeSkill }).selection,
        skillName: "shanhai-video",
      },
    })).toEqual({ kind: "blocked", reasonCode: "skill_business_tool_mismatch" });
    expect(executeSkill).not.toHaveBeenCalled();
  });
});

function gatewayFor(
  registeredSkill: RegisteredSkill,
  actualSideEffects = registeredSkill.sideEffects,
) {
  return new SkillInvocationGateway({
    resolveSkill: () => registeredSkill,
    capabilityBindings: [
      { capability: "source.read", toolName: "source_reader", available: true },
      { capability: "artifact.read", toolName: "artifact_reader", available: true },
      { capability: "artifact.write", toolName: "artifact_candidate_writer", available: true },
      { capability: "quality.validate", toolName: "quality_validator", available: true },
    ],
    resolveBusinessSkillName: (toolName) => toolName === "create_ppt_outline" ? "shanhai-ppt" : undefined,
    resolveBusinessToolSideEffects: () => actualSideEffects,
  });
}

function baseInvocation(input: {
  taskBrief: ReturnType<typeof createTaskBrief>;
  intentGrant: IntentGrant;
  executionEnvelope: ReturnType<typeof createExecutionEnvelope>;
  executeSkill: SkillGatewayInput["executeSkill"];
}): SkillGatewayInput {
  return {
    selection: {
      selectedBy: "main_agent" as const,
      skillName: "shanhai-ppt",
      mode: "from_source",
      businessToolName: "create_ppt_outline",
      businessToolArguments: { projectId: "project-1", userInstruction: "制作课堂PPT" },
    },
    taskBrief: input.taskBrief,
    intentGrant: input.intentGrant,
    executionEnvelope: input.executionEnvelope,
    current: currentScope(input.taskBrief.digest),
    inputArtifacts: [],
    runId: "run-1",
    invocationId: "invoke-1",
    humanGateGrants: [],
    executeSkill: input.executeSkill,
  };
}

function executionScope(grantOverrides: Partial<IntentGrant> = {}) {
  const taskBrief = createTaskBrief({
    taskId: "task-1",
    projectId: "project-1",
    intentEpoch: 2,
    goal: "制作课堂PPT",
    requestedOutputs: ["课堂PPT"],
    constraints: ["只制作课堂PPT"],
    excludedOutputs: ["完整教案", "视频成片"],
    generationIntensity: "standard",
    sourceMessageId: "message-1",
  });
  const intentGrant: IntentGrant = {
    schemaVersion: "intent-grant.v1",
    taskId: "task-1",
    projectId: "project-1",
    intentEpoch: 2,
    standardWorkAuthorized: true,
    intensity: "standard",
    budgetPolicyVersion: "v1-standard",
    maxCostCredits: null,
    maxExternalProviderCalls: 3,
    requiredCheckpoints: [],
    expiresAt: null,
    ...grantOverrides,
  };
  const businessToolArguments = { projectId: "project-1", userInstruction: "制作课堂PPT" };
  const executionEnvelope = createExecutionEnvelope({
    actorUserId: "user-1",
    taskBrief,
    planRevision: 4,
    intensity: "standard",
    intentGrant,
    action: { toolName: "create_ppt_outline", arguments: businessToolArguments },
  });
  return { taskBrief, intentGrant, executionEnvelope };
}

function currentScope(taskBriefDigest: string) {
  return {
    actorUserId: "user-1",
    projectId: "project-1",
    taskId: "task-1",
    intentEpoch: 2,
    planRevision: 4,
    intensity: "standard" as const,
    taskBriefDigest,
  };
}

function skill(overrides: Partial<RegisteredSkill> = {}): RegisteredSkill {
  return {
    name: "shanhai-ppt",
    version: "1.0",
    displayName: "山海课件",
    responsibility: "制作课堂PPT",
    triggers: ["制作课堂PPT"],
    inputArtifacts: ["原始材料"],
    outputArtifacts: ["ppt-package.json"],
    contracts: { consumes: [], produces: [{ artifactType: "ppt-package", contractVersion: "1.0", schemaPath: "schema.json" }] },
    capabilities: { required: ["source.read", "artifact.read", "artifact.write", "quality.validate"], optional: [] },
    sideEffects: ["artifact_write"],
    humanGateConditions: ["business_choice", "missing_authorization"],
    upstream: [],
    downstream: [],
    status: "active",
    directory: "shanhai-ppt-1.0",
    entrypoint: "SKILL.md",
    skillRoot: "C:/fixture/shanhai-ppt-1.0",
    entrypointPath: "C:/fixture/shanhai-ppt-1.0/SKILL.md",
    ...overrides,
  };
}

function completedSkillResult(): SkillResult {
  const candidate = candidateSkillResult();
  return {
    ...candidate,
    status: "completed",
    artifacts: candidate.artifacts.map((artifact) => ({ ...artifact, status: "completed" })),
    nextAction: { type: "none", label: "本阶段已完成" },
    resumeToken: null,
  };
}

function candidateSkillResult(): SkillResult {
  return {
    schemaVersion: "shanhai-skill-result/v1" as const,
    invocationId: "invoke-1",
    runId: "run-1",
    skill: { name: "shanhai-ppt", version: "1.0" },
    status: "needs_review" as const,
    artifacts: [{
      schemaVersion: "shanhai-artifact-ref/v1" as const,
      artifactId: "ppt-candidate-1",
      artifactType: "ppt-package",
      contractVersion: "1.0",
      locator: "candidate:ppt-candidate-1",
      mediaType: "application/json",
      digest: `sha256:${"a".repeat(64)}`,
      sourceSkill: "shanhai-ppt",
      sourceVersion: "1.0",
      status: "draft" as const,
    }],
    messages: [{ code: "candidate_ready", text: "候选已生成，等待统一提交。" }],
    nextAction: { type: "continue" as const, label: "返回 Main Agent" },
    error: null,
    resumeToken: "resume-1",
  };
}

function skillExecutor(factory: () => SkillResult = candidateSkillResult) {
  return vi.fn(async (_invocation: SkillInvocation, _skill: RegisteredSkill): Promise<SkillResult> => factory());
}
