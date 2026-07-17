import type { CapabilityId } from "@/server/capabilities/types";
import type { JsonSchemaObject, ToolDefinition, ToolFailurePolicy, ToolSideEffectLevel } from "./tool-types";

const defaultFailurePolicy: ToolFailurePolicy = {
  retryable: true,
  maxRetries: 1,
  onFailure: "record_observation",
};

function baseInputSchema(): JsonSchemaObject {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      projectId: { type: "string", minLength: 1 },
      userInstruction: { type: ["string", "null"] },
    },
    required: ["projectId", "userInstruction"],
  };
}

function requiredArtifactKindSchema(kind: string): JsonSchemaObject {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: { type: "string", const: kind },
      artifactId: { type: "string", minLength: 1 },
    },
    required: ["kind", "artifactId"],
  };
}

function artifactRefsSchema(requiredArtifactKinds: string[]): Record<string, unknown> {
  return {
    type: "array",
    minItems: requiredArtifactKinds.length,
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: requiredArtifactKinds },
        artifactId: { type: "string", minLength: 1 },
      },
      required: ["kind", "artifactId"],
    },
    allOf: requiredArtifactKinds.map((kind) => ({ contains: requiredArtifactKindSchema(kind) })),
  };
}

const emptyInputSchema: JsonSchemaObject = baseInputSchema();

function artifactInputSchema(requiredArtifactKinds: string[]): JsonSchemaObject {
  if (requiredArtifactKinds.length === 0) {
    return baseInputSchema();
  }

  return {
    type: "object",
    additionalProperties: false,
    properties: {
      projectId: { type: "string", minLength: 1 },
      userInstruction: { type: ["string", "null"] },
      artifactRefs: artifactRefsSchema(requiredArtifactKinds),
    },
    required: ["projectId", "userInstruction", "artifactRefs"],
  };
}

function videoSegmentInputSchema(): JsonSchemaObject {
  const schema = artifactInputSchema(["video_segment_plan", "storyboard_generate", "asset_image_generate"]);
  return {
    ...schema,
    properties: {
      ...schema.properties,
      shotIds: {
        type: "array",
        minItems: 1,
        maxItems: 1,
        uniqueItems: true,
        items: { type: "string", pattern: "^shot_[A-Za-z0-9_-]+$" },
      },
    },
    required: [...(schema.required ?? []), "shotIds"],
  };
}

function finalPackageInputSchema(requiredArtifactKinds: string[]): JsonSchemaObject {
  const schema = artifactInputSchema(requiredArtifactKinds);
  return {
    ...schema,
    properties: {
      ...schema.properties,
      classroomRunSpecDraft: {
        type: "object",
        additionalProperties: false,
        required: ["schemaVersion", "courseAnchor", "sequence"],
        properties: {
          schemaVersion: { type: "string", const: "classroom-run-spec-draft.v1" },
          courseAnchor: { type: "string", minLength: 1 },
          sequence: {
            type: "array",
            minItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["ordinal", "action", "artifactRole", "pptPage", "instruction"],
              properties: {
                ordinal: { type: "integer", minimum: 1 },
                action: { type: "string", enum: ["play_intro_video", "ask_return_question", "open_ppt", "teacher_explain", "reveal_answer"] },
                artifactRole: { type: ["string", "null"], enum: ["lesson_plan", "pptx", "pdf", "image", "video", null] },
                pptPage: { type: ["integer", "null"], minimum: 1 },
                instruction: { type: "string", minLength: 1 },
              },
            },
          },
        },
      },
    },
    required: [...(schema.required ?? []), "classroomRunSpecDraft"],
  };
}

function artifactOutputSchema(producedArtifactKind: string): JsonSchemaObject {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      artifactKind: { type: "string", const: producedArtifactKind },
      summary: { type: "string" },
    },
    required: ["artifactKind", "summary"],
  };
}

function internalTool(definition: {
  id: string;
  label: string;
  description: string;
  capabilityId: CapabilityId;
  requiredArtifactKinds: string[];
  producedArtifactKind: string;
  sideEffectLevel?: ToolSideEffectLevel;
}): ToolDefinition {
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    adapterKind: "internal_capability",
    capabilityId: definition.capabilityId,
    inputSchema: definition.requiredArtifactKinds.length > 0 ? artifactInputSchema(definition.requiredArtifactKinds) : emptyInputSchema,
    outputSchema: artifactOutputSchema(definition.producedArtifactKind),
    requiresHumanGate: false,
    sideEffectLevel: definition.sideEffectLevel ?? "artifact_write",
    requiredArtifactKinds: definition.requiredArtifactKinds,
    producedArtifactKind: definition.producedArtifactKind,
    failurePolicy: defaultFailurePolicy,
    implemented: true,
  };
}

function blockedTool(definition: {
  id: string;
  label: string;
  description: string;
  capabilityId: CapabilityId;
  requiredArtifactKinds: string[];
  producedArtifactKind: string;
  blockedReason: string;
  sideEffectLevel?: ToolSideEffectLevel;
}): ToolDefinition {
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    adapterKind: "internal_capability",
    capabilityId: definition.capabilityId,
    inputSchema: definition.requiredArtifactKinds.length > 0 ? artifactInputSchema(definition.requiredArtifactKinds) : emptyInputSchema,
    outputSchema: artifactOutputSchema(definition.producedArtifactKind),
    requiresHumanGate: true,
    sideEffectLevel: definition.sideEffectLevel ?? "external_call",
    requiredArtifactKinds: definition.requiredArtifactKinds,
    producedArtifactKind: definition.producedArtifactKind,
    failurePolicy: { retryable: false, maxRetries: 0, onFailure: "record_observation" },
    implemented: false,
    blockedReason: definition.blockedReason,
  };
}

function packageTool(definition: {
  id: string;
  label: string;
  description: string;
  capabilityId: CapabilityId;
  requiredArtifactKinds: string[];
  producedArtifactKind: string;
  inputSchema?: JsonSchemaObject;
}): ToolDefinition {
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    adapterKind: "package",
    capabilityId: definition.capabilityId,
    inputSchema: definition.inputSchema ?? artifactInputSchema(definition.requiredArtifactKinds),
    outputSchema: artifactOutputSchema(definition.producedArtifactKind),
    requiresHumanGate: true,
    sideEffectLevel: "package_write",
    requiredArtifactKinds: definition.requiredArtifactKinds,
    producedArtifactKind: definition.producedArtifactKind,
    failurePolicy: defaultFailurePolicy,
    implemented: true,
  };
}

const toolDefinitions: ToolDefinition[] = [
  internalTool({
    id: "create_requirement_spec",
    label: "整理备课需求",
    description: "把教师的备课目标整理成可确认的需求规格。",
    capabilityId: "requirement_spec",
    requiredArtifactKinds: [],
    producedArtifactKind: "requirement_spec",
  }),
  internalTool({
    id: "create_lesson_plan",
    label: "生成公开课教案",
    description: "基于当前TaskBrief、教材依据和可信来源生成公开课教案。",
    capabilityId: "lesson_plan",
    requiredArtifactKinds: [],
    producedArtifactKind: "lesson_plan",
  }),
  internalTool({
    id: "create_ppt_outline",
    label: "生成 PPT 大纲",
    description: "基于当前TaskBrief和可信来源生成逐页课件大纲和课堂呈现建议。",
    capabilityId: "ppt_outline",
    requiredArtifactKinds: [],
    producedArtifactKind: "ppt_draft",
  }),
  internalTool({
    id: "create_ppt_design_draft",
    label: "生成 PPT 设计稿",
    description: "把课件大纲转成逐页 PPT 设计稿。",
    capabilityId: "ppt_design",
    requiredArtifactKinds: ["ppt_draft"],
    producedArtifactKind: "ppt_design_draft",
  }),
  internalTool({
    id: "extract_knowledge_anchors",
    label: "生成视频最小课程锚点",
    description: "从任务语义生成独立创意短片与课程任务之间唯一、最小的回接，不规定角色、场景或创作主题。",
    capabilityId: "knowledge_anchor_extract",
    requiredArtifactKinds: [],
    producedArtifactKind: "knowledge_anchor_extract",
  }),
  internalTool({
    id: "generate_intro_creative_themes",
    label: "生成导入创意主题",
    description: "先生成脱离教材仍成立的独立创意短片主题，再为候选标注唯一最小课程回接。",
    capabilityId: "creative_theme_generate",
    requiredArtifactKinds: [],
    producedArtifactKind: "creative_theme_generate",
  }),
  internalTool({
    id: "generate_intro_video_script",
    label: "生成导入视频脚本",
    description: "基于已确认创意主题生成导入视频脚本、旁白和课堂边界约束。",
    capabilityId: "video_script_generate",
    requiredArtifactKinds: ["creative_theme_generate"],
    producedArtifactKind: "video_script_generate",
  }),
  internalTool({
    id: "generate_video_storyboard",
    label: "生成视频分镜",
    description: "把视频脚本拆成分镜，写清镜头时长、画面动作和连续性要求。",
    capabilityId: "storyboard_generate",
    requiredArtifactKinds: ["video_script_generate"],
    producedArtifactKind: "storyboard_generate",
  }),
  internalTool({
    id: "generate_video_asset_brief",
    label: "生成视频资产说明",
    description: "为分镜生成统一风格、角色、道具、场景和关键帧资产说明。",
    capabilityId: "asset_brief_generate",
    requiredArtifactKinds: ["storyboard_generate"],
    producedArtifactKind: "asset_brief_generate",
  }),
  internalTool({
    id: "plan_video_segments",
    label: "规划分镜视频片段",
    description: "基于分镜和资产图规划每段视频的生成输入、参考图和目标时长。",
    capabilityId: "video_segment_plan",
    requiredArtifactKinds: ["storyboard_generate", "asset_image_generate"],
    producedArtifactKind: "video_segment_plan",
  }),
  blockedTool({
    id: "intro_video",
    label: "生成导入视频素材",
    description: "根据已确认分镜和资产约束生成课堂导入视频素材。",
    capabilityId: "intro_video",
    requiredArtifactKinds: ["ppt_design_draft"],
    producedArtifactKind: "video_storyboard",
    blockedReason: "导入视频真实生成能力尚未完成接入，暂不注册为可执行工具。",
  }),
  {
    id: "asset_image_generate",
    label: "生成视频资产图",
    description: "根据资产说明生成统一风格图、角色参考图、道具参考图、场景参考图和关键帧图。",
    adapterKind: "provider",
    capabilityId: "asset_image_generate",
    providerToolId: "image_asset.generate_asset_reference",
    inputSchema: artifactInputSchema(["asset_brief_generate"]),
    outputSchema: artifactOutputSchema("asset_image_generate"),
    requiresHumanGate: true,
    sideEffectLevel: "external_call",
    requiredArtifactKinds: ["asset_brief_generate"],
    producedArtifactKind: "asset_image_generate",
    failurePolicy: defaultFailurePolicy,
    implemented: true,
  },
  packageTool({
    id: "concat_only_assemble",
    label: "只拼接最终导入视频",
    description: "只按分镜顺序拼接已通过校验的片段，不重排、不加转场、不加滤镜、不重写内容。",
    capabilityId: "concat_only_assemble",
    requiredArtifactKinds: ["video_segment_generate", "storyboard_generate", "video_script_generate", "video_narration_generate"],
    producedArtifactKind: "concat_only_assemble",
  }),
  packageTool({
    id: "create_final_package",
    label: "打包最终交付材料",
    description: "把已确认的教案、PPTX、课堂图片和导入视频打包成最终材料包。",
    capabilityId: "final_package",
    requiredArtifactKinds: ["requirement_spec", "lesson_plan", "ppt_design_draft", "pptx_artifact", "image_prompts", "video_script_generate", "concat_only_assemble"],
    producedArtifactKind: "final_delivery",
    inputSchema: finalPackageInputSchema(["requirement_spec", "lesson_plan", "ppt_design_draft", "pptx_artifact", "image_prompts", "video_script_generate", "concat_only_assemble"]),
  }),
  {
    id: "generate_pptx_from_design",
    label: "生成 PPTX 文件",
    description: "基于已确认的逐页 PPT 设计稿生成可下载演示文稿。",
    adapterKind: "provider",
    capabilityId: "coze_ppt",
    providerToolId: "coze_ppt.generate_pptx",
    inputSchema: artifactInputSchema(["ppt_design_draft"]),
    outputSchema: artifactOutputSchema("pptx_artifact"),
    requiresHumanGate: true,
    sideEffectLevel: "external_call",
    requiredArtifactKinds: ["ppt_design_draft"],
    producedArtifactKind: "pptx_artifact",
    failurePolicy: defaultFailurePolicy,
    implemented: true,
  },
  {
    id: "generate_ppt_sample_assets",
    label: "生成 PPT 关键样张资产批次",
    description: "按已确认 PageSpec 生成关键场景和透明小素材，并输出逐对象来源清单。",
    adapterKind: "provider",
    capabilityId: "ppt_sample_assets",
    providerToolId: "image_asset.generate_ppt_sample_assets",
    inputSchema: artifactInputSchema(["ppt_design_draft"]),
    outputSchema: artifactOutputSchema("image_prompts"),
    requiresHumanGate: true,
    sideEffectLevel: "external_call",
    requiredArtifactKinds: ["ppt_design_draft"],
    producedArtifactKind: "image_prompts",
    failurePolicy: defaultFailurePolicy,
    implemented: true,
  },
  packageTool({
    id: "assemble_ppt_key_samples",
    label: "组装 PPT 关键样张",
    description: "把已确认的逐页设计和真实样张资产组装为可编辑 PPTX、逐页预览与三份独立总览，等待 D/V/P 审查。",
    capabilityId: "ppt_key_samples",
    requiredArtifactKinds: ["ppt_design_draft", "image_prompts"],
    producedArtifactKind: "image_prompts",
  }),
  packageTool({
    id: "assemble_ppt_full_deck",
    label: "组装完整可编辑 PPT",
    description: "使用已批准样张、完整真实资产和逐页设计组装完整 PPTX、PDF、逐页预览与总览，等待交付审查。",
    capabilityId: "ppt_full_deck",
    requiredArtifactKinds: ["ppt_design_draft", "image_prompts"],
    producedArtifactKind: "pptx_artifact",
  }),
  packageTool({
    id: "repair_ppt_full_deck_pages",
    label: "返修指定 PPT 页面",
    description: "只返修教师明确指定的页面，保留未受影响页的素材和渲染证据。",
    capabilityId: "ppt_page_repair",
    requiredArtifactKinds: ["pptx_artifact", "ppt_design_draft", "image_prompts"],
    producedArtifactKind: "pptx_artifact",
  }),
  {
    id: "generate_ppt_full_assets",
    label: "生成 PPT 全量正式资产",
    description: "在当前关键样张明确批准后，为全部页面生成正式场景和透明小素材，并输出完整来源清单。",
    adapterKind: "provider",
    capabilityId: "ppt_full_assets",
    providerToolId: "image_asset.generate_ppt_full_assets",
    inputSchema: artifactInputSchema(["ppt_design_draft", "image_prompts"]),
    outputSchema: artifactOutputSchema("image_prompts"),
    requiresHumanGate: true,
    sideEffectLevel: "external_call",
    requiredArtifactKinds: ["ppt_design_draft", "image_prompts"],
    producedArtifactKind: "image_prompts",
    failurePolicy: defaultFailurePolicy,
    implemented: true,
  },
  {
    id: "generate_classroom_image",
    label: "生成课堂图片素材",
    description: "基于已确认的课件大纲生成课堂图片素材。",
    adapterKind: "provider",
    capabilityId: "image_asset",
    providerToolId: "image_asset.generate",
    inputSchema: artifactInputSchema(["ppt_draft"]),
    outputSchema: artifactOutputSchema("image_prompts"),
    requiresHumanGate: true,
    sideEffectLevel: "external_call",
    requiredArtifactKinds: ["ppt_draft"],
    producedArtifactKind: "image_prompts",
    failurePolicy: defaultFailurePolicy,
    implemented: true,
  },
  {
    id: "generate_video_narration",
    label: "生成视频旁白与字幕",
    description: "基于已通过校验的视频脚本生成真实旁白音轨和时间绑定字幕。",
    adapterKind: "provider",
    capabilityId: "video_narration_generate",
    providerToolId: "tts_minimax.generate_narration",
    inputSchema: artifactInputSchema(["video_script_generate"]),
    outputSchema: artifactOutputSchema("video_narration_generate"),
    requiresHumanGate: true,
    sideEffectLevel: "external_call",
    requiredArtifactKinds: ["video_script_generate"],
    producedArtifactKind: "video_narration_generate",
    failurePolicy: defaultFailurePolicy,
    implemented: true,
  },
  {
    id: "generate_video_segment",
    label: "生成分镜视频片段",
    description: "基于已确认的片段计划、分镜和资产图生成单段视频。",
    adapterKind: "provider",
    capabilityId: "video_segment_generate",
    providerToolId: "video_segment_generate.generate",
    inputSchema: videoSegmentInputSchema(),
    outputSchema: artifactOutputSchema("video_segment_generate"),
    requiresHumanGate: true,
    sideEffectLevel: "external_call",
    requiredArtifactKinds: ["video_segment_plan", "storyboard_generate", "asset_image_generate"],
    producedArtifactKind: "video_segment_generate",
    failurePolicy: defaultFailurePolicy,
    implemented: true,
  },
];

function cloneToolDefinition(definition: ToolDefinition): ToolDefinition {
  return structuredClone(definition);
}

export function listToolDefinitions(): ToolDefinition[] {
  return toolDefinitions.map(cloneToolDefinition);
}

export const getToolDefinitions = listToolDefinitions;

const taskBriefInputToolIds = new Set([
  "create_lesson_plan",
  "create_ppt_outline",
  "extract_knowledge_anchors",
  "generate_intro_creative_themes",
]);

export function toolRequiresTaskBriefInput(tool: Pick<ToolDefinition, "id">): boolean {
  return taskBriefInputToolIds.has(tool.id);
}

export function getToolDefinition(id: string): ToolDefinition {
  const definition = toolDefinitions.find((tool) => tool.id === id);
  if (!definition) {
    throw new Error(`Unknown tool: ${id}`);
  }
  return cloneToolDefinition(definition);
}

export function getToolDefinitionByCapabilityId(capabilityId: CapabilityId): ToolDefinition {
  const definition = toolDefinitions.find((tool) => tool.capabilityId === capabilityId);
  if (!definition) {
    throw new Error(`Unknown tool capability: ${capabilityId}`);
  }
  return cloneToolDefinition(definition);
}
