export type NodeContractMemoryReadPolicy = "none" | "project" | "teacher_and_project";

export type NodeContractMemoryWritePolicy = "none" | "proposal" | "project_auto";

export type NodeContractProviderPolicy = "internal" | "external" | "package";

export type NodeContract = {
  id: string;
  artifactKind: string;
  version: string;
  displayName: string;
  purpose: string;
  requiredInputs: string[];
  requiredOutputs: string[];
  constraints: string[];
  forbidden: string[];
  qualityGates: string[];
  memoryReadPolicy: NodeContractMemoryReadPolicy;
  memoryWritePolicy: NodeContractMemoryWritePolicy;
  providerPolicy: NodeContractProviderPolicy;
};
