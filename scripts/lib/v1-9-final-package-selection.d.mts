export type V1_9FinalPackageArtifactCandidate = {
  id: string;
  projectId: string;
  taskId?: string | null;
  taskBriefDigest?: string | null;
  intentEpoch?: number | null;
  planRevision?: number | null;
  origin?: string | null;
  nodeKey: string;
  kind: string;
  status: string;
  version: number;
  isApproved: boolean;
  updatedAt?: string;
  structuredContent: Record<string, unknown>;
};

export type V1_9FinalPackageSelectionBinding = {
  projectId: string;
  taskId: string;
  taskBriefDigest: string;
  intentEpoch: number;
  currentPlanRevision: number;
  previousPackageArtifactVersion: number | null;
  previousPackageVersion: string | null;
};

export function selectLatestV1_9FinalPackage<T extends V1_9FinalPackageArtifactCandidate>(
  artifacts: readonly T[],
  binding: V1_9FinalPackageSelectionBinding,
): T | null;

export function assertV1_9FinalPackageDownloadPath(
  pathname: string,
  binding: { projectId: string; artifactId: string },
): void;
