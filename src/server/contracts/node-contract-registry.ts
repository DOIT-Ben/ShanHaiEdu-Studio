import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  NodeContract,
  NodeContractMemoryReadPolicy,
  NodeContractMemoryWritePolicy,
  NodeContractProviderPolicy,
} from "./node-contract-types";

const publishedContractIds = ["requirement_spec", "lesson_plan", "ppt_design", "coze_ppt", "final_package"] as const;

const capabilityIdToContractId = {
  requirement_spec: "requirement_spec",
  lesson_plan: "lesson_plan",
  ppt_design: "ppt_design",
  coze_ppt: "coze_ppt",
  final_package: "final_package",
} as const satisfies Record<string, (typeof publishedContractIds)[number]>;

let publishedContractsCache: NodeContract[] | null = null;

export function getPublishedNodeContract(id: string): NodeContract {
  const contract = getPublishedNodeContracts().find((publishedContract) => publishedContract.id === id);
  if (!contract) {
    throw new Error(`Unknown node contract: ${id}`);
  }
  return cloneContract(contract);
}

export function getPublishedNodeContractByCapabilityId(capabilityId: string): NodeContract {
  const contractId = capabilityIdToContractId[capabilityId as keyof typeof capabilityIdToContractId];
  if (!contractId) {
    throw new Error(`Unknown capability for node contract: ${capabilityId}`);
  }
  return getPublishedNodeContract(contractId);
}

export function getPublishedNodeContractByWorkflowNodeKey(workflowNodeKey: string): NodeContract {
  const contract = getPublishedNodeContracts().find(
    (publishedContract) => publishedContract.workflowNodeKey === workflowNodeKey,
  );
  if (!contract) {
    throw new Error(`Unknown workflow node for node contract: ${workflowNodeKey}`);
  }
  return cloneContract(contract);
}

export function getPublishedNodeContracts(): NodeContract[] {
  if (!publishedContractsCache) {
    publishedContractsCache = publishedContractIds.map((contractId) =>
      readNodeContract(join(process.cwd(), "config", "node-contracts", `${contractId}.json`)),
    );
  }
  return publishedContractsCache.map(cloneContract);
}

function readNodeContract(filePath: string): NodeContract {
  const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
  assertNodeContract(parsed, filePath);
  return parsed;
}

function cloneContract(contract: NodeContract): NodeContract {
  return {
    ...contract,
    requiredInputs: [...contract.requiredInputs],
    requiredOutputs: [...contract.requiredOutputs],
    constraints: [...contract.constraints],
    forbidden: [...contract.forbidden],
    qualityGates: [...contract.qualityGates],
  };
}

function assertNodeContract(value: unknown, source: string): asserts value is NodeContract {
  if (!isRecord(value)) {
    throw new Error(`Invalid node contract JSON: ${source}`);
  }

  for (const field of ["id", "workflowNodeKey", "artifactKind", "version", "displayName", "purpose"] as const) {
    if (typeof value[field] !== "string" || value[field].trim().length === 0) {
      throw new Error(`Invalid node contract field ${field}: ${source}`);
    }
  }

  for (const field of ["requiredInputs", "requiredOutputs", "constraints", "forbidden", "qualityGates"] as const) {
    if (!isStringArray(value[field])) {
      throw new Error(`Invalid node contract array field ${field}: ${source}`);
    }
  }

  if (!isMemoryReadPolicy(value.memoryReadPolicy)) {
    throw new Error(`Invalid node contract memoryReadPolicy: ${source}`);
  }
  if (!isMemoryWritePolicy(value.memoryWritePolicy)) {
    throw new Error(`Invalid node contract memoryWritePolicy: ${source}`);
  }
  if (!isProviderPolicy(value.providerPolicy)) {
    throw new Error(`Invalid node contract providerPolicy: ${source}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function isMemoryReadPolicy(value: unknown): value is NodeContractMemoryReadPolicy {
  return value === "none" || value === "project" || value === "teacher_and_project";
}

function isMemoryWritePolicy(value: unknown): value is NodeContractMemoryWritePolicy {
  return value === "none" || value === "proposal" || value === "project_auto";
}

function isProviderPolicy(value: unknown): value is NodeContractProviderPolicy {
  return value === "internal" || value === "external" || value === "package";
}
