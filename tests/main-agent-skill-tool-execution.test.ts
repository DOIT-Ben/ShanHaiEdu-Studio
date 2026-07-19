import { describe, expect, it, vi } from "vitest";

import { buildAgentHarnessBudgetEvent } from "@/server/conversation/agent-harness-budget";
import { validateToolExecutionResult } from "@/server/contracts/contract-validator";
import { resolveRuntimeContract } from "@/server/contracts/runtime-contract";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { createMainAgentToolLoopOptions } from "@/server/conversation/main-agent-tool-loop-config";
import { createTaskBrief, type IntentGrant, type TaskBrief } from "@/server/conversation/task-contract";
import { createWorkbenchActor } from "@/server/auth/actor";
import { createWorkbenchService } from "@/server/workbench/service";
import { prisma } from "@/server/db/client";
import { getToolDefinition } from "@/server/tools/tool-registry";

describe("Main Agent business Tool Skill execution", () => {
  it("fails closed in required mode when a Skill-bound Tool has no Runtime", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `Skill required-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "只生成独立短片的灯塔角色资产图。" });
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`, projectId: project.id, intentEpoch: 0, goal: message.content,
      requestedOutputs: ["video"], constraints: [], excludedOutputs: ["lesson_plan", "ppt", "package"], generationIntensity: "standard", sourceMessageId: message.id,
    });
    const intentGrant: IntentGrant = {
      schemaVersion: "intent-grant.v1", taskId: taskBrief.taskId, projectId: project.id, intentEpoch: 0,
      standardWorkAuthorized: true, intensity: "standard", budgetPolicyVersion: "v1-standard-task-scope.v1",
      maxCostCredits: null, maxExternalProviderCalls: 2, requiredCheckpoints: [], expiresAt: null,
    };
    const controlPlaneStore = createControlPlaneStore();
    await controlPlaneStore.upsertTaskAggregate({
      taskBrief, intentGrant, plan: { planId: `plan:${taskBrief.taskId}`, revision: 0, status: "active" }, status: "active", checkpoint: null,
    });
    await createRunningTurn(taskBrief, actor.userId);
    const assetBriefDraft = await service.saveArtifact(project.id, {
      nodeKey: "asset_brief_generate", kind: "asset_brief_generate", title: "可信视频资产说明", status: "needs_review",
      summary: "灯塔角色、场景和关键帧说明。", markdownContent: "# 视频资产说明",
      structuredContent: { artifactQualityState: { validationStatus: "passed", reviewStatus: "passed", downstreamEligibility: "eligible" } },
    });
    const assetBrief = await service.approveArtifact(project.id, assetBriefDraft.id);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const businessToolRouter = vi.fn();
    try {
      const config = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts: [assetBrief],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        taskBrief, intentGrant, controlPlaneStore, businessSkillRuntimeMode: "required", businessToolRouter,
      });
      await expect(config!.dispatch({ callId: "assets", toolName: "generate_video_assets", arguments: {} }))
        .resolves.toMatchObject({ status: "blocked", observation: { reasonCodes: ["skill_runtime_config_missing"], nextAction: "pause" } });
      expect(businessToolRouter).not.toHaveBeenCalled();
      const missingRuntimeInvocation = await prisma.toolInvocationRecord.findFirst({
        where: { projectId: project.id, taskId: taskBrief.taskId, toolName: "asset_image_generate" },
        orderBy: { startedAt: "desc" },
      });
      expect(missingRuntimeInvocation).toMatchObject({
        status: "failed",
        artifactId: null,
        observationId: expect.any(String),
      });
      expect(await prisma.validationReportRecord.findFirst({
        where: {
          projectId: project.id,
          targetKind: "tool_invocation",
          targetId: missingRuntimeInvocation!.invocationId,
        },
      })).toMatchObject({ overallStatus: "failed" });
      expect(await prisma.observationRecord.findFirst({
        where: { projectId: project.id, invocationId: missingRuntimeInvocation!.invocationId },
      })).toMatchObject({ status: "failed", artifactId: null });
      expect(await controlPlaneStore.listEvents(project.id)).toContainEqual(expect.objectContaining({
        kind: "tool_observed",
        payload: expect.objectContaining({ status: "failed" }),
      }));
      expect((await service.getArtifacts(project.id)).map((artifact) => artifact.id)).toEqual([assetBrief.id]);
      const resumedAggregate = await controlPlaneStore.getTaskAggregate(project.id, taskBrief.intentEpoch);
      expect(resumedAggregate).toMatchObject({ plan: { revision: 1 } });

      const frozenMismatch = createMainAgentToolLoopOptions({
        service, project, triggerMessage: message, artifacts: [assetBrief],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null }, fence,
        taskBrief, intentGrant, planRevision: resumedAggregate!.plan.revision,
        controlPlaneStore, businessSkillRuntimeMode: "required", businessToolRouter,
        businessSkillRuntime: {
          loadForSelectedTool: vi.fn(async () => {
            throw Object.assign(new Error("private projection path must not leak"), {
              reasonCode: "skill_runtime_frozen_lock_mismatch",
            });
          }),
          validateSelectedToolResult: vi.fn(async () => {
            throw new Error("validation_must_not_run_after_load_failure");
          }),
        },
      });
      await expect(frozenMismatch!.dispatch({
        callId: "outline-frozen",
        toolName: "generate_video_assets",
        arguments: { userInstruction: "验证冻结投影" },
      }))
        .resolves.toMatchObject({
          status: "blocked",
          observation: { reasonCodes: ["skill_runtime_frozen_lock_mismatch"], nextAction: "pause" },
        });
      const invocation = await prisma.toolInvocationRecord.findFirst({
        where: { projectId: project.id, taskId: taskBrief.taskId, toolName: "asset_image_generate" },
        orderBy: { startedAt: "desc" },
      });
      expect(invocation).toMatchObject({
        status: "failed",
        artifactId: null,
        observationId: expect.any(String),
      });
      const observation = await prisma.observationRecord.findFirst({
        where: { projectId: project.id, invocationId: invocation!.invocationId },
      });
      expect(JSON.parse(observation!.reasonCodesJson)).toContain("skill_runtime_frozen_lock_mismatch");
      expect(await controlPlaneStore.listEvents(project.id)).toContainEqual(expect.objectContaining({
        kind: "tool_observed",
        payload: expect.objectContaining({ observationId: observation!.observationId, status: "failed" }),
      }));
      expect(await prisma.validationReportRecord.findFirst({
        where: { projectId: project.id, targetKind: "tool_invocation", targetId: invocation!.invocationId },
      })).toMatchObject({ overallStatus: "failed" });
      expect((await service.getArtifacts(project.id)).map((artifact) => artifact.id)).toEqual([assetBrief.id]);
      expect(JSON.stringify(await frozenMismatch!.dispatch({
        callId: "outline-frozen-resume",
        toolName: "generate_video_assets",
        arguments: { userInstruction: "验证冻结投影" },
      }))).not.toContain("private projection path");
      expect(businessToolRouter).not.toHaveBeenCalled();
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });

  it("loads the bound Skill only after the Main Agent selects a business Tool and forwards it to that Tool", async () => {
    const actor = createWorkbenchActor({ userId: `teacher-${crypto.randomUUID()}`, displayName: "Teacher", authMode: "local" });
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: `Skill执行-${crypto.randomUUID()}` });
    const message = await service.addMessage(project.id, { role: "teacher", content: "只生成独立短片的灯塔角色资产图。" });
    const taskBrief = createTaskBrief({
      taskId: `task-${crypto.randomUUID()}`,
      projectId: project.id,
      intentEpoch: project.intentEpoch ?? 0,
      goal: message.content,
      requestedOutputs: ["video"],
      constraints: [],
      excludedOutputs: ["lesson_plan", "ppt", "package"],
      generationIntensity: "standard",
      sourceMessageId: message.id,
    });
    const intentGrant: IntentGrant = {
      schemaVersion: "intent-grant.v1",
      taskId: taskBrief.taskId,
      projectId: taskBrief.projectId,
      intentEpoch: taskBrief.intentEpoch,
      standardWorkAuthorized: true,
      intensity: "standard",
      budgetPolicyVersion: "v1-standard-task-scope.v1",
      maxCostCredits: null,
      maxExternalProviderCalls: 2,
      requiredCheckpoints: [],
      expiresAt: null,
    };
    const controlPlaneStore = createControlPlaneStore();
    await controlPlaneStore.upsertTaskAggregate({
      taskBrief,
      intentGrant,
      plan: { planId: `plan:${taskBrief.taskId}`, revision: 0, status: "active" },
      status: "active",
      checkpoint: null,
    });
    await createRunningTurn(taskBrief, actor.userId);
    const assetBriefDraft = await service.saveArtifact(project.id, {
      nodeKey: "asset_brief_generate",
      kind: "asset_brief_generate",
      title: "可信视频资产说明",
      status: "needs_review",
      summary: "灯塔角色、场景和关键帧说明。",
      markdownContent: "# 视频资产说明",
      structuredContent: {
        artifactQualityState: {
          validationStatus: "passed",
          reviewStatus: "passed",
          downstreamEligibility: "eligible",
        },
      },
    });
    const assetBrief = await service.approveArtifact(project.id, assetBriefDraft.id);
    const holderId = `worker-${crypto.randomUUID()}`;
    const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
    const fence = { projectId: project.id, holderId, fencingToken: lease!.fencingToken };
    const skillRuntime = {
      loadForSelectedTool: vi.fn(async () => ({
        skillName: "shanhai-imagegen",
        skillVersion: "1.1",
        displayName: "山海图片生成",
        responsibility: "执行当前Tool已定义的图片请求",
        semanticSlice: {
          schemaVersion: "business-tool-skill-slice.v1" as const,
          bindingMode: "formal_contract" as const,
          artifactContractAuthority: "skill" as const,
          toolName: "generate_video_assets",
          responsibility: "执行当前Tool已定义的图片请求",
          contracts: {
            tool: { consumes: ["asset_brief_generate"], produces: ["asset_image_generate"] },
            skill: {
              consumes: [],
              produces: [{ artifactType: "image-generation-result", contractVersion: "shanhai-imagegen/v2" }],
            },
          },
          guidance: [{ sourcePath: "references/result-contract.md", content: "绑定真实图片结果与质量证据。" }],
        },
        provenance: {
          schemaVersion: "business-tool-skill-provenance.v1" as const,
          entrypointSha256: `sha256:${"a".repeat(64)}`,
          references: [{ sourcePath: "references/result-contract.md", sha256: `sha256:${"b".repeat(64)}` }],
          bindingPolicyDigest: `sha256:${"c".repeat(64)}`,
        },
      })),
      validateSelectedToolResult: vi.fn(async () => ({
        status: "passed" as const,
        bindingMode: "formal_contract" as const,
        contract: {
          skillName: "shanhai-imagegen",
          skillVersion: "1.1",
          artifactType: "image-generation-result",
          contractVersion: "shanhai-imagegen/v2",
          adapterId: "image-result-single.v2",
          schemaDigest: `sha256:${"d".repeat(64)}`,
          payloadDigest: `sha256:${"e".repeat(64)}`,
        },
      })),
    };
    const businessToolRouter = vi.fn(async (input) => {
      const artifactDraft = {
        nodeKey: "asset_image_generate" as const,
        kind: "asset_image_generate" as const,
        title: "灯塔角色资产图",
        summary: "独立短片角色参考图。",
        markdownContent: "# 灯塔角色资产图",
        structuredContent: { skillName: input.businessSkillContext?.skillName },
      };
      const tool = getToolDefinition("asset_image_generate");
      const contract = resolveRuntimeContract(tool);
      const result = {
        status: "succeeded" as const,
        toolId: tool.id,
        capabilityId: contract.capabilityId,
        provider: "provider-contract-test",
        artifactDraft,
        artifactTruth: {
          created: true,
          persisted: true,
          persistenceScope: "provider_local_file" as const,
          providerPersisted: true,
          workbenchPersisted: false,
          placeholder: false,
          producedArtifactKind: "asset_image_generate",
        },
        qualityGate: { passed: true, gates: ["image_valid", "supported_image_mime"] },
        assistantSummary: "视频资产图已形成。",
        budgetEvent: buildAgentHarnessBudgetEvent({
          capabilityId: "asset_image_generate",
          actionKey: "asset_image_generate:asset_image_generate",
          status: "succeeded",
          kind: "tool_succeeded",
        }),
      };
      return {
        ...result,
        validationReport: validateToolExecutionResult({
          tool,
          projectId: project.id,
          result,
          inputHash: input.executionInputHash!,
          intentEpoch: taskBrief.intentEpoch,
        }),
      };
    });

    try {
      const config = createMainAgentToolLoopOptions({
        service,
        project,
        triggerMessage: message,
        artifacts: [assetBrief],
        identity: { actorUserId: actor.userId, actorAuthMode: "local", authSessionId: null },
        fence,
        taskBrief,
        intentGrant,
        controlPlaneStore,
        businessSkillRuntime: skillRuntime,
        businessToolRouter,
      });

      expect(skillRuntime.loadForSelectedTool).not.toHaveBeenCalled();
      expect(config?.allowedToolNames).toContain("generate_video_assets");
      await expect(config!.dispatch({ callId: "assets", toolName: "generate_video_assets", arguments: {} }))
        .resolves.toMatchObject({ status: "succeeded" });

      expect(skillRuntime.loadForSelectedTool).toHaveBeenCalledWith({
        selectedBy: "main_agent",
        businessToolName: "generate_video_assets",
      });
      expect(skillRuntime.validateSelectedToolResult).toHaveBeenCalledWith(expect.objectContaining({
        businessToolName: "generate_video_assets",
        context: expect.objectContaining({ skillName: "shanhai-imagegen" }),
        result: expect.objectContaining({ status: "succeeded" }),
      }));
      expect(businessToolRouter).toHaveBeenCalledWith(expect.objectContaining({
        businessSkillContext: expect.objectContaining({ skillName: "shanhai-imagegen", skillVersion: "1.1" }),
      }));
    } finally {
      await service.releaseProjectExecutionLease(fence);
    }
  });
});

async function createRunningTurn(taskBrief: TaskBrief, actorUserId: string) {
  await prisma.conversationTurnJob.create({
    data: {
      projectId: taskBrief.projectId,
      teacherMessageId: taskBrief.sourceMessageId,
      status: "running",
      actorUserId,
      actorAuthMode: "local",
    },
  });
}
