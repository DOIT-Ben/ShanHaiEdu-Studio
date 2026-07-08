import type { CapabilityDefinition, CapabilityId } from "./types";

const capabilityDefinitions: CapabilityDefinition[] = [
  {
    id: "requirement_spec",
    userLabel: "整理备课需求",
    description: "把教师自然输入整理成可确认的备课需求规格。",
    inputSchema: { required: ["teacherGoal"] },
    outputSchema: { artifact: "requirement_spec" },
    upstreamCapabilities: [],
    artifactKind: "requirement_spec",
    workflowNodeKey: "requirement_spec",
    requiresConfirmation: true,
    providerMode: "internal",
    deterministicFallback: "draft_only",
    failureRecovery: {
      retryable: true,
      userMessage: "需求整理暂时没有完成，可以补充年级、课题后重试。",
    },
  },
  {
    id: "lesson_plan",
    userLabel: "生成公开课教案",
    description: "基于已确认需求和教材依据生成公开课教案。",
    inputSchema: { required: ["requirement_spec"] },
    outputSchema: { artifact: "lesson_plan" },
    upstreamCapabilities: ["requirement_spec"],
    artifactKind: "lesson_plan",
    workflowNodeKey: "lesson_plan",
    requiresConfirmation: true,
    providerMode: "internal",
    deterministicFallback: "draft_only",
    failureRecovery: {
      retryable: true,
      userMessage: "教案暂时没有生成成功，可以先检查需求规格后重试。",
    },
  },
  {
    id: "ppt_outline",
    userLabel: "生成 PPT 大纲",
    description: "生成 PPT 大纲、逐页脚本和课堂呈现建议。",
    inputSchema: { required: ["teacherGoal"] },
    outputSchema: { artifact: "ppt_draft" },
    upstreamCapabilities: ["requirement_spec"],
    artifactKind: "ppt_draft",
    workflowNodeKey: "ppt_draft",
    requiresConfirmation: true,
    providerMode: "internal",
    deterministicFallback: "draft_only",
    failureRecovery: {
      retryable: true,
      userMessage: "PPT 大纲暂时没有生成成功，可以先确认需求后重试。",
    },
  },
  {
    id: "coze_ppt",
    userLabel: "生成 PPTX 文件",
    description: "基于 PPT 大纲调用外部能力生成可下载 PPTX。",
    inputSchema: { required: ["ppt_outline"] },
    outputSchema: { artifact: "ppt_draft" },
    upstreamCapabilities: ["ppt_outline"],
    artifactKind: "ppt_draft",
    workflowNodeKey: "ppt_draft",
    requiresConfirmation: true,
    providerMode: "external",
    deterministicFallback: "blocked",
    failureRecovery: {
      retryable: true,
      userMessage: "PPTX 生成服务暂时不可用，可以稍后重试，或先继续修改 PPT 大纲。",
    },
  },
  {
    id: "image_asset",
    userLabel: "生成课堂图片素材",
    description: "根据课堂场景生成图片素材。",
    inputSchema: { required: ["scenePrompt"] },
    outputSchema: { artifact: "image_prompts", realAsset: "image" },
    upstreamCapabilities: ["ppt_outline"],
    artifactKind: "image_prompts",
    workflowNodeKey: "image_prompts",
    requiresConfirmation: true,
    providerMode: "external",
    deterministicFallback: "blocked",
    failureRecovery: {
      retryable: true,
      userMessage: "图片生成暂时不可用，可以先保留图片提示词后重试。",
    },
  },
  {
    id: "intro_video",
    userLabel: "生成导入视频素材",
    description: "根据导入方案和分镜生成课堂导入视频素材。",
    inputSchema: { required: ["introVideoPlan"] },
    outputSchema: { artifact: "video_storyboard", realAsset: "video" },
    upstreamCapabilities: ["ppt_outline"],
    artifactKind: "video_storyboard",
    workflowNodeKey: "video_storyboard",
    requiresConfirmation: true,
    providerMode: "external",
    deterministicFallback: "blocked",
    failureRecovery: {
      retryable: true,
      userMessage: "视频生成暂时不可用，可以先继续完善导入方案。",
    },
  },
  {
    id: "final_package",
    userLabel: "打包最终交付",
    description: "把已确认的教案、PPT、图片、视频和交付说明打包。",
    inputSchema: { required: ["approvedArtifacts"] },
    outputSchema: { artifact: "final_package" },
    upstreamCapabilities: ["requirement_spec", "lesson_plan", "ppt_outline"],
    artifactKind: "final_delivery",
    workflowNodeKey: "final_delivery",
    requiresConfirmation: true,
    providerMode: "package",
    deterministicFallback: "allowed",
    failureRecovery: {
      retryable: true,
      userMessage: "最终交付包暂时没有打包成功，可以检查已确认成果后重试。",
    },
  },
];

export function getCapabilityDefinitions(): CapabilityDefinition[] {
  return capabilityDefinitions.map((definition) => ({ ...definition }));
}

export function getCapabilityDefinition(id: CapabilityId): CapabilityDefinition {
  const definition = capabilityDefinitions.find((capability) => capability.id === id);
  if (!definition) {
    throw new Error(`Unknown capability: ${id}`);
  }
  return { ...definition };
}
