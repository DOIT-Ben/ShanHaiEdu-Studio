import { isArtifactTrustedForDownstream } from "@/server/quality/artifact-quality-state";
import {
  isMainAgentControlToolDefinition,
  type MainAgentToolDefinition,
} from "@/server/tools/main-agent-tool-registry";
import type { ArtifactRecord } from "@/server/workbench/types";

import type { TaskBrief } from "./task-contract";

export function describeTeacherVisibleToolCall(input: {
  toolName: string;
  definitions: MainAgentToolDefinition[];
  taskBrief?: TaskBrief;
  artifacts: ArtifactRecord[];
}) {
  const definition = input.definitions.find((tool) => tool.transportName === input.toolName);
  if (!definition) return {};
  const trustedTitles = input.artifacts
    .filter(isArtifactTrustedForDownstream)
    .map((artifact) => artifact.title)
    .slice(-3);
  const inputSummary = [
    ...(input.taskBrief?.goal ? [`任务：${input.taskBrief.goal}`] : []),
    trustedTitles.length ? `依据：${trustedTitles.join("、")}` : "依据：当前任务说明和教师要求",
  ];
  if (isMainAgentControlToolDefinition(definition)) {
    return {
      purpose: "校准一个会实质影响结果的理解边界",
      inputSummary,
      expectedOutput: "教师对当前方向的判断",
    };
  }
  return {
    purpose: definition.teacherDescription ?? definition.description,
    inputSummary,
    expectedOutput: definition.producedArtifactKind ? `可继续使用的${definition.label}` : definition.label,
  };
}
