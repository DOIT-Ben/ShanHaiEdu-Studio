import { describe, expect, it } from "vitest";

import { SkillResolver } from "@/server/skills/skill-resolver";
import type { SkillDescriptor } from "@/server/skills/skill-runtime-types";

describe("ShanHai Skill resolver", () => {
  it("honors an explicit Main Agent skill selection before inferred routing", () => {
    const resolver = new SkillResolver(descriptors());
    const result = resolver.resolve({
      taskBrief: taskBrief("制作完整材料包", ["教案", "课堂PPT", "导入视频"]),
      formalArtifacts: [],
      explicitSkillName: "shanhai-ppt",
    });

    expect(result.mode).toBe("single_skill");
    expect(result.selectedSkill.name).toBe("shanhai-ppt");
    expect(result.route.map((skill) => skill.name)).toEqual(["shanhai-ppt"]);
    expect(result.reasonCodes).toContain("explicit_skill_selection");
  });

  it("uses an existing formal artifact to resume the producing skill", () => {
    const resolver = new SkillResolver(descriptors());
    const result = resolver.resolve({
      taskBrief: taskBrief("修改现有课堂PPT", ["课堂PPT"]),
      formalArtifacts: [{
        schemaVersion: "shanhai-artifact-ref/v1",
        artifactId: "ppt_1",
        artifactType: "ppt-package",
        contractVersion: "1.0",
        locator: "artifact:ppt_1:v2",
        mediaType: "application/json",
        sourceSkill: "shanhai-ppt",
        sourceVersion: "1.0",
        status: "approved",
      }],
    });

    expect(result.mode).toBe("review_resume");
    expect(result.route.map((skill) => skill.name)).toEqual(["shanhai-ppt"]);
    expect(result.reasonCodes).toContain("formal_artifact_resume");
  });

  it("chooses the shortest target route and does not force unrelated upstream skills", () => {
    const resolver = new SkillResolver(descriptors());

    expect(resolver.resolve({
      taskBrief: taskBrief("根据这些原始材料做一份课堂PPT", ["课堂PPT"]),
      formalArtifacts: [],
    }).route.map((skill) => skill.name)).toEqual(["shanhai-ppt"]);

    expect(resolver.resolve({
      taskBrief: taskBrief("先做教案，再制作课堂PPT", ["教案", "课堂PPT"]),
      formalArtifacts: [],
    }).route.map((skill) => skill.name)).toEqual(["shanhai-jiaoan", "shanhai-ppt"]);
  });

  it("does not mistake ordinary PPT or planning requests for paid execution Skills", () => {
    const resolver = new SkillResolver(descriptors());
    expect(resolver.resolve({
      taskBrief: taskBrief("制作课堂PPT", ["课堂PPT"]),
      formalArtifacts: [],
    }).route.map((skill) => skill.name)).toEqual(["shanhai-ppt"]);
    expect(resolver.resolve({
      taskBrief: taskBrief("使用Coze生成PPTX", ["Coze PPTX"]),
      formalArtifacts: [],
    }).route.map((skill) => skill.name)).toEqual(["shanhai-ppt", "shanhai-ppt-coze"]);
    expect(resolver.resolve({
      taskBrief: taskBrief("使用Coze生成PPTX", ["Coze PPTX"]),
      formalArtifacts: [{
        schemaVersion: "shanhai-artifact-ref/v1",
        artifactId: "ppt-package-1",
        artifactType: "ppt-package",
        contractVersion: "1.0",
        locator: "artifact:ppt-package-1",
        mediaType: "application/json",
        sourceSkill: "shanhai-ppt",
        sourceVersion: "1.0",
        status: "approved",
      }],
    }).route.map((skill) => skill.name)).toEqual(["shanhai-ppt-coze"]);
  });
});

function taskBrief(goal: string, requestedOutputs: string[]) {
  return { goal, requestedOutputs };
}

function descriptors(): SkillDescriptor[] {
  return [
    descriptor({
      name: "shanhai-jiaoan",
      displayName: "山海教案",
      responsibility: "生成教案",
      triggers: ["生成教案", "修改教案"],
      outputs: ["lesson-plan.json"],
      produces: ["lesson-plan"],
      downstream: ["shanhai-ppt", "shanhai-video"],
    }),
    descriptor({
      name: "shanhai-ppt",
      displayName: "山海课件",
      responsibility: "制作课堂PPT",
      triggers: ["制作课堂PPT", "修改PPT"],
      outputs: ["ppt-package.json"],
      produces: ["ppt-package"],
      upstream: ["shanhai-jiaoan"],
    }),
    descriptor({
      name: "shanhai-ppt-coze",
      displayName: "山海 Coze PPT 备用",
      responsibility: "通过Coze执行PPTX生成",
      triggers: ["使用Coze生成PPT"],
      outputs: ["pptx-delivery.json"],
      produces: ["pptx-delivery"],
      consumes: ["ppt-package"],
      upstream: ["shanhai-ppt"],
    }),
    descriptor({
      name: "shanhai-video",
      displayName: "山海视频",
      responsibility: "制作独立创意导入视频",
      triggers: ["制作导入视频", "生成视频脚本"],
      outputs: ["video-package.json"],
      produces: ["video-package"],
      upstream: ["shanhai-jiaoan"],
    }),
  ];
}

function descriptor(input: {
  name: string;
  displayName: string;
  responsibility: string;
  triggers: string[];
  outputs: string[];
  produces: string[];
  consumes?: string[];
  upstream?: string[];
  downstream?: string[];
}): SkillDescriptor {
  return {
    name: input.name,
    version: input.name === "shanhai-jiaoan" ? "1.1" : "1.0",
    displayName: input.displayName,
    responsibility: input.responsibility,
    triggers: input.triggers,
    inputArtifacts: [],
    outputArtifacts: input.outputs,
    contracts: {
      consumes: (input.consumes ?? []).map((artifactType) => ({ artifactType, contractVersion: "1.0" })),
      produces: input.produces.map((artifactType) => ({ artifactType, contractVersion: "1.0", schemaPath: "schema.json" })),
    },
    capabilities: { required: [], optional: [] },
    sideEffects: ["artifact_write"],
    humanGateConditions: [],
    upstream: input.upstream ?? [],
    downstream: input.downstream ?? [],
    status: "active",
  };
}
