import { describe, expect, it, vi } from "vitest";

import { createWorkbenchActor } from "@/server/auth/actor";
import { buildAgentHarnessBudgetEvent } from "@/server/conversation/agent-harness-budget";
import { createControlPlaneStore } from "@/server/conversation/control-plane-store";
import { createMainAgentToolLoopOptions } from "@/server/conversation/main-agent-tool-loop-config";
import { createTaskBrief, type IntentGrant } from "@/server/conversation/task-contract";
import { validateToolExecutionResult } from "@/server/contracts/contract-validator";
import { prisma } from "@/server/db/client";
import {
  BusinessToolSkillOutputContractError,
  type FormalBusinessToolOutputContractReasonCode,
} from "@/server/skills/business-tool-skill-output-contract";
import { createWorkbenchService } from "@/server/workbench/service";
import { getToolDefinition } from "@/server/tools/tool-registry";

const formalContractFailures: Array<{
  label: string;
  reasonCode: FormalBusinessToolOutputContractReasonCode;
  details: string[];
}> = [
  {
    label: "wrong schemaVersion",
    reasonCode: "formal_skill_output_schema_invalid",
    details: ["/schemaVersion must be equal to constant shanhai-imagegen/v2"],
  },
  {
    label: "missing required field",
    reasonCode: "formal_skill_output_schema_invalid",
    details: ["/assets/0/provider must have required property model"],
  },
  {
    label: "additional property",
    reasonCode: "formal_skill_output_schema_invalid",
    details: ["/assets/0 must NOT have additional properties"],
  },
  {
    label: "wrong output Adapter",
    reasonCode: "formal_skill_output_adapter_tool_mismatch",
    details: ["image-result-batch.v2 does not own generate_video_assets"],
  },
];

describe("A23 Main Agent formal Skill contract commit boundary", () => {
  it("does not let optional development mode bypass a formal Skill contract", async () => {
    const fixture = await createFormalImageFixture();
    const businessToolRouter = vi.fn(async () => successfulToolResult({
      toolId: "asset_image_generate",
      artifactKind: "asset_image_generate",
      title: "不应绕过正式合同的图片",
    }));

    try {
      const config = createMainAgentToolLoopOptions({
        service: fixture.service,
        project: fixture.project,
        triggerMessage: fixture.message,
        artifacts: [fixture.sourceArtifact],
        identity: fixture.identity,
        fence: fixture.fence,
        taskBrief: fixture.taskBrief,
        intentGrant: fixture.intentGrant,
        controlPlaneStore: fixture.controlPlaneStore,
        businessSkillRuntimeMode: "optional",
        businessToolRouter,
      });

      await expect(config!.dispatch({
        callId: `formal-runtime-missing-${crypto.randomUUID()}`,
        toolName: "generate_video_assets",
        arguments: {},
      })).resolves.toMatchObject({
        status: "blocked",
        observation: {
          nextAction: "replan",
          reasonCodes: ["skill_runtime_config_missing"],
        },
      });
      expect(businessToolRouter).not.toHaveBeenCalled();
      expect(await prisma.artifact.count({
        where: { projectId: fixture.project.id, kind: "asset_image_generate" },
      })).toBe(0);
    } finally {
      await fixture.service.releaseProjectExecutionLease(fixture.fence);
    }
  });

  it.each(formalContractFailures)(
    "persists $label as failed validation evidence and promotes no Artifact",
    async ({ reasonCode, details }) => {
      const fixture = await createFormalImageFixture();
      const validateSelectedToolResult = vi.fn(() => {
        throw new BusinessToolSkillOutputContractError(
          reasonCode,
          "Formal Skill output contract validation failed.",
          details,
        );
      });
      const skillRuntime = {
        loadForSelectedTool: vi.fn(async () => formalImageSkillContext()),
        validateSelectedToolResult,
      };
      const businessToolRouter = vi.fn(async () => successfulToolResult({
        toolId: "asset_image_generate",
        artifactKind: "asset_image_generate",
        title: "不应提交的灯塔角色资产图",
      }));

      try {
        const config = createMainAgentToolLoopOptions({
          service: fixture.service,
          project: fixture.project,
          triggerMessage: fixture.message,
          artifacts: [fixture.sourceArtifact],
          identity: fixture.identity,
          fence: fixture.fence,
          taskBrief: fixture.taskBrief,
          intentGrant: fixture.intentGrant,
          controlPlaneStore: fixture.controlPlaneStore,
          businessSkillRuntime: skillRuntime,
          businessToolRouter,
        });

        await expect(config!.dispatch({
          callId: `formal-${crypto.randomUUID()}`,
          toolName: "generate_video_assets",
          arguments: { userInstruction: "生成灯塔角色资产图" },
        })).resolves.toMatchObject({
          status: "failed",
          observation: {
            nextAction: "replan",
            reasonCodes: expect.arrayContaining([reasonCode]),
          },
        });

        expect(businessToolRouter).toHaveBeenCalledTimes(1);
        expect(validateSelectedToolResult).toHaveBeenCalledWith(expect.objectContaining({
          businessToolName: "generate_video_assets",
          context: expect.objectContaining({
            semanticSlice: expect.objectContaining({ bindingMode: "formal_contract" }),
          }),
          result: expect.objectContaining({ status: "succeeded" }),
        }));

        const invocation = await prisma.toolInvocationRecord.findFirstOrThrow({
          where: {
            projectId: fixture.project.id,
            taskId: fixture.taskBrief.taskId,
            toolName: "asset_image_generate",
          },
          orderBy: { startedAt: "desc" },
        });
        expect(invocation).toMatchObject({
          status: "failed",
          artifactId: null,
          observationId: expect.any(String),
        });

        const [report, observation, events, producedArtifacts] = await Promise.all([
          prisma.validationReportRecord.findFirst({
            where: {
              projectId: fixture.project.id,
              targetKind: "tool_invocation",
              targetId: invocation.invocationId,
            },
            orderBy: { createdAt: "desc" },
          }),
          prisma.observationRecord.findUnique({ where: { observationId: invocation.observationId! } }),
          fixture.controlPlaneStore.listEvents(fixture.project.id),
          prisma.artifact.findMany({
            where: { projectId: fixture.project.id, kind: "asset_image_generate" },
          }),
        ]);

        expect(report).toMatchObject({
          overallStatus: "failed",
          artifactId: null,
          targetKind: "tool_invocation",
          targetId: invocation.invocationId,
        });
        expect(JSON.parse(report!.payloadJson)).toMatchObject({
          overallStatus: "failed",
          gates: expect.arrayContaining([
            expect.objectContaining({ status: "failed", reasonCode }),
          ]),
        });
        expect(observation).toMatchObject({
          status: "failed",
          artifactId: null,
          invocationId: invocation.invocationId,
        });
        expect(JSON.parse(observation!.reasonCodesJson)).toEqual(expect.arrayContaining([reasonCode]));
        expect(events).toContainEqual(expect.objectContaining({
          kind: "tool_observed",
          payload: expect.objectContaining({
            observationId: observation!.observationId,
            status: "failed",
          }),
        }));
        expect(producedArtifacts).toHaveLength(0);
        expect((await fixture.service.getArtifacts(fixture.project.id)).map((artifact) => artifact.id))
          .toEqual([fixture.sourceArtifact.id]);
      } finally {
        await fixture.service.releaseProjectExecutionLease(fixture.fence);
      }
    },
  );

  it("keeps the Tool ValidationReport digest valid after formal contract validation passes", async () => {
    const fixture = await createFormalImageFixture();
    const skillRuntime = {
      loadForSelectedTool: vi.fn(async () => formalImageSkillContext()),
      validateSelectedToolResult: vi.fn(async () => ({
        status: "passed" as const,
        bindingMode: "formal_contract" as const,
        contract: {
          skillName: "shanhai-imagegen",
          skillVersion: "1.1",
          artifactType: "image-generation-result",
          contractVersion: "shanhai-imagegen/v2",
          adapterId: "image-result-single.v2",
          schemaDigest: `sha256:${"1".repeat(64)}`,
          payloadDigest: `sha256:${"2".repeat(64)}`,
        },
      })),
    };
    const businessToolRouter = vi.fn(async (routerInput) => {
      const artifactTruth = {
        created: true,
        persisted: true,
        providerPersisted: true,
        workbenchPersisted: false,
        placeholder: false,
        producedArtifactKind: "asset_image_generate",
      } as const;
      const qualityGate = { passed: true, gates: ["image_valid", "formal_skill_output_valid"] };
      const result = {
        ...successfulToolResult({
        toolId: "asset_image_generate",
        artifactKind: "asset_image_generate",
        title: "通过双重合同的灯塔角色资产图",
        }),
        artifactTruth,
        qualityGate,
      };
      return {
        ...result,
        validationReport: validateToolExecutionResult({
          tool: getToolDefinition("asset_image_generate"),
          projectId: routerInput.projectId,
          result,
          inputHash: routerInput.executionInputHash,
          intentEpoch: routerInput.executionIntentEpoch,
        }),
      };
    });

    try {
      const config = createMainAgentToolLoopOptions({
        service: fixture.service,
        project: fixture.project,
        triggerMessage: fixture.message,
        artifacts: [fixture.sourceArtifact],
        identity: fixture.identity,
        fence: fixture.fence,
        taskBrief: fixture.taskBrief,
        intentGrant: fixture.intentGrant,
        controlPlaneStore: fixture.controlPlaneStore,
        businessSkillRuntime: skillRuntime,
        businessToolRouter,
      });

      await expect(config!.dispatch({
        callId: `formal-pass-${crypto.randomUUID()}`,
        toolName: "generate_video_assets",
        arguments: { userInstruction: "生成灯塔角色资产图" },
      })).resolves.toMatchObject({ status: "succeeded" });

      const artifact = await prisma.artifact.findFirst({
        where: { projectId: fixture.project.id, kind: "asset_image_generate" },
      });
      const observation = await prisma.observationRecord.findFirst({
        where: { projectId: fixture.project.id, artifactId: artifact?.id },
      });
      expect(artifact).not.toBeNull();
      expect(JSON.parse(observation!.payloadJson)).toMatchObject({
        businessSkillContractValidation: {
          status: "passed",
          contract: {
            adapterId: "image-result-single.v2",
            schemaDigest: `sha256:${"1".repeat(64)}`,
            payloadDigest: `sha256:${"2".repeat(64)}`,
          },
        },
      });
    } finally {
      await fixture.service.releaseProjectExecutionLease(fixture.fence);
    }
  });

  it("does not execute the formal Skill Schema validator for guidance_only Tools", async () => {
    const fixture = await createGuidanceFixture();
    const validateSelectedToolResult = vi.fn(() => {
      throw new Error("guidance_only must not execute a formal Skill Schema validator");
    });
    const skillRuntime = {
      loadForSelectedTool: vi.fn(async () => lessonGuidanceContext()),
      validateSelectedToolResult,
    };
    const businessToolRouter = vi.fn(async () => successfulToolResult({
      toolId: "create_lesson_plan",
      artifactKind: "lesson_plan",
      title: "结构化教案候选",
    }));

    try {
      const config = createMainAgentToolLoopOptions({
        service: fixture.service,
        project: fixture.project,
        triggerMessage: fixture.message,
        artifacts: [fixture.sourceArtifact],
        identity: fixture.identity,
        fence: fixture.fence,
        taskBrief: fixture.taskBrief,
        intentGrant: fixture.intentGrant,
        controlPlaneStore: fixture.controlPlaneStore,
        businessSkillRuntime: skillRuntime,
        businessToolRouter,
      });

      await expect(config!.dispatch({
        callId: `guidance-${crypto.randomUUID()}`,
        toolName: "create_lesson_plan",
        arguments: {},
      })).resolves.toMatchObject({ status: "succeeded" });

      expect(skillRuntime.loadForSelectedTool).toHaveBeenCalledWith({
        selectedBy: "main_agent",
        businessToolName: "create_lesson_plan",
      });
      expect(validateSelectedToolResult).not.toHaveBeenCalled();
      expect(await prisma.artifact.count({
        where: { projectId: fixture.project.id, kind: "lesson_plan" },
      })).toBe(1);
    } finally {
      await fixture.service.releaseProjectExecutionLease(fixture.fence);
    }
  });
});

async function createFormalImageFixture() {
  return createFixture({
    goal: "只生成独立创意短片的灯塔角色资产图。",
    requestedOutputs: ["video"],
    excludedOutputs: ["lesson_plan", "ppt", "package"],
    source: {
      nodeKey: "asset_brief_generate",
      kind: "asset_brief_generate",
      title: "可信视频资产说明",
      summary: "灯塔角色、场景和关键帧说明。",
    },
  });
}

async function createGuidanceFixture() {
  return createFixture({
    goal: "根据已确认需求形成结构化教案候选。",
    requestedOutputs: ["lesson_plan"],
    excludedOutputs: ["ppt", "video", "package"],
    source: {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "已确认任务需求",
      summary: "形成当前课题的结构化教案候选。",
    },
  });
}

async function createFixture(input: {
  goal: string;
  requestedOutputs: string[];
  excludedOutputs: string[];
  source: {
    nodeKey: "asset_brief_generate" | "requirement_spec";
    kind: "asset_brief_generate" | "requirement_spec";
    title: string;
    summary: string;
  };
}) {
  const actor = createWorkbenchActor({
    userId: `teacher-${crypto.randomUUID()}`,
    displayName: "Teacher",
    authMode: "local",
  });
  const service = createWorkbenchService(undefined, actor);
  const project = await service.createProject({ title: `A23合同提交-${crypto.randomUUID()}` });
  const message = await service.addMessage(project.id, { role: "teacher", content: input.goal });
  const taskBrief = createTaskBrief({
    taskId: `task-${crypto.randomUUID()}`,
    projectId: project.id,
    intentEpoch: project.intentEpoch ?? 0,
    goal: input.goal,
    requestedOutputs: input.requestedOutputs,
    constraints: [],
    excludedOutputs: input.excludedOutputs,
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
  await prisma.conversationTurnJob.create({
    data: {
      projectId: taskBrief.projectId,
      teacherMessageId: taskBrief.sourceMessageId,
      status: "running",
      actorUserId: actor.userId,
      actorAuthMode: "local",
    },
  });
  const sourceDraft = await service.saveArtifact(project.id, {
    nodeKey: input.source.nodeKey,
    kind: input.source.kind,
    title: input.source.title,
    status: "needs_review",
    summary: input.source.summary,
    markdownContent: `# ${input.source.title}`,
    structuredContent: {
      artifactQualityState: {
        validationStatus: "passed",
        reviewStatus: "passed",
        downstreamEligibility: "eligible",
      },
    },
  });
  const sourceArtifact = await service.approveArtifact(project.id, sourceDraft.id);
  const holderId = `worker-${crypto.randomUUID()}`;
  const lease = await service.acquireProjectExecutionLease({ projectId: project.id, holderId, leaseMs: 60_000 });
  if (!lease) throw new Error("A23 test fixture could not acquire its project execution lease.");
  const fence = { projectId: project.id, holderId, fencingToken: lease.fencingToken };

  return {
    service,
    project,
    message,
    taskBrief,
    intentGrant,
    controlPlaneStore,
    sourceArtifact,
    identity: { actorUserId: actor.userId, actorAuthMode: "local" as const, authSessionId: null },
    fence,
  };
}

function formalImageSkillContext() {
  return {
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
  };
}

function lessonGuidanceContext() {
  return {
    skillName: "shanhai-jiaoan",
    skillVersion: "1.1",
    displayName: "山海小学教案",
    responsibility: "增强当前Tool的教案结构和质量语义",
    semanticSlice: {
      schemaVersion: "business-tool-skill-slice.v1" as const,
      bindingMode: "guidance_only" as const,
      artifactContractAuthority: "tool" as const,
      toolName: "create_lesson_plan",
      responsibility: "增强当前Tool的教案结构和质量语义",
      contracts: { tool: { consumes: ["requirement_spec"], produces: ["lesson_plan"] } },
      guidance: [{ sourcePath: "references/教案质量门禁.md", content: "保持教、学、评一致。" }],
    },
    provenance: {
      schemaVersion: "business-tool-skill-provenance.v1" as const,
      entrypointSha256: `sha256:${"d".repeat(64)}`,
      references: [{ sourcePath: "references/教案质量门禁.md", sha256: `sha256:${"e".repeat(64)}` }],
      bindingPolicyDigest: `sha256:${"f".repeat(64)}`,
    },
  };
}

function successfulToolResult(input: {
  toolId: string;
  artifactKind: "asset_image_generate" | "lesson_plan";
  title: string;
}) {
  return {
    status: "succeeded" as const,
    toolId: input.toolId,
    capabilityId: input.artifactKind,
    artifactDraft: {
      nodeKey: input.artifactKind,
      kind: input.artifactKind,
      title: input.title,
      summary: input.title,
      markdownContent: `# ${input.title}`,
      structuredContent: { fixture: "offline-a23-contract-commit" },
    },
    assistantSummary: input.title,
    budgetEvent: buildAgentHarnessBudgetEvent({
      capabilityId: input.artifactKind,
      actionKey: `${input.toolId}:${input.artifactKind}`,
      status: "succeeded",
      kind: "tool_succeeded",
    }),
  };
}
