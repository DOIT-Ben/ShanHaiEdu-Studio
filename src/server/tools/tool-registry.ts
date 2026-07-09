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
    requiresHumanGate: true,
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
    description: "基于已确认需求和教材依据生成公开课教案。",
    capabilityId: "lesson_plan",
    requiredArtifactKinds: ["requirement_spec"],
    producedArtifactKind: "lesson_plan",
  }),
  internalTool({
    id: "create_ppt_outline",
    label: "生成 PPT 大纲",
    description: "基于已确认需求生成逐页课件大纲和课堂呈现建议。",
    capabilityId: "ppt_outline",
    requiredArtifactKinds: ["requirement_spec"],
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
    label: "提取视频知识锚点",
    description: "从教案中提取导入视频必须回到的关键知识、易错点和课堂问题。",
    capabilityId: "knowledge_anchor_extract",
    requiredArtifactKinds: ["lesson_plan"],
    producedArtifactKind: "knowledge_anchor_extract",
  }),
  internalTool({
    id: "generate_intro_creative_themes",
    label: "生成导入创意主题",
    description: "围绕知识锚点生成课堂导入创意主题。",
    capabilityId: "creative_theme_generate",
    requiredArtifactKinds: ["knowledge_anchor_extract"],
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
    requiredArtifactKinds: ["storyboard_generate", "asset_image_generate"],
    producedArtifactKind: "intro_video",
    blockedReason: "导入视频真实生成能力尚未完成接入，暂不注册为可执行工具。",
  }),
  blockedTool({
    id: "asset_image_generate",
    label: "生成视频资产图",
    description: "根据资产说明生成统一风格图、角色参考图、道具参考图、场景参考图和关键帧图。",
    capabilityId: "asset_image_generate",
    requiredArtifactKinds: ["asset_brief_generate"],
    producedArtifactKind: "asset_image_generate",
    blockedReason: "视频资产图真实生成能力尚未完成接入，暂不注册为可执行工具。",
  }),
  blockedTool({
    id: "concat_only_assemble",
    label: "只拼接最终导入视频",
    description: "只按分镜顺序拼接已通过校验的片段，不重排、不加转场、不加滤镜、不重写内容。",
    capabilityId: "concat_only_assemble",
    requiredArtifactKinds: ["video_segment_generate"],
    producedArtifactKind: "concat_only_assemble",
    blockedReason: "最终导入视频拼接能力尚未完成接入，暂不注册为可执行工具。",
    sideEffectLevel: "package_write",
  }),
  internalTool({
    id: "create_final_delivery_checklist",
    label: "创建最终交付清单",
    description: "汇总已确认成果，创建最终交付前的检查清单。",
    capabilityId: "final_package",
    requiredArtifactKinds: ["requirement_spec", "lesson_plan", "ppt_design_draft", "pptx_artifact", "concat_only_assemble"],
    producedArtifactKind: "final_delivery",
    sideEffectLevel: "package_write",
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
];

function cloneToolDefinition(definition: ToolDefinition): ToolDefinition {
  return structuredClone(definition);
}

export function listToolDefinitions(): ToolDefinition[] {
  return toolDefinitions.map(cloneToolDefinition);
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
