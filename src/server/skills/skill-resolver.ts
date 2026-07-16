import type { ShanHaiArtifactRef, SkillDescriptor } from "./skill-runtime-types";

export type SkillResolutionMode = "single_skill" | "sequential_pipeline" | "review_resume";

export type SkillResolution = {
  mode: SkillResolutionMode;
  selectedSkill: SkillDescriptor;
  route: SkillDescriptor[];
  reasonCodes: string[];
};

export type SkillResolutionRequest = {
  taskBrief: { goal: string; requestedOutputs: string[] };
  formalArtifacts: ShanHaiArtifactRef[];
  explicitSkillName?: string;
};

const domainTerms: Record<string, string[]> = {
  "shanhai-jiaocai": ["教材", "ocr", "扫描", "pdf", "证据"],
  "shanhai-jiaoan": ["教案", "教学设计", "导入方案"],
  "shanhai-ppt": ["ppt", "课件", "幻灯片"],
  "shanhai-ppt-coze": ["coze", "扣子"],
  "shanhai-imagegen": ["图片", "图像", "视觉资产", "生图"],
  "shanhai-video": ["视频脚本", "视频剧本", "导入视频", "创意短片", "分镜", "视频生产包"],
  "shanhai-video-generation": ["视频成片", "生成视频", "下载视频"],
};
const executionSkillsRequiringFormalInputs = new Set(["shanhai-ppt-coze", "shanhai-video-generation"]);

export class SkillResolver {
  private readonly byName: Map<string, SkillDescriptor>;

  constructor(skills: SkillDescriptor[]) {
    this.byName = new Map(skills.map((skill) => [skill.name, structuredClone(skill)]));
    if (this.byName.size !== skills.length) throw new Error("SkillResolver requires unique active Skill names.");
  }

  resolve(request: SkillResolutionRequest): SkillResolution {
    if (request.explicitSkillName) {
      const selected = this.requireSkill(request.explicitSkillName);
      return {
        mode: "single_skill",
        selectedSkill: selected,
        route: [selected],
        reasonCodes: ["explicit_skill_selection"],
      };
    }

    const resume = this.resolveResume(request);
    if (resume) return resume;

    const targets = this.resolveTargets(request.taskBrief);
    if (!targets.length) throw new Error("No active ShanHai Skill matches the TaskBrief objective.");
    const route = this.orderTargets(this.expandRequiredUpstream(targets, request.formalArtifacts));
    return {
      mode: route.length === 1 ? "single_skill" : "sequential_pipeline",
      selectedSkill: structuredClone(route[0]),
      route,
      reasonCodes: [route.length === 1 ? "shortest_target_route" : "requested_multi_output_route"],
    };
  }

  private resolveResume(request: SkillResolutionRequest): SkillResolution | undefined {
    const intent = normalize([request.taskBrief.goal, ...request.taskBrief.requestedOutputs].join(" "));
    if (!/(修改|审查|复审|继续|恢复|返修|resume|review)/i.test(intent)) return undefined;
    for (const artifact of request.formalArtifacts) {
      if (artifact.status !== "approved" && artifact.status !== "completed") continue;
      const skill = this.byName.get(artifact.sourceSkill);
      if (!skill) continue;
      if (!skill.contracts.produces.some((contract) => contract.artifactType === artifact.artifactType)) continue;
      const selected = structuredClone(skill);
      return {
        mode: "review_resume",
        selectedSkill: selected,
        route: [selected],
        reasonCodes: ["formal_artifact_resume"],
      };
    }
    return undefined;
  }

  private resolveTargets(taskBrief: SkillResolutionRequest["taskBrief"]): SkillDescriptor[] {
    const intent = normalize([taskBrief.goal, ...taskBrief.requestedOutputs].join(" "));
    const expandedIntent = /(完整材料包|全套材料|整套备课)/.test(intent)
      ? `${intent} 教案 ppt 导入视频`
      : intent;
    if (/(coze|扣子)/.test(expandedIntent) && this.byName.has("shanhai-ppt-coze")) {
      return [this.requireSkill("shanhai-ppt-coze")];
    }
    if (/(视频成片|生成视频|下载视频)/.test(expandedIntent) && this.byName.has("shanhai-video-generation")) {
      return [this.requireSkill("shanhai-video-generation")];
    }
    return [...this.byName.values()].filter((skill) => {
      const configuredTerms = domainTerms[skill.name];
      const terms = (configuredTerms ?? [
        skill.displayName,
        skill.responsibility,
        ...skill.triggers,
        ...skill.outputArtifacts,
        ...skill.contracts.produces.flatMap((contract) => [contract.artifactType]),
      ]).map(normalize).filter((term) => term.length >= 2);
      return terms.some((term) => expandedIntent.includes(term) || term.includes(expandedIntent));
    }).map((skill) => structuredClone(skill));
  }

  private expandRequiredUpstream(
    targets: SkillDescriptor[],
    formalArtifacts: ShanHaiArtifactRef[],
  ): SkillDescriptor[] {
    const selected = new Map(targets.map((skill) => [skill.name, structuredClone(skill)]));
    const addRequirements = (skill: SkillDescriptor) => {
      if (!executionSkillsRequiringFormalInputs.has(skill.name)) return;
      for (const required of skill.contracts.consumes) {
        const satisfied = formalArtifacts.some((artifact) =>
          (artifact.status === "approved" || artifact.status === "completed")
          && artifact.artifactType === required.artifactType
          && artifact.contractVersion === required.contractVersion,
        );
        if (satisfied) continue;
        const producer = [...this.byName.values()].find((candidate) =>
          candidate.contracts.produces.some((produced) =>
            produced.artifactType === required.artifactType
            && produced.contractVersion === required.contractVersion,
          ),
        );
        if (!producer) continue;
        if (!selected.has(producer.name)) selected.set(producer.name, structuredClone(producer));
        addRequirements(producer);
      }
    };
    for (const target of targets) addRequirements(target);
    return [...selected.values()];
  }

  private orderTargets(targets: SkillDescriptor[]): SkillDescriptor[] {
    const targetNames = new Set(targets.map((skill) => skill.name));
    const indegree = new Map(targets.map((skill) => [skill.name, 0]));
    const children = new Map(targets.map((skill) => [skill.name, [] as string[]]));
    for (const skill of targets) {
      for (const upstream of skill.upstream) {
        if (!targetNames.has(upstream)) continue;
        indegree.set(skill.name, (indegree.get(skill.name) ?? 0) + 1);
        children.get(upstream)!.push(skill.name);
      }
    }
    const queue = targets.filter((skill) => indegree.get(skill.name) === 0);
    const ordered: SkillDescriptor[] = [];
    while (queue.length) {
      const skill = queue.shift()!;
      ordered.push(skill);
      for (const downstream of children.get(skill.name) ?? []) {
        const next = (indegree.get(downstream) ?? 0) - 1;
        indegree.set(downstream, next);
        if (next === 0) queue.push(this.requireSkill(downstream));
      }
    }
    if (ordered.length !== targets.length) throw new Error("ShanHai Skill target route contains a cycle.");
    return ordered.map((skill) => structuredClone(skill));
  }

  private requireSkill(name: string): SkillDescriptor {
    const skill = this.byName.get(name);
    if (!skill) throw new Error(`Unknown or inactive ShanHai Skill: ${name}`);
    return structuredClone(skill);
  }
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s_./\\-]+/g, "");
}
