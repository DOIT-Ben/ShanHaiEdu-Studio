import { describe, expect, it } from "vitest";
import { executeProviderTool, type ProviderToolAdapterInput } from "@/server/tools/provider-tool-adapter";
import { getToolDefinition } from "@/server/tools/tool-registry";
import type { ToolDefinition } from "@/server/tools/tool-types";

const forbiddenSensitiveText = /token|providerMode|API|api[_-]?key|Bearer\s+\S+|C:\\|\\Users\\|local path|SECRET|credential/i;

function pptDesignRef(overrides: Partial<ProviderToolAdapterInput["artifactRefs"][number]> = {}): ProviderToolAdapterInput["artifactRefs"][number] {
  return {
    kind: "ppt_design_draft",
    artifactId: "artifact-ppt-design-a",
    title: "逐页 PPT 设计稿",
    summary: "已确认的逐页四层设计稿",
    markdownContent: "第 1 页：底图：白板；元素：百分数问题；文字：百分数导入；排版：左文右图。",
    ...overrides,
  };
}

function unsupportedProviderTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "image_asset",
    label: "生成图片",
    description: "生成课堂图片素材。",
    adapterKind: "provider",
    capabilityId: "image_asset",
    providerToolId: "image_asset.generate",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        projectId: { type: "string" },
        userInstruction: { type: ["string", "null"] },
      },
      required: ["projectId", "userInstruction"],
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        artifactKind: { type: "string", const: "image_asset" },
        summary: { type: "string" },
      },
      required: ["artifactKind", "summary"],
    },
    requiresHumanGate: true,
    sideEffectLevel: "external_call",
    requiredArtifactKinds: [],
    producedArtifactKind: "image_asset",
    failurePolicy: { retryable: false, maxRetries: 0, onFailure: "record_observation" },
    implemented: true,
    ...overrides,
  };
}

describe("M64-C ProviderToolAdapter", () => {
  it("wraps coze_ppt success through an injected provider runner without saving artifacts", async () => {
    const tool = getToolDefinition("generate_pptx_from_design");
    let calledWith: unknown;

    const result = await executeProviderTool({
      tool,
      projectId: "project-a",
      userInstruction: "请生成真实 PPTX",
      artifactRefs: [pptDesignRef()],
      sourceMessageId: "message-a",
      runCozePpt: async (input) => {
        calledWith = input;
        return {
          fileName: "lesson.pptx",
          localOutput: ".tmp/lesson.pptx",
          bytes: 2048,
          sha256: "sha256-value",
          requestedPageCount: 1,
          slideCount: 1,
          pptxValid: true,
          hasPresentationXml: true,
        };
      },
    });

    expect(calledWith).toMatchObject({
      project: { id: "project-a" },
      artifact: {
        id: "artifact-ppt-design-a",
        kind: "ppt_design_draft",
        nodeKey: "ppt_design_draft",
      },
    });
    expect(result).toMatchObject({
      status: "succeeded",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
      provider: "coze_ppt",
      artifactDraft: {
        nodeKey: "pptx_artifact",
        kind: "pptx_artifact",
        title: "真实 PPTX 文件",
        structuredContent: {
          provider: "coze_ppt",
          fileName: "lesson.pptx",
          localOutput: ".tmp/lesson.pptx",
          bytes: 2048,
          sha256: "sha256-value",
          mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          slideCount: 1,
          pptxValid: true,
          artifactTruth: {
            created: true,
            persisted: true,
            persistenceScope: "provider_local_file",
            providerPersisted: true,
            workbenchPersisted: false,
            placeholder: false,
            producedArtifactKind: "pptx_artifact",
          },
          qualityGate: {
            passed: true,
            gates: expect.arrayContaining(["pptx_valid", "presentation_xml_present", "slide_count_matches_design"]),
          },
        },
      },
      artifactTruth: {
        created: true,
        persisted: true,
        persistenceScope: "provider_local_file",
        providerPersisted: true,
        workbenchPersisted: false,
        placeholder: false,
        producedArtifactKind: "pptx_artifact",
      },
      qualityGate: {
        passed: true,
        gates: expect.arrayContaining(["pptx_valid", "presentation_xml_present", "slide_count_matches_design"]),
      },
      providerPayload: {
        localOutput: ".tmp/lesson.pptx",
        bytes: 2048,
        sha256: "sha256-value",
        mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        artifactTruth: {
          created: true,
          persisted: true,
          persistenceScope: "provider_local_file",
          providerPersisted: true,
          workbenchPersisted: false,
          placeholder: false,
          producedArtifactKind: "pptx_artifact",
        },
        qualityGate: {
          passed: true,
          gates: expect.arrayContaining(["pptx_valid", "presentation_xml_present", "slide_count_matches_design"]),
        },
      },
      assistantSummary: expect.stringContaining("PPTX"),
      budgetEvent: {
        capabilityId: "coze_ppt",
        status: "succeeded",
        kind: "tool_succeeded",
      },
    });
    expect("artifactCreated" in result).toBe(false);
    expect("observation" in result).toBe(false);
  });

  it("maps invalid ppt design and validation failures to quality gate failures without artifact creation", async () => {
    const result = await executeProviderTool({
      tool: getToolDefinition("generate_pptx_from_design"),
      projectId: "project-a",
      userInstruction: "生成 PPTX",
      artifactRefs: [pptDesignRef()],
      runCozePpt: async () => {
        throw new Error("invalid PPT design: validation failed, slide count mismatch");
      },
    });

    expect(result).toMatchObject({
      status: "failed",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
      provider: "coze_ppt",
      artifactCreated: false,
      errorCategory: "quality_gate_failed",
      observation: {
        kind: "quality_gate_failed",
        artifactCreated: false,
        retryPolicy: {
          retryable: false,
          nextAction: "ask_teacher",
        },
      },
      budgetEvent: {
        capabilityId: "coze_ppt",
        status: "failed",
        kind: "quality_gate_failed",
      },
    });
  });

  it("normalizes provider runner failure into a provider unavailable observation and budget event", async () => {
    const result = await executeProviderTool({
      tool: getToolDefinition("generate_pptx_from_design"),
      projectId: "project-a",
      userInstruction: "生成 PPTX",
      artifactRefs: [pptDesignRef()],
      runCozePpt: async () => {
        throw new Error("coze provider timeout token=secret API_KEY=abc C:\\Users\\HB\\secret.pptx providerMode=openapi");
      },
    });

    expect(result).toMatchObject({
      status: "retryable_failed",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
      provider: "coze_ppt",
      artifactCreated: false,
      errorCategory: "provider_unavailable",
      observation: {
        kind: "provider_unavailable",
        artifactCreated: false,
      },
      budgetEvent: {
        capabilityId: "coze_ppt",
        status: "retryable_failed",
        kind: "provider_unavailable",
      },
    });
  });

  it("blocks coze_ppt when the required ppt_design_draft source artifact is missing and does not call the runner", async () => {
    let called = false;

    const result = await executeProviderTool({
      tool: getToolDefinition("generate_pptx_from_design"),
      projectId: "project-a",
      userInstruction: "生成 PPTX",
      artifactRefs: [{ kind: "lesson_plan", artifactId: "artifact-lesson-plan-a" }],
      runCozePpt: async () => {
        called = true;
        throw new Error("should_not_call_provider");
      },
    });

    expect(called).toBe(false);
    expect(result).toMatchObject({
      status: "needs_input",
      toolId: "generate_pptx_from_design",
      capabilityId: "coze_ppt",
      missingInputs: ["ppt_design_draft"],
      artifactCreated: false,
      observation: {
        kind: "blocked_by_policy",
        artifactCreated: false,
      },
      budgetEvent: {
        status: "blocked",
        kind: "blocked_by_policy",
      },
    });
  });

  it("safely fails unsupported image and video provider tools without invoking real providers", async () => {
    let called = false;

    for (const tool of [unsupportedProviderTool(), unsupportedProviderTool({ id: "intro_video", capabilityId: "intro_video", providerToolId: "intro_video.generate", producedArtifactKind: "intro_video" })]) {
      const result = await executeProviderTool({
        tool,
        projectId: "project-a",
        userInstruction: "生成素材",
        artifactRefs: [pptDesignRef()],
        runCozePpt: async () => {
          called = true;
          throw new Error("should_not_call_coze_for_unsupported_tools");
        },
      });

      expect(result).toMatchObject({
        status: "failed",
        toolId: tool.id,
        capabilityId: tool.capabilityId,
        artifactCreated: false,
        observation: {
          kind: "tool_failed",
          artifactCreated: false,
        },
        budgetEvent: {
          status: "failed",
          kind: "tool_failed",
        },
      });
      if ("observation" in result) {
        expect(result.observation.teacherSafeSummary).not.toMatch(forbiddenSensitiveText);
        expect(result.observation.internalReasonSanitized).not.toMatch(forbiddenSensitiveText);
      }
    }

    expect(called).toBe(false);
  });

  it("redacts sensitive provider error details from teacher-safe observations", async () => {
    const result = await executeProviderTool({
      tool: getToolDefinition("generate_pptx_from_design"),
      projectId: "project-a",
      artifactRefs: [pptDesignRef()],
      runCozePpt: async () => {
        throw new Error("token=abc providerMode=cli API_KEY=sk-secret path=C:\\Users\\HB\\secret\\ppt.pptx Bearer abc.def");
      },
    });

    expect(result.status).toBe("retryable_failed");
    if ("observation" in result) {
      expect(result.observation.teacherSafeSummary).not.toMatch(forbiddenSensitiveText);
      expect(result.observation.internalReasonSanitized).not.toMatch(forbiddenSensitiveText);
    }
  });
});
