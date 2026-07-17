import { describe, expect, it, vi } from "vitest";

import {
  createBusinessToolSkillRuntime,
  createConfiguredBusinessToolSkillRuntime,
} from "@/server/skills/business-tool-skill-runtime";
import {
  businessToolSkillPolicyDigest,
  resolveBusinessToolSkillPolicy,
} from "@/server/skills/business-tool-skill-bindings";
import type { ToolExecutionResult } from "@/server/tools/tool-types";

describe("business Tool Skill runtime", () => {
  it("loads only the Skill bound to the business Tool selected by the Main Agent", async () => {
    const loadSelected = vi.fn(async () => loadedImageSkill());
    const runtime = createBusinessToolSkillRuntime({
      resolveBusinessSkillPolicy: (toolName) => toolName === "generate_video_assets" ? imageBindingPolicy(toolName) : undefined,
      loadSelected,
    });

    const context = await runtime.loadForSelectedTool({
      selectedBy: "main_agent",
      businessToolName: "generate_video_assets",
    });

    expect(loadSelected).toHaveBeenCalledWith({
      selectedBy: "main_agent",
      skillName: "shanhai-imagegen",
      referencePaths: ["references/result-contract.md"],
    });
    expect(context).toMatchObject({
      skillName: "shanhai-imagegen",
      skillVersion: "1.1",
      semanticSlice: {
        toolName: "generate_video_assets",
        guidance: [expect.objectContaining({ sourcePath: "references/result-contract.md" })],
      },
    });
    expect(context).not.toHaveProperty("instructions");
    expect(context).not.toHaveProperty("nextTool");
    expect(context).not.toHaveProperty("route");
  });

  it("loads the versioned delivery standard only after the Main Agent selects create_final_package", async () => {
    const policy = resolveBusinessToolSkillPolicy("create_final_package");
    expect(policy).toMatchObject({
      mode: "skill",
      skillName: "shanhai-delivery",
      compatibleVersions: ["1.3"],
      contracts: {
        tool: { produces: ["final_delivery"] },
        skill: { produces: [{ artifactType: "delivery-package", contractVersion: "shanhai-delivery/v2" }] },
      },
    });
    if (!policy || policy.mode !== "skill") throw new Error("Expected a delivery Skill binding.");

    const loadSelected = vi.fn(async () => loadedDeliverySkill());
    const runtime = createBusinessToolSkillRuntime({
      resolveBusinessSkillPolicy: (toolName) => toolName === "create_final_package" ? policy : undefined,
      loadSelected,
    });
    const context = await runtime.loadForSelectedTool({
      selectedBy: "main_agent",
      businessToolName: "create_final_package",
    });

    expect(loadSelected).toHaveBeenCalledWith({
      selectedBy: "main_agent",
      skillName: "shanhai-delivery",
      referencePaths: ["references/assembly-boundary.md"],
    });
    expect(context).toMatchObject({
      skillName: "shanhai-delivery",
      skillVersion: "1.3",
      semanticSlice: {
        toolName: "create_final_package",
        guidance: [{ sourcePath: "references/assembly-boundary.md" }],
      },
    });
    expect(context).not.toHaveProperty("instructions");
    expect(JSON.stringify(context)).not.toMatch(/Provider|下一 Tool|自动重试|停止整个任务|扩大授权/);
  });

  it("validates a formal Tool result with the cached Schema without exposing Schema content to the Tool context", async () => {
    const runtime = createBusinessToolSkillRuntime({
      resolveBusinessSkillPolicy: (toolName) => toolName === "generate_video_assets" ? imageBindingPolicy(toolName) : undefined,
      loadSelected: vi.fn(async () => loadedImageSkill()),
    });
    const context = await runtime.loadForSelectedTool({
      selectedBy: "main_agent",
      businessToolName: "generate_video_assets",
    });

    await expect(runtime.validateSelectedToolResult({
      businessToolName: "generate_video_assets",
      context,
      result: formalImageResult(),
    })).resolves.toMatchObject({
      status: "passed",
      bindingMode: "formal_contract",
      contract: {
        skillName: "shanhai-imagegen",
        skillVersion: "1.1",
        artifactType: "image-generation-result",
        contractVersion: "shanhai-imagegen/v2",
        adapterId: "image-result-single.v2",
        schemaDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        payloadDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    expect(JSON.stringify(context)).not.toMatch(/\$schema|additionalProperties|schemaSha256|[A-Z]:\\/);
  });

  it("loads guidance-only lesson semantics without treating the partial Tool as a formal Skill invocation", async () => {
    const policy = resolveBusinessToolSkillPolicy("create_lesson_plan");
    expect(policy).toMatchObject({
      mode: "guidance",
      skillName: "shanhai-jiaoan",
      compatibleVersions: ["1.1"],
    });
    if (!policy || policy.mode !== "guidance") throw new Error("Expected a guidance-only lesson binding.");

    const loadSelected = vi.fn(async () => loadedLessonGuidanceSkill());
    const runtime = createBusinessToolSkillRuntime({
      resolveBusinessSkillPolicy: (toolName) => toolName === "create_lesson_plan" ? policy : undefined,
      loadSelected,
    });
    const context = await runtime.loadForSelectedTool({
      selectedBy: "main_agent",
      businessToolName: "create_lesson_plan",
    });

    expect(loadSelected).toHaveBeenCalledWith({
      selectedBy: "main_agent",
      skillName: "shanhai-jiaoan",
      referencePaths: [
        "references/教案结构化字段规范.md",
        "references/教案质量门禁.md",
      ],
    });
    expect(context).toMatchObject({
      skillName: "shanhai-jiaoan",
      skillVersion: "1.1",
      semanticSlice: {
        bindingMode: "guidance_only",
        artifactContractAuthority: "tool",
        toolName: "create_lesson_plan",
        contracts: {
          tool: { consumes: [], produces: ["lesson_plan"] },
        },
      },
    });
    expect(context.semanticSlice.contracts).not.toHaveProperty("skill");
    expect(context.semanticSlice).not.toHaveProperty("capabilities");
    expect(context.semanticSlice).not.toHaveProperty("sideEffects");
    expect(context.semanticSlice).not.toHaveProperty("humanGateConditions");
    expect(JSON.stringify(context)).not.toMatch(/delivery-package|lesson-plan@shanhai-jiaoan\/v2/);
  });

  it("fails closed when a Tool has no active Skill binding", async () => {
    const runtime = createBusinessToolSkillRuntime({
      resolveBusinessSkillPolicy: () => undefined,
      loadSelected: vi.fn(),
    });

    await expect(runtime.loadForSelectedTool({
      selectedBy: "main_agent",
      businessToolName: "create_ppt_outline",
    })).rejects.toThrow(/Skill binding/i);
  });

  it("compiles a Tool-specific semantic slice and provenance without delegating orchestration authority", async () => {
    const runtime = createBusinessToolSkillRuntime({
      resolveBusinessSkillPolicy: (toolName) => ({
        toolName,
        mode: "skill" as const,
        skillName: "shanhai-imagegen",
        compatibleVersions: ["1.1"],
        referencePaths: ["references/result-contract.md"],
        contracts: {
          tool: { consumes: ["asset_brief_generate"], produces: ["asset_image_generate"] },
          skill: {
            consumes: [],
            produces: [{ artifactType: "image-generation-result", contractVersion: "shanhai-imagegen/v2" }],
          },
        },
        artifactCompatibility: {
          consumes: [{
            toolArtifactKind: "asset_brief_generate",
            skillContract: null,
            adapterId: "image-request-context.v1",
          }],
          produces: [{
            toolArtifactKind: "asset_image_generate",
            skillContract: { artifactType: "image-generation-result", contractVersion: "shanhai-imagegen/v2" },
            adapterId: "image-result-single.v2",
          }],
        },
        semanticGuidance: [{
          sourcePath: "references/result-contract.md",
          objective: "规范化当前图片Tool的真实结果。",
          rules: ["绑定真实文件、来源、Provider、模型和质量证据。"],
          exclusions: ["不得携带编排指令。"],
        }],
      }),
      loadSelected: vi.fn(async () => ({
        descriptor: {
          name: "shanhai-imagegen",
          version: "1.1",
          displayName: "山海图像生成",
          responsibility: "执行当前 Tool 已定义的图片请求",
          triggers: ["生成图片"],
          inputArtifacts: [],
          outputArtifacts: ["image-generation-result.json"],
          contracts: {
            consumes: [],
            produces: [{ artifactType: "image-generation-result", contractVersion: "shanhai-imagegen/v2" }],
          },
          capabilities: { required: ["image.generate", "artifact.write", "quality.validate"], optional: [] },
          sideEffects: ["artifact_write" as const, "external_generation" as const],
          humanGateConditions: ["missing_authorization" as const, "paid_external_generation" as const],
          upstream: [],
          downstream: [],
          status: "active" as const,
        },
        instructions: "选择 Provider A，失败后重试三次，再调用下一 Tool。",
        references: {
          "references/result-contract.md": [
            "图片用途：独立创意短片的角色参考图。",
            "Keep provider choice inside execution parameters.",
            "# Provider Profile",
            "| 顺序 | Provider ID | 默认地址 |",
            "| 1 | primary | https://provider.invalid/v1 |",
            "每个 Provider 最多执行初次调用和 2 次重试。",
            "失败后调用下一 Tool，预算耗尽时停止整个工作流。",
          ].join("\n"),
        },
        provenance: {
          entrypointSha256: `sha256:${"a".repeat(64)}`,
          referenceSha256: { "references/result-contract.md": `sha256:${"b".repeat(64)}` },
        },
      })),
    });

    const context = await runtime.loadForSelectedTool({
      selectedBy: "main_agent",
      businessToolName: "generate_video_assets",
    });

    expect(context).toMatchObject({
      skillName: "shanhai-imagegen",
      skillVersion: "1.1",
      semanticSlice: {
        schemaVersion: "business-tool-skill-slice.v1",
        toolName: "generate_video_assets",
        responsibility: "执行当前 Tool 已定义的图片请求",
        contracts: {
          tool: { consumes: ["asset_brief_generate"], produces: ["asset_image_generate"] },
        },
        guidance: [{
          sourcePath: "references/result-contract.md",
          content: "目标：规范化当前图片Tool的真实结果。\n要求：绑定真实文件、来源、Provider、模型和质量证据。\n排除：不得携带编排指令。",
        }],
      },
      provenance: {
        schemaVersion: "business-tool-skill-provenance.v1",
        entrypointSha256: `sha256:${"a".repeat(64)}`,
        references: [{ sourcePath: "references/result-contract.md", sha256: `sha256:${"b".repeat(64)}` }],
        bindingPolicyDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    expect(context).not.toHaveProperty("instructions");
    expect(JSON.stringify(context)).not.toMatch(/provider choice|Provider Profile|默认地址|初次调用|重试|下一 Tool|停止整个工作流/);
  });

  it("fails closed when the loaded Skill version is outside the Tool policy", async () => {
    const runtime = createBusinessToolSkillRuntime({
      resolveBusinessSkillPolicy: (toolName) => ({
        ...imageBindingPolicy(toolName),
        compatibleVersions: ["1.2"],
      }),
      loadSelected: vi.fn(async () => loadedImageSkill()),
    });

    await expect(runtime.loadForSelectedTool({ selectedBy: "main_agent", businessToolName: "generate_video_assets" }))
      .rejects.toThrow(/version/i);
  });

  it("binds required lazy loading to the frozen projection and policy digests across resume", async () => {
    const projectionA = "a".repeat(64);
    const projectionB = "b".repeat(64);
    const policyDigest = businessToolSkillPolicyDigest();
    const loadSelected = vi.fn(async () => loadedImageSkill());
    const registry = (projectionLockDigest: string) => ({
      discoverActive: () => [],
      get: vi.fn(),
      getProjectionLockDigest: () => projectionLockDigest,
      validateReferencePaths: async () => {},
      loadContractSchemasForLoader: async () => [],
    });
    const env = {
      NODE_ENV: "test",
      SHANHAI_SKILLS_RUNTIME_ROOT: "runtime-projection",
      SHANHAI_SKILLS_EXPECTED_PROJECTION_LOCK_DIGEST: projectionA,
      SHANHAI_SKILLS_EXPECTED_BINDING_POLICY_DIGEST: policyDigest,
    } as NodeJS.ProcessEnv;

    const matching = createConfiguredBusinessToolSkillRuntime(env, {
      openRegistry: async () => registry(projectionA),
      loadSelected,
    });
    await expect(matching!.loadForSelectedTool({
      selectedBy: "main_agent",
      businessToolName: "generate_video_assets",
    })).resolves.toMatchObject({ skillName: "shanhai-imagegen", skillVersion: "1.1" });

    const mismatched = createConfiguredBusinessToolSkillRuntime(env, {
      openRegistry: async () => registry(projectionB),
      loadSelected,
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(mismatched!.loadForSelectedTool({
        selectedBy: "main_agent",
        businessToolName: "generate_video_assets",
      })).rejects.toMatchObject({
        reasonCode: "skill_runtime_frozen_lock_mismatch",
        message: "Skill Runtime frozen lock does not match.",
      });
    }
    expect(loadSelected).toHaveBeenCalledTimes(1);
  });
});

function loadedImageSkill() {
  return {
    descriptor: {
      name: "shanhai-imagegen",
      version: "1.1",
      displayName: "山海图片生成",
      responsibility: "执行当前Tool已定义的图片请求",
      triggers: ["生成图片"],
      inputArtifacts: [],
      outputArtifacts: ["image-generation-result.json"],
      contracts: {
        consumes: [],
        produces: [{ artifactType: "image-generation-result", contractVersion: "shanhai-imagegen/v2" }],
      },
      capabilities: { required: ["image.generate", "artifact.write", "quality.validate"], optional: [] },
      sideEffects: ["artifact_write" as const, "external_generation" as const],
      humanGateConditions: ["missing_authorization" as const, "paid_external_generation" as const],
      upstream: [],
      downstream: [],
      status: "active" as const,
    },
    instructions: "只增强当前图片Tool，不选择下一Tool。",
    references: {
      "references/result-contract.md": "绑定图片结果的真实文件、来源、Provider、模型和质量证据。",
    },
    contractSchemas: [{
      artifactType: "image-generation-result",
      contractVersion: "shanhai-imagegen/v2",
      schema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        additionalProperties: false,
        required: ["schemaVersion", "mode", "sourceArtifactIds", "assets"],
        properties: {
          schemaVersion: { const: "shanhai-imagegen/v2" },
          mode: { const: "single" },
          sourceArtifactIds: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
          assets: { type: "array", minItems: 1, maxItems: 1, items: { type: "object" } },
        },
      },
      schemaSha256: `sha256:${"d".repeat(64)}`,
    }],
    provenance: {
      entrypointSha256: `sha256:${"a".repeat(64)}`,
      referenceSha256: {
        "references/result-contract.md": `sha256:${"b".repeat(64)}`,
      },
    },
  };
}

function loadedDeliverySkill() {
  return {
    descriptor: {
      name: "shanhai-delivery",
      version: "1.3",
      displayName: "山海一致交付包",
      responsibility: "装配并核验当前任务的正式一致交付包",
      triggers: ["生成完整交付包"],
      inputArtifacts: ["已验证课程成果"],
      outputArtifacts: ["delivery-package.json", "可下载ZIP"],
      contracts: {
        consumes: [
          { artifactType: "lesson-plan", contractVersion: "shanhai-jiaoan/v2" },
          { artifactType: "ppt-package", contractVersion: "1.0" },
          { artifactType: "image-generation-result", contractVersion: "shanhai-imagegen/v2" },
          { artifactType: "video-package", contractVersion: "shanhai-video/v1" },
          { artifactType: "video-generation-result", contractVersion: "shanhai-video-generation/v2" },
        ],
        produces: [{ artifactType: "delivery-package", contractVersion: "shanhai-delivery/v2" }],
      },
      capabilities: { required: ["artifact.read", "archive.write", "file.hash", "quality.validate"], optional: [] },
      sideEffects: ["artifact_write" as const],
      humanGateConditions: ["missing_authorization" as const],
      upstream: [],
      downstream: [],
      status: "active" as const,
    },
    instructions: "只校验当前Tool请求中的正式组件，不选择下一Tool。",
    references: {
      "references/assembly-boundary.md": "只装配当前任务中已持久化且通过验证的package asset。",
    },
    provenance: {
      entrypointSha256: `sha256:${"d".repeat(64)}`,
      referenceSha256: {
        "references/assembly-boundary.md": `sha256:${"e".repeat(64)}`,
      },
    },
  };
}

function loadedLessonGuidanceSkill() {
  return {
    descriptor: {
      name: "shanhai-jiaoan",
      version: "1.1",
      displayName: "山海小学教案",
      responsibility: "生成完整双输出教案并执行正式教案质量门",
      triggers: ["生成教案"],
      inputArtifacts: ["textbook-evidence.json"],
      outputArtifacts: ["lesson-plan.json", "教师可读Markdown"],
      contracts: {
        consumes: [{ artifactType: "textbook-evidence", contractVersion: "shanhai-jiaocai/v1" }],
        produces: [{ artifactType: "lesson-plan", contractVersion: "shanhai-jiaoan/v2" }],
      },
      capabilities: { required: ["source.read", "artifact.write", "quality.validate"], optional: [] },
      sideEffects: ["artifact_write" as const],
      humanGateConditions: ["missing_authorization" as const],
      upstream: [],
      downstream: [],
      status: "active" as const,
    },
    instructions: "生成正式双输出教案并调用下游能力。",
    references: {
      "references/教案结构化字段规范.md": "教案结构字段。",
      "references/教案质量门禁.md": "教案质量门。",
    },
    provenance: {
      entrypointSha256: `sha256:${"f".repeat(64)}`,
      referenceSha256: {
        "references/教案结构化字段规范.md": `sha256:${"1".repeat(64)}`,
        "references/教案质量门禁.md": `sha256:${"2".repeat(64)}`,
      },
    },
  };
}

function imageBindingPolicy(toolName: string) {
  return {
    toolName,
    mode: "skill" as const,
    skillName: "shanhai-imagegen",
    compatibleVersions: ["1.1"],
    referencePaths: ["references/result-contract.md"],
    semanticGuidance: [{
      sourcePath: "references/result-contract.md",
      objective: "规范化当前图片Tool的真实结果。",
      rules: ["绑定真实文件、来源、Provider、模型和质量证据。"],
      exclusions: ["不得携带编排指令。"],
    }],
    artifactCompatibility: {
      consumes: [{
        toolArtifactKind: "asset_brief_generate",
        skillContract: null,
        adapterId: "image-request-context.v1" as const,
      }],
      produces: [{
        toolArtifactKind: "asset_image_generate",
        skillContract: { artifactType: "image-generation-result", contractVersion: "shanhai-imagegen/v2" },
        adapterId: "image-result-single.v2" as const,
      }],
    },
    contracts: {
      tool: { consumes: ["asset_brief_generate"], produces: ["asset_image_generate"] },
      skill: {
        consumes: [],
        produces: [{ artifactType: "image-generation-result", contractVersion: "shanhai-imagegen/v2" }],
      },
    },
  };
}

function formalImageResult(): Extract<ToolExecutionResult, { status: "succeeded" }> {
  const rawSha256 = "1".repeat(64);
  const deliverySha256 = "2".repeat(64);
  const artifactTruth = {
    created: true,
    persisted: true,
    providerPersisted: true,
    workbenchPersisted: false,
    placeholder: false,
    producedArtifactKind: "asset_image_generate",
  } as const;
  const qualityGate = {
    passed: true,
    gates: ["image_valid", "raw_and_normalized_lineage_complete"],
  };
  return {
    status: "succeeded",
    toolId: "asset_image_generate",
    capabilityId: "asset_image_generate",
    provider: "minimax",
    artifactDraft: {
      nodeKey: "asset_image_generate",
      kind: "asset_image_generate",
      title: "真实图片资产",
      summary: "真实图片资产已持久化。",
      structuredContent: {
        storage: {
          imageAsset: {
            fileName: "image.png",
            localOutput: "image/image.png",
            bytes: 2048,
            sha256: deliverySha256,
            mime: "image/png",
            width: 1024,
            height: 1024,
            provider: "minimax",
            model: "image-01",
            promptDigest: "3".repeat(64),
            sourceArtifactId: "asset-brief-1",
            rawAsset: {
              fileName: "image-raw.png",
              localOutput: "image/image-raw.png",
              bytes: 4096,
              sha256: rawSha256,
              mime: "image/png",
              width: 1024,
              height: 1024,
            },
            normalizedAsset: {
              fileName: "image.png",
              localOutput: "image/image.png",
              bytes: 2048,
              sha256: deliverySha256,
              mime: "image/png",
              width: 1024,
              height: 1024,
            },
            processingChain: [{ operation: "normalize", sourceSha256: rawSha256, targetSha256: deliverySha256 }],
          },
        },
        artifactTruth,
        qualityGate,
      },
    },
    artifactTruth,
    qualityGate,
    providerPayload: { provider: "minimax", model: "image-01", artifactTruth, qualityGate },
    assistantSummary: "真实图片资产已生成。",
    budgetEvent: {
      kind: "tool_succeeded",
      status: "succeeded",
      capabilityId: "asset_image_generate",
      actionKey: "asset_image_generate:asset_image_generate",
      providerSubmitted: true,
      createdAt: "2026-07-15T00:00:00.000Z",
    },
  };
}
