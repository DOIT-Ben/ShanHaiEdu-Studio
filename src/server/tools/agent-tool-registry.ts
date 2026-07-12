import type { JsonSchemaObject, ToolFailurePolicy } from "./tool-types";
import type {
  AgentToolDefinition,
  AgentToolId,
  AgentToolProfileId,
  AgentToolTransportName,
} from "./agent-tool-types";

const readOnlyFailurePolicy: ToolFailurePolicy = {
  retryable: true,
  maxRetries: 1,
  onFailure: "record_observation",
};

const agentToolDefinitions: AgentToolDefinition[] = [
  createAgentToolDefinition({
    id: "ppt_director.plan_or_repair",
    transportName: "ppt_director_plan_or_repair",
    agentProfileId: "ppt_director",
    label: "规划或返修课件",
    description: "根据可信课件材料提出叙事、视觉、逐页设计或定点返修建议。",
    inputContract: { id: "ppt-director-input", version: "v1" },
    outputContract: { id: "ppt-director-result", version: "v1" },
    inputSchema: directorInputSchema("targetPageIds"),
    outputSchema: createPptDirectorOutputSchema(),
  }),
  createAgentToolDefinition({
    id: "video_director.plan_or_repair",
    transportName: "video_director_plan_or_repair",
    agentProfileId: "video_director",
    label: "规划或返修导入视频",
    description: "根据课程锚点和可信视频材料提出独立创意、节拍、分镜或定点返修建议。",
    inputContract: { id: "video-director-input", version: "v1" },
    outputContract: { id: "video-director-result", version: "v1" },
    inputSchema: directorInputSchema("targetShotIds"),
    outputSchema: createVideoDirectorOutputSchema(),
  }),
  createAgentToolDefinition({
    id: "delivery_critic.review",
    transportName: "delivery_critic_review",
    agentProfileId: "delivery_critic",
    label: "审查交付质量",
    description: "依据受控量表审查课件、视频或最终交付，并返回定位明确的审查报告。",
    inputContract: { id: "delivery-critic-input", version: "v1" },
    outputContract: { id: "critic-report", version: "v1" },
    inputSchema: createCriticInputSchema(),
    outputSchema: createCriticOutputSchema(),
  }),
];

export function listAgentToolDefinitions(): AgentToolDefinition[] {
  return agentToolDefinitions.map(cloneAgentToolDefinition);
}

export function getAgentToolDefinition(id: string): AgentToolDefinition {
  const definition = agentToolDefinitions.find((tool) => tool.id === id);
  if (!definition) throw new Error(`Unknown Agent Tool: ${id}`);
  return cloneAgentToolDefinition(definition);
}

export function getAgentToolDefinitionByTransportName(transportName: string): AgentToolDefinition {
  const definition = agentToolDefinitions.find((tool) => tool.transportName === transportName);
  if (!definition) throw new Error(`Unknown Agent Tool transport name: ${transportName}`);
  return cloneAgentToolDefinition(definition);
}

function createAgentToolDefinition(input: {
  id: AgentToolId;
  transportName: AgentToolTransportName;
  agentProfileId: AgentToolProfileId;
  label: string;
  description: string;
  inputContract: AgentToolDefinition["inputContract"];
  outputContract: AgentToolDefinition["outputContract"];
  inputSchema: JsonSchemaObject;
  outputSchema: JsonSchemaObject;
}): AgentToolDefinition {
  return {
    ...input,
    adapterKind: "agent",
    requiresHumanGate: false,
    sideEffectLevel: "none",
    requiredArtifactKinds: [],
    failurePolicy: readOnlyFailurePolicy,
    implemented: false,
    executionSideEffectLevel: "none",
    resultPersistencePolicy: "report_artifact",
    persistenceSideEffectLevel: "artifact_write",
    contractReady: true,
    executorReady: false,
    mainAgentExecutable: false,
    modelVisible: true,
  };
}

function directorInputSchema(targetField: "targetPageIds" | "targetShotIds"): JsonSchemaObject {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      goal: { type: "string" },
      stage: { type: "string" },
      [targetField]: { type: "array", items: { type: "string" } },
      focus: { type: ["string", "null"] },
    },
    required: ["goal", "stage", targetField, "focus"],
  };
}

function createCriticInputSchema(): JsonSchemaObject {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      domain: { type: "string", enum: ["ppt", "video", "final_delivery"] },
      stage: { type: "string" },
      targetLocators: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string" },
            id: { type: "string" },
          },
          required: ["kind", "id"],
        },
      },
      reviewFocus: { type: ["string", "null"] },
    },
    required: ["domain", "stage", "targetLocators", "reviewFocus"],
  };
}

function createPptDirectorOutputSchema(): JsonSchemaObject {
  return {
    type: "object",
    additionalProperties: false,
    properties: createCommonDirectorOutputProperties(),
    required: commonDirectorOutputRequired(),
  };
}

function createVideoDirectorOutputSchema(): JsonSchemaObject {
  const independentCheck = {
    type: "object",
    additionalProperties: false,
    properties: { passed: { type: "boolean" }, evidence: { type: "string", minLength: 1 } },
    required: ["passed", "evidence"],
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ...createCommonDirectorOutputProperties(),
      verdict: { type: "string", enum: ["pass", "rework_required"] },
      independentFilmChecks: {
        type: "object",
        additionalProperties: false,
        properties: {
          understandableWithoutLesson: independentCheck,
          worthwhileWithoutClassroomReturn: independentCheck,
          notTextbookOrPptRetelling: independentCheck,
        },
        required: ["understandableWithoutLesson", "worthwhileWithoutClassroomReturn", "notTextbookOrPptRetelling"],
      },
      storyWorld: {
        type: "object",
        additionalProperties: false,
        properties: {
          premise: { type: "string", minLength: 1 },
          requiredCharacters: { type: "array", items: { type: "string" } },
          requiredSettings: { type: "array", items: { type: "string" } },
        },
        required: ["premise", "requiredCharacters", "requiredSettings"],
      },
      courseAnchor: {
        type: "object",
        additionalProperties: false,
        properties: {
          handoffMoment: { type: "string", minLength: 1 },
          classroomReturnQuestion: { type: "string", minLength: 1 },
        },
        required: ["handoffMoment", "classroomReturnQuestion"],
      },
    },
    required: [...commonDirectorOutputRequired(), "verdict", "independentFilmChecks", "storyWorld", "courseAnchor"],
  };
}

function createCommonDirectorOutputProperties() {
  return {
    decision: { type: "string", enum: ["plan", "repair", "needs_input", "blocked"] },
    summary: { type: "string" },
    targetLocators: { type: "array", items: { type: "string" } },
    nextToolIntents: { type: "array", items: { type: "string" } },
    assumptions: { type: "array", items: { type: "string" } },
    stopConditions: { type: "array", items: { type: "string" } },
  };
}

function commonDirectorOutputRequired() {
  return ["decision", "summary", "targetLocators", "nextToolIntents", "assumptions", "stopConditions"];
}

function createCriticOutputSchema(): JsonSchemaObject {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      recommendation: { type: "string", enum: ["pass", "rework_required", "blocked", "inconclusive"] },
      summary: { type: "string" },
      findings: { type: "array", items: { type: "string" } },
      targetLocators: { type: "array", items: { type: "string" } },
      responsibleStage: { type: "string" },
      minimalFix: { type: "string" },
      hardGateResults: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            gateId: { type: "string" },
            status: { type: "string", enum: ["passed", "failed", "inconclusive"] },
            evidenceRefs: { type: "array", items: { type: "string" } },
            rationale: { type: "string" },
          },
          required: ["gateId", "status", "evidenceRefs", "rationale"],
        },
      },
    },
    required: ["recommendation", "summary", "findings", "targetLocators", "responsibleStage", "minimalFix", "hardGateResults"],
  };
}

function cloneAgentToolDefinition(definition: AgentToolDefinition): AgentToolDefinition {
  return structuredClone(definition);
}
