import type { JsonSchemaObject, ToolFailurePolicy } from "./tool-types";
import type {
  AgentToolDefinition,
  AgentToolId,
  AgentToolProfileId,
  AgentToolTransportName,
} from "./agent-tool-types";
import { createPptDirectorOutputSchema } from "./ppt-director-contract";

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
    description: "先保证短片脱离教材仍成立，再以唯一最小课程锚点回接课程任务，并基于可信视频材料提出节拍、分镜或定点返修建议。",
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
    implemented: true,
    executionSideEffectLevel: "none",
    resultPersistencePolicy: "report_artifact",
    persistenceSideEffectLevel: "artifact_write",
    contractReady: true,
    executorReady: true,
    mainAgentExecutable: true,
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
        items: targetLocatorSchema(),
        minItems: 1,
      },
      reviewFocus: { type: ["string", "null"] },
      courseAnchorRef: artifactVersionRefSchema(true),
      rubricRef: rubricRefSchema(true),
      generatorInvocationId: { type: ["string", "null"], minLength: 1 },
    },
    required: [
      "domain",
      "stage",
      "targetLocators",
      "reviewFocus",
      "courseAnchorRef",
      "rubricRef",
      "generatorInvocationId",
    ],
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
          anchorTrigger: { type: "string", minLength: 1 },
          handoffMoment: { type: "string", minLength: 1 },
          classroomReturnQuestion: { type: "string", minLength: 1 },
          doNotExplain: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
          anchorCount: { type: "integer", const: 1 },
        },
        required: ["anchorTrigger", "handoffMoment", "classroomReturnQuestion", "doNotExplain", "anchorCount"],
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
      findings: { type: "array", items: criticFindingSchema() },
      targetLocators: { type: "array", items: targetLocatorSchema(), minItems: 1 },
      responsibleStage: { type: "string", minLength: 1 },
      minimalFix: { type: "string", minLength: 1 },
      inconclusiveReasons: { type: "array", items: { type: "string", minLength: 1 } },
      hardGateResults: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            gateId: { type: "string", minLength: 1 },
            status: { type: "string", enum: ["passed", "failed", "inconclusive"] },
            evidenceRefs: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
            rationale: { type: "string", minLength: 1 },
            findingIds: { type: "array", items: { type: "string", minLength: 1 } },
          },
          required: ["gateId", "status", "evidenceRefs", "rationale", "findingIds"],
        },
      },
    },
    required: [
      "recommendation",
      "summary",
      "findings",
      "targetLocators",
      "responsibleStage",
      "minimalFix",
      "inconclusiveReasons",
      "hardGateResults",
    ],
  };
}

function artifactVersionRefSchema(nullable = false) {
  return {
    type: nullable ? ["object", "null"] : "object",
    additionalProperties: false,
    properties: {
      artifactId: { type: "string", minLength: 1 },
      version: { type: "integer" },
      digest: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
    },
    required: ["artifactId", "version", "digest"],
  };
}

function rubricRefSchema(nullable = false) {
  return {
    type: nullable ? ["object", "null"] : "object",
    additionalProperties: false,
    properties: {
      id: { type: "string", minLength: 1 },
      version: { type: "string", minLength: 1 },
      digest: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
    },
    required: ["id", "version", "digest"],
  };
}

function criticFindingSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      findingId: { type: "string", minLength: 1 },
      severity: { type: "string", enum: ["blocker", "major", "minor"] },
      locator: targetLocatorSchema(),
      evidenceRefs: { type: "array", items: { type: "string", minLength: 1 } },
      responsibleStage: { type: "string", minLength: 1 },
      minimalFix: { type: "string", minLength: 1 },
      invalidatesDownstream: { type: "boolean" },
      dimensionId: { type: ["string", "null"], enum: ["design", "visual", "provenance", "readability", null] },
    },
    required: [
      "findingId",
      "severity",
      "locator",
      "evidenceRefs",
      "responsibleStage",
      "minimalFix",
      "invalidatesDownstream",
    ],
  };
}

function targetLocatorSchema() {
  return {
    oneOf: [
      locatorVariant("artifact", {
        artifactKind: { type: "string", minLength: 1 },
        artifactId: { type: "string", minLength: 1 },
      }, ["artifactKind", "artifactId"]),
      locatorVariant("input", { artifactKind: { type: "string", minLength: 1 } }, ["artifactKind"]),
      locatorVariant("tool", { toolId: { type: "string", minLength: 1 } }, ["toolId"]),
      locatorVariant("page", {
        pageId: { type: "string", minLength: 1 },
        parentArtifactId: { type: "string", minLength: 1 },
      }, ["pageId", "parentArtifactId"]),
      locatorVariant("asset", {
        assetId: { type: "string", minLength: 1 },
        parentArtifactId: { type: "string", minLength: 1 },
        ownerUnitId: { type: "string", minLength: 1 },
      }, ["assetId", "parentArtifactId"]),
      locatorVariant("shot", {
        shotId: { type: "string", minLength: 1 },
        parentArtifactId: { type: "string", minLength: 1 },
      }, ["shotId", "parentArtifactId"]),
      locatorVariant("track", {
        trackId: { type: "string", minLength: 1 },
        trackType: { type: "string", enum: ["narration", "caption", "overlay", "music", "effects"] },
        parentArtifactId: { type: "string", minLength: 1 },
        timeRangeMs: timeRangeSchema(),
      }, ["trackId", "trackType", "parentArtifactId"]),
      locatorVariant("timeline", {
        timelineId: { type: "string", minLength: 1 },
        parentArtifactId: { type: "string", minLength: 1 },
        timeRangeMs: timeRangeSchema(),
      }, ["timelineId", "parentArtifactId", "timeRangeMs"]),
      locatorVariant("frame_range", {
        parentArtifactId: { type: "string", minLength: 1 },
        parentShotId: { type: "string", minLength: 1 },
        timeRangeMs: timeRangeSchema(),
        frameRefs: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
      }, ["parentArtifactId", "parentShotId", "timeRangeMs", "frameRefs"]),
    ],
  };
}

function locatorVariant(
  kind: string,
  properties: Record<string, unknown>,
  required: string[],
) {
  return {
    type: "object",
    additionalProperties: false,
    properties: { kind: { const: kind }, ...properties },
    required: ["kind", ...required],
  };
}

function timeRangeSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: { start: { type: "number" }, end: { type: "number" } },
    required: ["start", "end"],
  };
}

function cloneAgentToolDefinition(definition: AgentToolDefinition): AgentToolDefinition {
  return structuredClone(definition);
}
