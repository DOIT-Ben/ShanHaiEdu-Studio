import { omitObjectKeys } from "@/server/contracts/object-projection";

export const SHANHAI_SKILL_REGISTRY_VERSION = "shanhai-skill-registry/v1" as const;
export const SHANHAI_SKILL_PROTOCOL_VERSION = "shanhai-skill-protocol/v1" as const;
export const SHANHAI_SKILL_INVOCATION_VERSION = "shanhai-skill-invocation/v1" as const;
export const SHANHAI_SKILL_RESULT_VERSION = "shanhai-skill-result/v1" as const;
export const SHANHAI_ARTIFACT_REF_VERSION = "shanhai-artifact-ref/v1" as const;
export const SHANHAI_RUNTIME_EVENT_VERSION = "shanhai-runtime-event/v1" as const;

export type SkillCapability = string;
export type SkillSideEffect =
  | "artifact_write"
  | "external_generation"
  | "external_publish"
  | "destructive_write";
export type SkillHumanGateCondition =
  | "business_choice"
  | "missing_authorization"
  | "paid_external_generation"
  | "external_publish"
  | "destructive_write";

export type SkillContractRef = {
  artifactType: string;
  contractVersion: string;
  schemaPath?: string;
};

export type LoadedSkillContractSchema = {
  artifactType: string;
  contractVersion: string;
  schema: Record<string, unknown>;
  schemaSha256: string;
};

export type SkillDescriptor = {
  name: string;
  version: string;
  displayName: string;
  responsibility: string;
  triggers: string[];
  inputArtifacts: string[];
  outputArtifacts: string[];
  contracts: {
    consumes: SkillContractRef[];
    produces: SkillContractRef[];
  };
  capabilities: {
    required: SkillCapability[];
    optional: SkillCapability[];
  };
  sideEffects: SkillSideEffect[];
  humanGateConditions: SkillHumanGateCondition[];
  upstream: string[];
  downstream: string[];
  status: "active";
};

export type RegisteredSkill = SkillDescriptor & {
  directory: string;
  entrypoint: string;
  skillRoot: string;
  entrypointPath: string;
};

export type ShanHaiArtifactRef = {
  schemaVersion: typeof SHANHAI_ARTIFACT_REF_VERSION;
  artifactId: string;
  artifactType: string;
  contractVersion: string;
  locator: string;
  mediaType: string;
  digest?: string | null;
  sourceSkill: string;
  sourceVersion: string;
  status: "draft" | "needs_review" | "approved" | "completed" | "blocked";
};

export type SkillInvocation = {
  schemaVersion: typeof SHANHAI_SKILL_INVOCATION_VERSION;
  invocationId: string;
  runId: string;
  projectId: string;
  skill: { name: string; version: string; mode: string };
  objective: string;
  inputs: ShanHaiArtifactRef[];
  constraints: {
    contentBoundary: string;
    mustNotPreteach: string[];
    language: string;
  };
  authorization: {
    grantedCapabilities: SkillCapability[];
    allowedSideEffects: SkillSideEffect[];
    humanGateGrants: string[];
  };
  resumeToken: string | null;
};

export type SkillNextAction = {
  type: "none" | "provide_input" | "review" | "retry" | "continue" | "change_route";
  label: string;
};

export type SkillResult = {
  schemaVersion: typeof SHANHAI_SKILL_RESULT_VERSION;
  invocationId: string;
  runId: string;
  skill: { name: string; version: string };
  status: "completed" | "needs_input" | "needs_review" | "blocked" | "failed";
  artifacts: ShanHaiArtifactRef[];
  messages: Array<{ code: string; text: string }>;
  nextAction: SkillNextAction;
  error?: { code: string; message: string; retryable: boolean } | null;
  resumeToken?: string | null;
};

export type SkillResultObservation = Omit<SkillResult, "nextAction">;

export type SkillRuntimeEventType =
  | "stage_started"
  | "capability_requested"
  | "artifact_emitted"
  | "quality_failed"
  | "needs_input"
  | "needs_review"
  | "blocked"
  | "completed"
  | "cancelled";

export type SkillRuntimeEvent = {
  schemaVersion: typeof SHANHAI_RUNTIME_EVENT_VERSION;
  eventId: string;
  runId: string;
  invocationId: string;
  sequence: number;
  occurredAt: string;
  type: SkillRuntimeEventType;
  skill: { name: string; version: string };
  artifactId?: string | null;
  capability?: string | null;
  reasonCode?: string | null;
  message: string;
};

export function toSkillDescriptor(skill: RegisteredSkill): SkillDescriptor {
  return structuredClone(omitObjectKeys(skill, ["directory", "entrypoint", "skillRoot", "entrypointPath"]));
}
