import { describe, expect, it } from "vitest";
import type { WorkbenchActor } from "@/server/auth/actor";
import { createWorkbenchService } from "@/server/workbench/service";
import type { WorkbenchRepository } from "@/server/workbench/repository";
import type { AddMessageInput } from "@/server/workbench/types";

describe("M40 public auth authorization", () => {
  it("allows owners and editors to write while viewers are read-only", async () => {
    const repository = createAuthorizationFixture();
    const ownerService = createWorkbenchService(repository, actor("owner-user", { projectA: "owner" }));
    const editorService = createWorkbenchService(repository, actor("editor-user", { projectA: "editor" }));
    const viewerService = createWorkbenchService(repository, actor("viewer-user", { projectA: "viewer" }));

    await expect(ownerService.getProjectSnapshot("projectA")).resolves.toMatchObject({ project: { id: "projectA" } });
    await expect(editorService.addMessage("projectA", { role: "teacher", content: "编辑补充" })).resolves.toMatchObject({
      projectId: "projectA",
      role: "teacher",
    });
    await expect(viewerService.getProjectSnapshot("projectA")).resolves.toMatchObject({ project: { id: "projectA" } });
    await expect(viewerService.addMessage("projectA", { role: "teacher", content: "只读用户写入" })).rejects.toThrow(
      /Project not found|access denied/i,
    );
  });

  it("blocks non-members and only keeps legacy ownerless projects visible in local mode", async () => {
    const repository = createAuthorizationFixture();
    const strangerService = createWorkbenchService(repository, actor("stranger-user"));
    const publicService = createWorkbenchService(repository, actor("public-user"));
    const localService = createWorkbenchService(repository, {
      userId: "local-user",
      role: "teacher",
      displayName: "本地教师",
      authMode: "local",
      isAdmin: false,
      projectRoles: {},
    });

    await expect(strangerService.getProjectSnapshot("projectA")).rejects.toThrow(/Project not found|access denied/i);
    await expect(publicService.getProjectSnapshot("legacyProject")).rejects.toThrow(/Project not found|access denied/i);
    await expect(localService.getProjectSnapshot("legacyProject")).resolves.toMatchObject({ project: { id: "legacyProject" } });
  });

  it("lets admins read but does not grant silent member management in the workbench content service", async () => {
    const repository = createAuthorizationFixture();
    const adminService = createWorkbenchService(repository, {
      userId: "admin-user",
      role: "admin",
      displayName: "管理员",
      authMode: "password",
      isAdmin: true,
      projectRoles: {},
    });

    await expect(adminService.getProjectSnapshot("projectA")).resolves.toMatchObject({ project: { id: "projectA" } });
    await expect(adminService.addMessage("projectA", { role: "teacher", content: "管理员审计写入" })).rejects.toThrow(
      /Project not found|access denied/i,
    );
  });
});

function actor(userId: string, projectRoles: WorkbenchActor["projectRoles"] = {}): WorkbenchActor {
  return {
    userId,
    role: "teacher",
    displayName: "教师",
    authMode: "password",
    isAdmin: false,
    projectRoles,
  };
}

function createAuthorizationFixture(): WorkbenchRepository {
  const projects = {
    projectA: makeProject("projectA", "owner-user"),
    legacyProject: makeProject("legacyProject", null),
  };
  const messages: Record<string, any[]> = {
    projectA: [makeMessage("messageA", "projectA")],
    legacyProject: [makeMessage("messageLegacy", "legacyProject")],
  };

  return {
    async listProjects() {
      return Object.values(projects);
    },
    async createProject() {
      return projects.projectA;
    },
    async getProject(projectId: string) {
      return projects[projectId as keyof typeof projects] ?? null;
    },
    async addMessage(projectId: string, input: AddMessageInput) {
      const message = makeMessage(`message-${messages[projectId].length + 1}`, projectId, input.content);
      messages[projectId].push(message);
      return message;
    },
    async updateMessageMetadata(projectId: string, messageId: string, metadata: Record<string, unknown>) {
      const message = messages[projectId]?.find((entry) => entry.id === messageId) ?? makeMessage(messageId, projectId);
      return { ...message, metadata };
    },
    async saveArtifact() {
      return makeArtifact("artifactA", "projectA");
    },
    async getArtifact() {
      return makeArtifact("artifactA", "projectA");
    },
    async approveArtifact() {
      return makeArtifact("artifactA", "projectA", "approved");
    },
    async regenerateArtifact() {
      return makeArtifact("artifactB", "projectA", "needs_review");
    },
    async getArtifactsByKinds(projectId: string) {
      return [makeArtifact("artifactA", projectId, "approved")];
    },
    async createGenerationJob() {
      return makeGenerationJob("jobA", "projectA");
    },
    async startGenerationJob() {
      return makeGenerationJob("jobA", "projectA", "running");
    },
    async getStagedGenerationResult() {
      return null;
    },
    async stageGenerationResult() {
      throw new Error("not used");
    },
    async promoteStagedGenerationResult() {
      throw new Error("not used");
    },
    async failGenerationJob() {
      return makeGenerationJob("jobA", "projectA", "failed");
    },
    async getGenerationJobs(projectId: string) {
      return [makeGenerationJob("jobA", projectId)];
    },
    async enqueueConversationTurn(projectId: string) {
      return makeConversationTurnJob("turnJobA", projectId);
    },
    async enqueueMessageAndConversationTurn(projectId: string) {
      const message = makeMessage(`message-${messages[projectId].length + 1}`, projectId, "需求");
      messages[projectId].push(message);
      return { message, job: makeConversationTurnJob("turnJobA", projectId) };
    },
    async startNextConversationTurnJob(projectId: string) {
      return makeConversationTurnJob("turnJobA", projectId, "running");
    },
    async finishConversationTurnJob(projectId: string) {
      return makeConversationTurnJob("turnJobA", projectId, "succeeded");
    },
    async failConversationTurnJob(projectId: string) {
      return makeConversationTurnJob("turnJobA", projectId, "failed");
    },
    async getConversationTurnJobs(projectId: string) {
      return [makeConversationTurnJob("turnJobA", projectId)];
    },
    async getMessages(projectId: string) {
      return messages[projectId] ?? [];
    },
    async getArtifacts(projectId: string) {
      return [makeArtifact("artifactA", projectId)];
    },
  } as unknown as WorkbenchRepository;
}

function makeProject(id: string, ownerUserId: string | null) {
  return {
    id,
    title: id,
    status: "active",
    currentNodeKey: "requirement_spec",
    ownerUserId,
    grade: null,
    subject: null,
    textbookVersion: null,
    lessonTopic: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function makeMessage(id: string, projectId: string, content = "需求") {
  return {
    id,
    projectId,
    role: "teacher",
    content,
    artifactRefsJson: "[]",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function makeArtifact(id: string, projectId: string, status = "needs_review") {
  return {
    id,
    projectId,
    nodeKey: "requirement_spec",
    title: "需求规格",
    kind: "requirement_spec",
    status,
    summary: "摘要",
    markdownContent: "正文",
    structuredContentJson: "{}",
    version: 1,
    isApproved: status === "approved",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function makeGenerationJob(id: string, projectId: string, status = "queued") {
  return {
    id,
    projectId,
    kind: "pptx",
    sourceArtifactId: "artifactA",
    status,
    attempts: status === "queued" ? 0 : 1,
    maxAttempts: 2,
    resultArtifactId: null,
    errorMessage: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    startedAt: status === "queued" ? null : new Date("2026-01-01T00:00:30.000Z"),
    finishedAt: status === "succeeded" || status === "failed" ? new Date("2026-01-01T00:01:00.000Z") : null,
  };
}

function makeConversationTurnJob(id: string, projectId: string, status = "queued") {
  return {
    id,
    projectId,
    teacherMessageId: "messageA",
    assistantMessageId: null,
    status,
    attempts: status === "queued" ? 0 : 1,
    maxAttempts: 2,
    idempotencyKey: null,
    lockedBy: null,
    lockedUntil: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    startedAt: status === "queued" ? null : new Date("2026-01-01T00:00:30.000Z"),
    finishedAt: status === "succeeded" || status === "failed" ? new Date("2026-01-01T00:01:00.000Z") : null,
  };
}
