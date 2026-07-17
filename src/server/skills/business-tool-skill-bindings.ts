import { createHash } from "node:crypto";
import type { SkillContractRef } from "./skill-runtime-types";

export const BUSINESS_TOOL_SKILL_POLICY_VERSION = "business-tool-skill-policy.v2" as const;

export type SkillBoundBusinessToolPolicy = {
  toolName: string;
  mode: "skill";
  skillName: string;
  compatibleVersions: string[];
  referencePaths: string[];
  semanticGuidance: BusinessToolSemanticGuidance[];
  artifactCompatibility: {
    consumes: ToolSkillArtifactCompatibility[];
    produces: ToolSkillArtifactCompatibility[];
  };
  contracts: {
    tool: { consumes: string[]; produces: string[] };
    skill: { consumes: SkillContractRef[]; produces: SkillContractRef[] };
  };
};

export type GuidanceBoundBusinessToolPolicy = {
  toolName: string;
  mode: "guidance";
  skillName: string;
  compatibleVersions: string[];
  referencePaths: string[];
  semanticGuidance: BusinessToolSemanticGuidance[];
  contracts: {
    tool: { consumes: string[]; produces: string[] };
  };
};

export type SemanticBoundBusinessToolPolicy =
  | SkillBoundBusinessToolPolicy
  | GuidanceBoundBusinessToolPolicy;

export type BusinessToolSemanticBinding = {
  skillName: string;
  bindingMode: "skill" | "guidance";
};

export type BusinessToolSemanticGuidance = {
  sourcePath: string;
  objective: string;
  rules: string[];
  exclusions: string[];
};

export type ToolSkillArtifactCompatibility = {
  toolArtifactKind: string;
  skillContract: SkillContractRef | null;
  adapterId:
    | "identity.v1"
    | "image-request-context.v1"
    | "image-result-single.v2"
    | "image-result-batch.v2"
    | "video-package-context.v1"
    | "video-result-single-shot.v2"
    | "delivery-task-context.v1"
    | "delivery-component-context.v1"
    | "delivery-result-package.v2";
};

export type SkillExemptBusinessToolPolicy = {
  toolName: string;
  mode: "exempt";
  reasonCode: "no_domain_skill_required" | "no_compatible_domain_skill";
};

export type BusinessToolSkillPolicy = SemanticBoundBusinessToolPolicy | SkillExemptBusinessToolPolicy;

const skillContractsByName: Record<string, SkillBoundBusinessToolPolicy["contracts"]["skill"]> = {
  "shanhai-jiaoan": {
    consumes: [{ artifactType: "textbook-evidence", contractVersion: "shanhai-jiaocai/v1" }],
    produces: [{ artifactType: "lesson-plan", contractVersion: "shanhai-jiaoan/v2" }],
  },
  "shanhai-ppt": {
    consumes: [{ artifactType: "lesson-plan", contractVersion: "shanhai-jiaoan/v2" }],
    produces: [{ artifactType: "ppt-package", contractVersion: "1.0" }],
  },
  "shanhai-video": {
    consumes: [{ artifactType: "lesson-plan", contractVersion: "shanhai-jiaoan/v2" }],
    produces: [{ artifactType: "video-package", contractVersion: "shanhai-video/v1" }],
  },
  "shanhai-imagegen": {
    consumes: [],
    produces: [{ artifactType: "image-generation-result", contractVersion: "shanhai-imagegen/v2" }],
  },
  "shanhai-video-generation": {
    consumes: [{ artifactType: "video-package", contractVersion: "shanhai-video/v1" }],
    produces: [{ artifactType: "video-generation-result", contractVersion: "shanhai-video-generation/v2" }],
  },
  "shanhai-delivery": {
    consumes: [
      { artifactType: "lesson-plan", contractVersion: "shanhai-jiaoan/v2" },
      { artifactType: "ppt-package", contractVersion: "1.0" },
      { artifactType: "image-generation-result", contractVersion: "shanhai-imagegen/v2" },
      { artifactType: "video-package", contractVersion: "shanhai-video/v1" },
      { artifactType: "video-generation-result", contractVersion: "shanhai-video-generation/v2" },
    ],
    produces: [{ artifactType: "delivery-package", contractVersion: "shanhai-delivery/v2" }],
  },
};

const toolContractsByName: Record<string, SkillBoundBusinessToolPolicy["contracts"]["tool"]> = {
  create_lesson_plan: toolContract([], ["lesson_plan"]),
  create_ppt_outline: toolContract([], ["ppt_draft"]),
  create_video_course_anchor: toolContract([], ["knowledge_anchor_extract"]),
  generate_intro_creative_themes: toolContract([], ["creative_theme_generate"]),
  generate_intro_video_script: toolContract(["creative_theme_generate"], ["video_script_generate"]),
  generate_video_storyboard: toolContract(["video_script_generate"], ["storyboard_generate"]),
  generate_video_asset_brief: toolContract(["storyboard_generate"], ["asset_brief_generate"]),
  plan_video_segments: toolContract(["storyboard_generate", "asset_image_generate"], ["video_segment_plan"]),
  create_ppt_design_draft: toolContract(["ppt_draft"], ["ppt_design_draft"]),
  generate_ppt_sample_assets: toolContract(["ppt_design_draft"], ["image_prompts"]),
  assemble_ppt_key_samples: toolContract(["ppt_design_draft", "image_prompts"], ["image_prompts"]),
  generate_ppt_full_assets: toolContract(["ppt_design_draft", "image_prompts"], ["image_prompts"]),
  assemble_ppt_full_deck: toolContract(["ppt_design_draft", "image_prompts"], ["pptx_artifact"]),
  repair_ppt_full_deck_pages: toolContract(["pptx_artifact", "ppt_design_draft", "image_prompts"], ["pptx_artifact"]),
  generate_classroom_image: toolContract(["ppt_draft"], ["image_prompts"]),
  generate_video_assets: toolContract(["asset_brief_generate"], ["asset_image_generate"]),
  generate_video_shot: toolContract(["video_segment_plan", "storyboard_generate", "asset_image_generate"], ["video_segment_generate"]),
  assemble_video: toolContract(["video_segment_generate", "storyboard_generate", "video_script_generate", "video_narration_generate"], ["concat_only_assemble"]),
  create_final_package: toolContract(
    ["requirement_spec", "lesson_plan", "ppt_design_draft", "pptx_artifact", "image_prompts", "video_script_generate", "concat_only_assemble"],
    ["final_delivery"],
  ),
};

const businessToolSkillPolicies: readonly BusinessToolSkillPolicy[] = Object.freeze([
  exempt("create_requirement_spec", "no_domain_skill_required"),
  guidance(
    "create_lesson_plan",
    "shanhai-jiaoan",
    ["1.1"],
    ["references/教案结构化字段规范.md", "references/教案质量门禁.md"],
    [
      {
        sourcePath: "references/教案结构化字段规范.md",
        objective: "生成当前TaskBrief范围内可供下游使用的结构化教案候选。",
        rules: [
          "保留教材证据、内容边界、可评价目标、师生活动、评价、板书和课堂风险之间的引用关系。",
          "学情事实未知时诚实记录，不虚构掌握率、错误率、设备条件或教师偏好。",
        ],
        exclusions: ["不得扩张为三类九套附录、PPT、图片、视频或最终材料包。"],
      },
      {
        sourcePath: "references/教案质量门禁.md",
        objective: "使当前教案候选满足最低证据、目标、过程和范围质量要求。",
        rules: [
          "每个目标至少由一个教学环节实施并由一个评价证据检验，环节时间之和等于课时长度。",
          "局部失败只返修受影响目标、环节及其直接引用，保留其他已验证内容。",
        ],
        exclusions: ["不得把待核对草稿、空泛活动或伪造课后反思标为完成。"],
      },
    ],
  ),
  guidance("create_ppt_outline", "shanhai-ppt", ["1.0"], ["references/page-design.md"], [{
    sourcePath: "references/page-design.md",
    objective: "把当前TaskBrief和可信来源组织为可继续逐页设计的PPT大纲候选。",
    rules: [
      "继承内容边界、不得提前讲授内容及可用目标或环节引用，每页只承担一个教学任务。",
      "页序、页面目的和互动节点必须服务当前任务，不重写上游教学事实。",
    ],
    exclusions: ["不得生成第二份完整教案、真实图片、PPTX、视频或最终材料包。"],
  }]),
  guidance("create_video_course_anchor", "shanhai-video", ["1.2"], ["references/story-script.md"], [{
    sourcePath: "references/story-script.md",
    objective: "从当前事实边界形成独立创意短片与课程任务之间的唯一最小回接候选。",
    rules: [
      "课程锚点只约束结尾回接，不得成为人物、场景、冲突或整支短片的强制创作中心。",
      "同时保留课堂第一问、交接时刻和不得提前讲授内容。",
    ],
    exclusions: ["不得扩张为完整教案、PPT、故事、分镜、图片、成片或整包。"],
  }]),
  guidance("generate_intro_creative_themes", "shanhai-video", ["1.2"], ["references/story-script.md"], [{
    sourcePath: "references/story-script.md",
    objective: "提出最多三个脱离教材仍成立且差异明确的独立创意方向。",
    rules: [
      "每个方向先具备自身钩子、冲突或变化和可感知结局，再通过唯一最小课程锚点回接。",
      "主体与空间由创意决定，不固定为儿童、教师、教室或课堂活动。",
    ],
    exclusions: ["不得把知识锚点机械扩写为创意中心，也不得生成完整剧本、分镜或成片。"],
  }]),
  guidance("generate_intro_video_script", "shanhai-video", ["1.2"], ["references/story-script.md"], [{
    sourcePath: "references/story-script.md",
    objective: "把已选独立创意转为当前任务范围内可拍摄的视频剧本候选。",
    rules: [
      "场次写清视觉动作、旁白、对白、声音和转场，故事自身先闭合，结尾只回接一次课程任务。",
      "严格停在handoffMoment，不讲出mustNotPreteach。",
    ],
    exclusions: ["不得扩张为教案、PPT、资产生成、完整分镜、成片或最终材料包。"],
  }]),
  guidance("generate_video_storyboard", "shanhai-video", ["1.2"], ["references/storyboards.md"], [{
    sourcePath: "references/storyboards.md",
    objective: "把当前剧本拆为可实际制作且保持叙事连续的分镜候选。",
    rules: [
      "每个镜头只承担一个动作、冲突、变化或回接，包含画面、动作、景别、运镜、声音和禁止项。",
      "镜头按叙事需要设为6至30秒，完整短片总时长为30至90秒，失败只标记受影响镜头。",
    ],
    exclusions: ["不得生成真实图片、视频片段、完整成片或最终材料包。"],
  }]),
  guidance("generate_video_asset_brief", "shanhai-video", ["1.2"], ["references/assets-styles.md"], [{
    sourcePath: "references/assets-styles.md",
    objective: "从当前故事和剧本提取实际需要的角色、场景、道具或生物资产说明。",
    rules: [
      "每项资产保留稳定ID、用途、类型、完整提示词和负面约束，并在同一视频内锁定一个主视觉风格。",
      "资产由故事需要决定，场景默认无人、道具默认单体，不强制任何人物或课堂空间。",
    ],
    exclusions: ["不得调用图片或视频Provider，也不得把资产说明冒充真实生成资产。"],
  }]),
  guidance("plan_video_segments", "shanhai-video", ["1.2"], ["references/storyboards.md"], [{
    sourcePath: "references/storyboards.md",
    objective: "依据当前分镜、资产可用性和目标时长形成可执行的视频片段规划。",
    rules: [
      "clipIndex连续，单片段6至30秒，全部片段总时长精确等于30至90秒目标时长。",
      "保留相邻镜头主体、姿势、外观、道具、光线、空间和运镜连续性。",
    ],
    exclusions: ["不得调用视频Provider、自动重试、组装成片或扩张为完整材料包。"],
  }]),
  guidance("create_ppt_design_draft", "shanhai-ppt", ["1.0"], ["references/page-design.md"], [{
    sourcePath: "references/page-design.md",
    objective: "把当前PPT大纲和可信来源细化为可供下游使用的逐页设计候选。",
    rules: [
      "先锁定styleText、palette和layoutRules；每页写清教学目的、可见正文、视觉设计、图片提示词、可编辑内容、资产引用和讲者备注。",
      "准确文字、数字、公式和关系由可编辑层承担，视觉事件必须服务本页唯一教学任务。",
    ],
    exclusions: ["不得使用占位图或临时替代物，也不得声称已生成真实图片、PPTX、PDF或完整交付包。"],
  }]),
  imageSkill("generate_ppt_sample_assets", "生成当前PPT关键页所需的场景图和透明素材。"),
  exempt("assemble_ppt_key_samples", "no_compatible_domain_skill"),
  imageSkill("generate_ppt_full_assets", "生成当前逐页设计所需的正式场景图和透明素材。"),
  exempt("assemble_ppt_full_deck", "no_compatible_domain_skill"),
  exempt("repair_ppt_full_deck_pages", "no_compatible_domain_skill"),
  imageSkill("generate_classroom_image", "生成当前课件大纲需要的课堂视觉素材。"),
  imageSkill("generate_video_assets", "生成当前独立创意短片资产说明指定的角色、场景、道具和关键帧参考图。"),
  exempt("generate_video_narration", "no_compatible_domain_skill"),
  skill("generate_video_shot", "shanhai-video-generation", ["1.1"], ["references/result-contract.md"], [{
    sourcePath: "references/result-contract.md",
    objective: "把当前Tool已生成并持久化的单镜头结果规范化为可核验的视频资产事实。",
    rules: [
      "绑定实际Provider与模型、镜头请求时长、来源Artifact、真实发送的参考资产和持久化MP4。",
      "只有文件与质量证据完整时才允许形成正式成功结果。",
    ],
    exclusions: ["不得包含Provider私有任务ID、临时下载地址、凭据、下一Tool、重试、停止或授权指令。"],
  }], {
    consumes: toolContractsByName.generate_video_shot.consumes.map((toolArtifactKind) => ({
      toolArtifactKind,
      skillContract: skillContractsByName["shanhai-video-generation"].consumes[0],
      adapterId: "video-package-context.v1" as const,
    })),
    produces: [{
      toolArtifactKind: "video_segment_generate",
      skillContract: skillContractsByName["shanhai-video-generation"].produces[0],
      adapterId: "video-result-single-shot.v2",
    }],
  }),
  exempt("assemble_video", "no_compatible_domain_skill"),
  deliverySkill(),
]);

export function resolveBusinessSkillName(toolName: string): string | undefined {
  const policy = resolveBusinessToolSkillPolicy(toolName);
  return policy?.mode === "skill" ? policy.skillName : undefined;
}

export function resolveBusinessToolSemanticBinding(toolName: string): BusinessToolSemanticBinding | undefined {
  const policy = resolveBusinessToolSkillPolicy(toolName);
  if (!policy || policy.mode === "exempt") return undefined;
  return {
    skillName: policy.skillName,
    bindingMode: policy.mode,
  };
}

export function resolveBusinessToolSkillPolicy(toolName: string): BusinessToolSkillPolicy | undefined {
  const policy = businessToolSkillPolicies.find((candidate) => candidate.toolName === toolName);
  return policy ? structuredClone(policy) : undefined;
}

export function listBusinessToolSkillPolicies(): BusinessToolSkillPolicy[] {
  return structuredClone([...businessToolSkillPolicies]);
}

export function listBusinessToolSkillBindings(): SkillBoundBusinessToolPolicy[] {
  return listBusinessToolSkillPolicies().filter((policy): policy is SkillBoundBusinessToolPolicy => policy.mode === "skill");
}

export function businessToolSkillPolicyDigest(): string {
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: BUSINESS_TOOL_SKILL_POLICY_VERSION,
    policies: businessToolSkillPolicies,
  })).digest("hex");
}

export function businessToolSkillBindingDigest(policy: SemanticBoundBusinessToolPolicy): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({
    schemaVersion: BUSINESS_TOOL_SKILL_POLICY_VERSION,
    policy,
  })).digest("hex")}`;
}

export function hasCompatibleBusinessToolSkillArtifacts(input: {
  policy: SkillBoundBusinessToolPolicy;
  toolContract?: { consumes: string[]; produces: string[] };
  skillContracts?: { consumes: SkillContractRef[]; produces: SkillContractRef[] };
}): boolean {
  const tool = input.toolContract ?? input.policy.contracts.tool;
  const skillContracts = input.skillContracts ?? input.policy.contracts.skill;
  return compatibilityDirectionIsValid("consumes", input.policy.artifactCompatibility.consumes, tool.consumes, skillContracts.consumes) &&
    compatibilityDirectionIsValid("produces", input.policy.artifactCompatibility.produces, tool.produces, skillContracts.produces);
}

export function hasValidBusinessToolSemanticGuidance(policy: SemanticBoundBusinessToolPolicy): boolean {
  if (policy.semanticGuidance.length === 0) return false;
  const paths = policy.semanticGuidance.map((guidance) => guidance.sourcePath);
  if (new Set(paths).size !== paths.length) return false;
  return policy.semanticGuidance.every((guidance) =>
    policy.referencePaths.includes(guidance.sourcePath) &&
    Boolean(guidance.objective.trim()) &&
    guidance.rules.length > 0 && guidance.rules.every((rule) => Boolean(rule.trim())) &&
    guidance.exclusions.every((exclusion) => Boolean(exclusion.trim())),
  );
}

function skill(
  toolName: string,
  skillName: string,
  compatibleVersions: string[],
  referencePaths: string[],
  semanticGuidance: BusinessToolSemanticGuidance[],
  artifactCompatibility: SkillBoundBusinessToolPolicy["artifactCompatibility"],
): SkillBoundBusinessToolPolicy {
  const toolContracts = toolContractsByName[toolName];
  const skillContracts = skillContractsByName[skillName];
  if (!toolContracts || !skillContracts) {
    throw new Error(`Business Tool Skill contract binding is missing: ${toolName}`);
  }
  return {
    toolName,
    mode: "skill",
    skillName,
    compatibleVersions,
    referencePaths,
    semanticGuidance,
    artifactCompatibility,
    contracts: {
      tool: structuredClone(toolContracts),
      skill: structuredClone(skillContracts),
    },
  };
}

function guidance(
  toolName: string,
  skillName: string,
  compatibleVersions: string[],
  referencePaths: string[],
  semanticGuidance: BusinessToolSemanticGuidance[],
): GuidanceBoundBusinessToolPolicy {
  const toolContracts = toolContractsByName[toolName];
  if (!toolContracts) throw new Error(`Business Tool guidance contract is missing: ${toolName}`);
  return {
    toolName,
    mode: "guidance",
    skillName,
    compatibleVersions,
    referencePaths,
    semanticGuidance,
    contracts: { tool: structuredClone(toolContracts) },
  };
}

function imageSkill(toolName: string, objective: string): SkillBoundBusinessToolPolicy {
  const contract = toolContractsByName[toolName];
  const imageContract = skillContractsByName["shanhai-imagegen"].produces[0];
  if (!contract || !imageContract) throw new Error(`Image Skill binding contract is missing: ${toolName}`);
  return skill(
    toolName,
    "shanhai-imagegen",
    ["1.1"],
    ["references/result-contract.md"],
    [{
      sourcePath: "references/result-contract.md",
      objective: `把“${objective}”的真实执行结果规范化为可供下游使用的图片资产事实。`,
      rules: [
        "逐资产绑定实际Provider与模型、prompt摘要、来源Artifact、原始文件、交付文件、处理血缘和质量证据。",
        "单图与批次均不得用汇总状态代替真实文件事实。",
      ],
      exclusions: ["不得包含凭据、服务地址、Provider私有请求标识、下一Tool、重试、停止或授权指令。"],
    }],
    {
      consumes: contract.consumes.map((toolArtifactKind) => ({
        toolArtifactKind,
        skillContract: null,
        adapterId: "image-request-context.v1" as const,
      })),
      produces: contract.produces.map((toolArtifactKind) => ({
        toolArtifactKind,
        skillContract: imageContract,
        adapterId: isPptImageBatchTool(toolName)
          ? "image-result-batch.v2" as const
          : "image-result-single.v2" as const,
      })),
    },
  );
}

function deliverySkill(): SkillBoundBusinessToolPolicy {
  const toolName = "create_final_package";
  const contract = toolContractsByName[toolName];
  const deliveryContracts = skillContractsByName["shanhai-delivery"];
  if (!contract || !deliveryContracts) throw new Error("Delivery Skill binding contract is missing.");
  const byArtifactType = new Map(deliveryContracts.consumes.map((item) => [item.artifactType, item]));
  const componentContract = (artifactType: string) => {
    const value = byArtifactType.get(artifactType);
    if (!value) throw new Error(`Delivery Skill input contract is missing: ${artifactType}`);
    return value;
  };
  return skill(
    toolName,
    "shanhai-delivery",
    ["1.3"],
    ["references/assembly-boundary.md"],
    [{
      sourcePath: "references/assembly-boundary.md",
      objective: "装配并核验当前任务已持久化的正式课程交付包。",
      rules: [
        "只使用当前任务、意图修订和明确版本中已验证且文件摘要匹配的正式组件。",
        "完整有声视频必须为30至90秒，独立故事闭合后只保留一次最小课程锚点。",
        "构建成功必须原子持久化package asset、Manifest、ZIP字节、组件版本与逐文件摘要。",
      ],
      exclusions: [
        "不得从最新版、未批准版、不同任务或临时路径组件现场拼装ZIP。",
        "不得把缺失正式package asset、旧包或降级包标为当前成功。",
      ],
    }],
    {
      consumes: [
        { toolArtifactKind: "requirement_spec", skillContract: null, adapterId: "delivery-task-context.v1" },
        { toolArtifactKind: "lesson_plan", skillContract: componentContract("lesson-plan"), adapterId: "delivery-component-context.v1" },
        { toolArtifactKind: "ppt_design_draft", skillContract: componentContract("ppt-package"), adapterId: "delivery-component-context.v1" },
        { toolArtifactKind: "pptx_artifact", skillContract: componentContract("ppt-package"), adapterId: "delivery-component-context.v1" },
        { toolArtifactKind: "image_prompts", skillContract: componentContract("image-generation-result"), adapterId: "delivery-component-context.v1" },
        { toolArtifactKind: "video_script_generate", skillContract: componentContract("video-package"), adapterId: "delivery-component-context.v1" },
        { toolArtifactKind: "concat_only_assemble", skillContract: componentContract("video-generation-result"), adapterId: "delivery-component-context.v1" },
      ],
      produces: [{
        toolArtifactKind: "final_delivery",
        skillContract: deliveryContracts.produces[0],
        adapterId: "delivery-result-package.v2",
      }],
    },
  );
}

function compatibilityDirectionIsValid(
  direction: "consumes" | "produces",
  mappings: ToolSkillArtifactCompatibility[],
  toolArtifactKinds: string[],
  skillContracts: SkillContractRef[],
) {
  if (!sameTextSet(mappings.map((mapping) => mapping.toolArtifactKind), toolArtifactKinds)) return false;
  if (!sameSkillContractSet(mappings.flatMap((mapping) => mapping.skillContract ? [mapping.skillContract] : []), skillContracts)) return false;
  return mappings.every((mapping) => compatibilityAdapterAccepts(direction, mapping));
}

function compatibilityAdapterAccepts(
  direction: "consumes" | "produces",
  mapping: ToolSkillArtifactCompatibility,
) {
  const contractKey = mapping.skillContract ? skillContractKey(mapping.skillContract) : null;
  if (mapping.adapterId === "identity.v1") {
    return Boolean(contractKey && normalizeArtifactName(mapping.toolArtifactKind) === normalizeArtifactName(mapping.skillContract!.artifactType));
  }
  if (mapping.adapterId === "image-request-context.v1") {
    return direction === "consumes" && mapping.skillContract === null &&
      ["ppt_design_draft", "image_prompts", "ppt_draft", "asset_brief_generate"].includes(mapping.toolArtifactKind);
  }
  if (mapping.adapterId === "image-result-single.v2") {
    return direction === "produces" && contractKey === "image-generation-result@shanhai-imagegen/v2" &&
      ["image_prompts", "asset_image_generate"].includes(mapping.toolArtifactKind);
  }
  if (mapping.adapterId === "image-result-batch.v2") {
    return direction === "produces" && contractKey === "image-generation-result@shanhai-imagegen/v2" &&
      mapping.toolArtifactKind === "image_prompts";
  }
  if (mapping.adapterId === "video-package-context.v1") {
    return direction === "consumes" && contractKey === "video-package@shanhai-video/v1" &&
      ["video_segment_plan", "storyboard_generate", "asset_image_generate"].includes(mapping.toolArtifactKind);
  }
  if (mapping.adapterId === "delivery-task-context.v1") {
    return direction === "consumes" && mapping.skillContract === null && mapping.toolArtifactKind === "requirement_spec";
  }
  if (mapping.adapterId === "delivery-component-context.v1") {
    if (direction !== "consumes" || !contractKey) return false;
    const accepted = new Set([
      "lesson_plan@lesson-plan@shanhai-jiaoan/v2",
      "ppt_design_draft@ppt-package@1.0",
      "pptx_artifact@ppt-package@1.0",
      "image_prompts@image-generation-result@shanhai-imagegen/v2",
      "video_script_generate@video-package@shanhai-video/v1",
      "concat_only_assemble@video-generation-result@shanhai-video-generation/v2",
    ]);
    return accepted.has(`${mapping.toolArtifactKind}@${contractKey}`);
  }
  if (mapping.adapterId === "delivery-result-package.v2") {
    return direction === "produces" && mapping.toolArtifactKind === "final_delivery" &&
      contractKey === "delivery-package@shanhai-delivery/v2";
  }
  return direction === "produces" && mapping.adapterId === "video-result-single-shot.v2" &&
    contractKey === "video-generation-result@shanhai-video-generation/v2" &&
    mapping.toolArtifactKind === "video_segment_generate";
}

function isPptImageBatchTool(toolName: string) {
  return toolName === "generate_ppt_sample_assets" || toolName === "generate_ppt_full_assets";
}

function sameTextSet(left: string[], right: string[]) {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function sameSkillContractSet(left: SkillContractRef[], right: SkillContractRef[]) {
  return sameTextSet(left.map(skillContractKey), right.map(skillContractKey));
}

function skillContractKey(contract: SkillContractRef) {
  return `${contract.artifactType}@${contract.contractVersion}`;
}

function normalizeArtifactName(value: string) {
  return value.trim().toLowerCase().replaceAll("_", "-");
}

function toolContract(consumes: string[], produces: string[]) {
  return { consumes, produces };
}

function exempt(
  toolName: string,
  reasonCode: SkillExemptBusinessToolPolicy["reasonCode"],
): SkillExemptBusinessToolPolicy {
  return { toolName, mode: "exempt", reasonCode };
}
