import { randomUUID } from "node:crypto";
import { ProjectExecutionLeaseRejectedError } from "./project-execution-lease";
import type { createWorkbenchService } from "@/server/workbench/service";
import type { ExecutionIdentitySnapshot, ProjectExecutionFence } from "@/server/workbench/types";

type WorkbenchService = ReturnType<typeof createWorkbenchService>;

export async function runWithProjectExecutionLease<T>(input: {
  service: WorkbenchService;
  projectId: string;
  executionIdentity: ExecutionIdentitySnapshot;
  holderPrefix: string;
  task: (service: WorkbenchService, fence: ProjectExecutionFence) => Promise<T>;
  leaseMs?: number;
}) {
  const leaseMs = input.leaseMs ?? 10 * 60 * 1000;
  const holderId = `${input.holderPrefix}-${randomUUID()}`;
  const lease = await input.service.acquireProjectExecutionLease({
    projectId: input.projectId,
    holderId,
    leaseMs,
  });
  if (!lease) {
    throw new ProjectExecutionLeaseRejectedError("Another project execution currently owns the write lease.");
  }

  const fence = { projectId: input.projectId, holderId, fencingToken: lease.fencingToken };
  const guardedService = input.service.withExecutionGuard({ ...fence, identity: input.executionIdentity });
  const stopHeartbeat = startLeaseHeartbeat(input.service, fence, leaseMs);
  try {
    return await input.task(guardedService, fence);
  } finally {
    stopHeartbeat();
    await input.service.releaseProjectExecutionLease(fence).catch(() => false);
  }
}

function startLeaseHeartbeat(service: WorkbenchService, fence: ProjectExecutionFence, leaseMs: number) {
  const intervalMs = Math.max(25, Math.floor(leaseMs / 3));
  const timer = setInterval(() => {
    void service.renewProjectExecutionLease({ ...fence, leaseMs }).catch(() => null);
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
