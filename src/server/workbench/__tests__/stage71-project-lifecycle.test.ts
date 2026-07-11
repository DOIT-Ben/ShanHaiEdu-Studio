import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { createWorkbenchActor } from "@/server/auth/actor";
import { createWorkbenchService } from "../service";

const actor = createWorkbenchActor({
  userId: "local-stage71-owner",
  displayName: "M71A 本地教师",
  authMode: "local",
});

describe("M71A project lifecycle", () => {
  it("archives and restores a project with an optimistic lifecycle version", async () => {
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: "M71A 生命周期归档恢复" });

    const archived = await service.mutateProjectLifecycle(project.id, {
      action: "archive",
      expectedLifecycleVersion: 0,
    });

    expect(archived).toMatchObject({
      changed: true,
      project: {
        id: project.id,
        lifecycleState: "archived",
        lifecycleVersion: 1,
      },
    });
    await expect(service.mutateProjectLifecycle(project.id, {
      action: "restore",
      expectedLifecycleVersion: 0,
    })).rejects.toMatchObject({ code: "project_version_conflict", status: 409 });

    const restored = await service.mutateProjectLifecycle(project.id, {
      action: "restore",
      expectedLifecycleVersion: 1,
    });

    expect(restored.project).toMatchObject({ lifecycleState: "active", lifecycleVersion: 2, archivedAt: null, deletedAt: null });
  });

  it("rejects lifecycle changes while current work is pending and reconciles stale jobs", async () => {
    const service = createWorkbenchService(undefined, actor);
    const project = await service.createProject({ title: "M71A 生命周期忙碌保护" });
    const message = await service.addMessage(project.id, { role: "teacher", content: "请保留这个排队任务。" });
    const job = await service.enqueueConversationTurn(project.id, { teacherMessageId: message.id });

    await expect(service.mutateProjectLifecycle(project.id, {
      action: "trash",
      expectedLifecycleVersion: 0,
    })).rejects.toMatchObject({ code: "project_busy", status: 409 });

    await prisma.conversationTurnJob.update({
      where: { id: job.id },
      data: { updatedAt: new Date(Date.now() - 31 * 60 * 1000) },
    });
    const trashed = await service.mutateProjectLifecycle(project.id, {
      action: "trash",
      expectedLifecycleVersion: 0,
    });

    expect(trashed.project).toMatchObject({ lifecycleState: "trash", lifecycleVersion: 1 });
    await expect(service.getConversationTurnJobs(project.id)).resolves.toEqual([
      expect.objectContaining({ id: job.id, status: "failed" }),
    ]);
    await expect(service.addMessage(project.id, { role: "teacher", content: "回收站项目不能继续写入。" })).rejects.toMatchObject({ code: "project_lifecycle_conflict", status: 409 });
  });
});
