import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = process.cwd();

test("project member management lists sanitized members and lets owner add a viewer", async () => {
  const db = createFakeProjectMemberDb();
  const service = loadProjectMemberManagementModule(db);
  const owner = ownerActor();
  const now = new Date("2026-07-11T00:00:00.000Z");

  const initial = await service.listProjectMembers({ projectId: "project_1", actor: owner }, { db });
  assert.deepEqual(initial.items.map((member) => [member.userId, member.email, member.role]), [["owner_1", "owner@example.test", "owner"]]);
  assert.doesNotMatch(JSON.stringify(initial), /passwordHash|sessionToken|hash-owner/);

  const added = await service.addProjectMember(
    { projectId: "project_1", email: "viewer@example.test", role: "viewer", actor: owner },
    { db, now: () => now },
  );

  assert.equal(added.userId, "viewer_1");
  assert.equal(added.role, "viewer");
  assert.equal(db.projectMemberships.some((entry) => entry.projectId === "project_1" && entry.userId === "viewer_1" && entry.role === "viewer"), true);
  assert.equal(db.auditLogs.at(-1).action, "project.member.added");
});

test("project member management blocks non-managers and protects the project owner", async () => {
  const db = createFakeProjectMemberDb();
  const service = loadProjectMemberManagementModule(db);

  const viewerError = await captureRejection(() =>
    service.addProjectMember({ projectId: "project_1", email: "viewer@example.test", role: "editor", actor: viewerActor() }, { db }),
  );
  assert.equal(viewerError.status, 403);

  const removeOwnerError = await captureRejection(() =>
    service.removeProjectMember({ projectId: "project_1", userId: "owner_1", actor: ownerActor() }, { db }),
  );
  assert.equal(removeOwnerError.status, 400);
  assert.match(removeOwnerError.message, /不能移除项目拥有者/);

  const addOwnerError = await captureRejection(() =>
    service.addProjectMember({ projectId: "project_1", userId: "owner_1", role: "viewer", actor: ownerActor() }, { db }),
  );
  assert.equal(addOwnerError.status, 400);
  assert.equal(db.projectMemberships.find((entry) => entry.userId === "owner_1")?.role, "owner");
});

function createFakeProjectMemberDb() {
  const createdAt = new Date("2026-07-10T00:00:00.000Z");
  const projects = [{ id: "project_1", ownerUserId: "owner_1", title: "公开课备课" }];
  const localUsers = [
    { id: "owner_1", email: "owner@example.test", displayName: "项目拥有者", role: "teacher", authMode: "password", passwordHash: "hash-owner" },
    { id: "viewer_1", email: "viewer@example.test", displayName: "观摩教师", role: "teacher", authMode: "password", passwordHash: "hash-viewer" },
  ];
  const projectMemberships = [{ id: "membership_owner", projectId: "project_1", userId: "owner_1", role: "owner", createdAt, updatedAt: createdAt }];
  const auditLogs = [];
  const db = {
    projects,
    localUsers,
    projectMemberships,
    auditLogs,
    project: {
      async findUnique({ where }) {
        return projects.find((project) => project.id === where.id) ?? null;
      },
    },
    localUser: {
      async findFirst({ where }) {
        return localUsers.find((user) => user.email === where.email && user.authMode === where.authMode) ?? null;
      },
      async findUnique({ where }) {
        return localUsers.find((user) => user.id === where.id || user.email === where.email) ?? null;
      },
    },
    projectMembership: {
      async findMany({ where }) {
        return projectMemberships
          .filter((entry) => entry.projectId === where.projectId)
          .map((entry) => ({ ...entry, user: localUsers.find((user) => user.id === entry.userId) }));
      },
      async upsert({ where, update, create }) {
        const existing = projectMemberships.find((entry) => entry.projectId === where.projectId_userId.projectId && entry.userId === where.projectId_userId.userId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const entry = { id: `membership_${projectMemberships.length + 1}`, ...create, createdAt, updatedAt: createdAt };
        projectMemberships.push(entry);
        return entry;
      },
      async deleteMany({ where }) {
        const before = projectMemberships.length;
        for (let index = projectMemberships.length - 1; index >= 0; index -= 1) {
          const entry = projectMemberships[index];
          if (entry.projectId === where.projectId && entry.userId === where.userId) projectMemberships.splice(index, 1);
        }
        return { count: before - projectMemberships.length };
      },
    },
    auditLog: {
      async create({ data }) {
        auditLogs.push(data);
        return data;
      },
    },
    async $transaction(callback) {
      return callback(db);
    },
  };
  return db;
}

function ownerActor() {
  return { userId: "owner_1", displayName: "项目拥有者", role: "teacher", authMode: "password", isAdmin: false, projectRoles: { project_1: "owner" } };
}

function viewerActor() {
  return { userId: "viewer_1", displayName: "观摩教师", role: "teacher", authMode: "password", isAdmin: false, projectRoles: { project_1: "viewer" } };
}

async function captureRejection(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail("Expected operation to reject");
}

function loadProjectMemberManagementModule(db) {
  const actor = loadTsModule(path.join(root, "src", "server", "auth", "actor.ts"), {});
  const authorization = loadTsModule(path.join(root, "src", "server", "auth", "authorization.ts"), {
    "@/server/auth/actor": actor,
  });
  const auditLog = loadTsModule(path.join(root, "src", "server", "auth", "audit-log.ts"), {});
  return loadTsModule(path.join(root, "src", "server", "auth", "project-member-management.ts"), {
    "@/server/auth/actor": actor,
    "@/server/auth/authorization": authorization,
    "@/server/auth/audit-log": auditLog,
    "@/server/db/client": { prisma: db },
    "@/server/workbench/project-lifecycle-service": { assertActiveProjectForWrite: async () => undefined },
  });
}

function loadTsModule(sourcePath, imports) {
  const compiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  const requireShim = (specifier) => {
    if (imports[specifier]) return imports[specifier];
    throw new Error(`Unexpected import in project member management test: ${specifier}`);
  };
  new Function("require", "exports", "module", compiled.outputText)(requireShim, module.exports, module);
  return module.exports;
}
