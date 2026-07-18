import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = process.cwd();

test("project member routes require login and let project actors read members", async () => {
  const calls = [];
  const anonymousRoutes = createRoutes({ actor: null, calls });
  const anonymous = await anonymousRoutes.collection.GET(new Request("https://localhost/api/workbench/projects/project_1/members"), projectParams());
  assert.equal(anonymous.status, 401);

  const ownerRoutes = createRoutes({ actor: ownerActor(), calls });
  const response = await ownerRoutes.collection.GET(new Request("https://localhost/api/workbench/projects/project_1/members"), projectParams());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [{ userId: "owner_1", email: "owner@example.test", displayName: "项目拥有者", role: "owner" }] });
  assert.deepEqual(calls.at(-1), ["list", { projectId: "project_1", actor: ownerActor() }]);
});

test("project member mutation routes require csrf and call member management service", async () => {
  const calls = [];
  const blocked = createRoutes({ actor: ownerActor(), csrfValid: false, calls });
  const missingCsrf = await blocked.collection.POST(jsonRequest("POST", "/api/workbench/projects/project_1/members", { email: "viewer@example.test", role: "viewer" }), projectParams());
  assert.equal(missingCsrf.status, 403);
  assert.deepEqual(calls.at(-1), ["boundary", "POST"]);

  const routes = createRoutes({ actor: ownerActor(), csrfValid: true, calls });
  const added = await routes.collection.POST(jsonRequest("POST", "/api/workbench/projects/project_1/members", { email: "viewer@example.test", role: "viewer" }), projectParams());
  assert.equal(added.status, 201);
  assert.equal((await added.json()).role, "viewer");
  assert.deepEqual(calls.at(-1), ["add", { projectId: "project_1", email: "viewer@example.test", role: "viewer", actor: ownerActor() }]);

  const patched = await routes.member.PATCH(jsonRequest("PATCH", "/api/workbench/projects/project_1/members/viewer_1", { role: "editor" }), memberParams("viewer_1"));
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).role, "editor");

  const removed = await routes.member.DELETE(new Request("https://localhost/api/workbench/projects/project_1/members/viewer_1", { method: "DELETE", headers: { "x-shanhai-csrf": "ok" } }), memberParams("viewer_1"));
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { userId: "viewer_1", status: "removed" });
  assert.equal(calls.filter(([kind]) => kind === "boundary").length, 4);
  assert.deepEqual(calls.filter(([kind]) => kind === "boundary").map(([, method]) => method), ["POST", "POST", "PATCH", "DELETE"]);
});

function createRoutes({ actor, csrfValid = true, calls }) {
  const workbenchRoute = {
    async withLocalWorkbenchActor(request, handler) {
      calls.push(["boundary", request.method]);
      if (!actor) return Response.json({ error: "请先登录。" }, { status: 401 });
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && !csrfValid) {
        return Response.json({ error: "请求校验失败。" }, { status: 403 });
      }
      return handler({
        actor,
        executionIdentity: { actorUserId: actor.userId, actorAuthMode: actor.authMode, authSessionId: "session_owner" },
        service: {},
      });
    },
  };
  const management = {
    ProjectMemberManagementError: class ProjectMemberManagementError extends Error {
      constructor(message, status) {
        super(message);
        this.status = status;
      }
    },
    async listProjectMembers(input) {
      calls.push(["list", input]);
      return { items: [{ userId: "owner_1", email: "owner@example.test", displayName: "项目拥有者", role: "owner" }] };
    },
    async addProjectMember(input) {
      calls.push(["add", input]);
      return { userId: "viewer_1", email: input.email, displayName: "观摩教师", role: input.role };
    },
    async updateProjectMemberRole(input) {
      calls.push(["update", input]);
      return { userId: input.userId, email: "viewer@example.test", displayName: "观摩教师", role: input.role };
    },
    async removeProjectMember(input) {
      calls.push(["remove", input]);
      return { userId: input.userId, status: "removed" };
    },
  };
  const imports = routeImports({ workbenchRoute, management });
  return {
    collection: loadRoute("src/app/api/workbench/projects/[projectId]/members/route.ts", imports),
    member: loadRoute("src/app/api/workbench/projects/[projectId]/members/[userId]/route.ts", imports),
  };
}

function routeImports({ workbenchRoute, management }) {
  return {
    "@/server/auth/workbench-route": workbenchRoute,
    "@/server/auth/project-member-management": management,
    "next/server": {
      NextResponse: {
        json(body, init = {}) {
          const headers = new Headers(init.headers);
          headers.set("content-type", "application/json");
          return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
        },
      },
    },
  };
}

function ownerActor() {
  return { userId: "owner_1", displayName: "项目拥有者", role: "teacher", authMode: "password", isAdmin: false, projectRoles: { project_1: "owner" } };
}

function jsonRequest(method, pathname, body) {
  return new Request(`https://localhost${pathname}`, {
    method,
    headers: { "content-type": "application/json", "x-shanhai-csrf": "ok" },
    body: JSON.stringify(body),
  });
}

function projectParams() {
  return { params: Promise.resolve({ projectId: "project_1" }) };
}

function memberParams(userId) {
  return { params: Promise.resolve({ projectId: "project_1", userId }) };
}

function loadRoute(sourcePath, imports) {
  return loadTsModule(path.join(root, sourcePath), imports);
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
    throw new Error(`Unexpected import in project member routes test: ${specifier}`);
  };
  new Function("require", "exports", "module", compiled.outputText)(requireShim, module.exports, module);
  return module.exports;
}
