import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db/client";
import { createWorkbenchService } from "../service";

const actorA = {
  userId: "local-stage29-user-a",
  role: "teacher" as const,
  displayName: "本地教师 A",
};

const actorB = {
  userId: "local-stage29-user-b",
  role: "teacher" as const,
  displayName: "本地教师 B",
};

describe("Local Real MVP M29 local auth access", () => {
  it("assigns new projects to the current local actor and scopes project lists", async () => {
    const serviceA = createWorkbenchService(undefined, actorA);
    const serviceB = createWorkbenchService(undefined, actorB);

    const project = await serviceA.createProject({ title: "M29 actor A owned project" });
    const persisted = await prisma.project.findUnique({ where: { id: project.id } });
    const projectsA = await serviceA.listProjects();
    const projectsB = await serviceB.listProjects();

    expect((persisted as { ownerUserId?: string | null } | null)?.ownerUserId).toBe(actorA.userId);
    expect(projectsA.map((entry) => entry.id)).toContain(project.id);
    expect(projectsB.map((entry) => entry.id)).not.toContain(project.id);
  });

  it("blocks another local actor from reading or mutating a project", async () => {
    const serviceA = createWorkbenchService(undefined, actorA);
    const serviceB = createWorkbenchService(undefined, actorB);

    const project = await serviceA.createProject({ title: "M29 private project" });
    const artifact = await serviceA.saveArtifact(project.id, {
      nodeKey: "requirement_spec",
      kind: "requirement_spec",
      title: "需求规格",
      status: "needs_review",
      summary: "actor A private draft",
      markdownContent: "# actor A private draft",
    });

    await expect(serviceB.getProjectSnapshot(project.id)).rejects.toThrow(/Project not found|access denied/i);
    await expect(serviceB.getMessages(project.id)).rejects.toThrow(/Project not found|access denied/i);
    await expect(serviceB.addMessage(project.id, { role: "teacher", content: "越权消息" })).rejects.toThrow(/Project not found|access denied/i);
    await expect(serviceB.getArtifact(project.id, artifact.id)).rejects.toThrow(/Artifact not found|Project not found|access denied/i);
    await expect(serviceB.approveArtifact(project.id, artifact.id)).rejects.toThrow(/Artifact not found|Project not found|access denied/i);
    await expect(
      serviceB.regenerateArtifact(project.id, artifact.id, {
        summary: "越权重做",
        markdownContent: "# 越权重做",
      }),
    ).rejects.toThrow(/Artifact not found|Project not found|access denied/i);
  });

  it("keeps ownerless legacy projects readable for local upgrade compatibility", async () => {
    const legacyService = createWorkbenchService();
    const serviceA = createWorkbenchService(undefined, actorA);

    const legacyProject = await legacyService.createProject({ title: "M29 legacy ownerless project" });
    const snapshot = await serviceA.getProjectSnapshot(legacyProject.id);

    expect(snapshot.project.id).toBe(legacyProject.id);
  });
});
