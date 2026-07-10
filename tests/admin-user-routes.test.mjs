import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = process.cwd();

test("admin user routes list users only for password admins", async () => {
  const calls = [];
  const routes = createRoutes({
    sessionActor: null,
    calls,
  });

  const anonymous = await routes.list.GET(new Request("https://localhost/api/admin/users"));
  assert.equal(anonymous.status, 401);

  const teacherRoutes = createRoutes({ sessionActor: teacherActor(), calls });
  const teacher = await teacherRoutes.list.GET(new Request("https://localhost/api/admin/users"));
  assert.equal(teacher.status, 403);

  const adminRoutes = createRoutes({ sessionActor: adminActor(), calls });
  const admin = await adminRoutes.list.GET(new Request("https://localhost/api/admin/users?q=teacher"));
  assert.equal(admin.status, 200);
  assert.deepEqual(await admin.json(), {
    items: [
      {
        id: "teacher_1",
        email: "teacher@example.test",
        displayName: "王老师",
        role: "teacher",
        authMode: "password",
        status: "active",
        disabledAt: null,
        lastLoginAt: null,
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
    ],
  });
  assert.deepEqual(calls.at(-1), ["list", { query: "teacher" }]);
});

test("admin user action routes require csrf and never return raw passwords", async () => {
  const calls = [];
  const routes = createRoutes({ sessionActor: adminActor(), csrfValid: false, calls });

  const missingCsrf = await routes.detail.PATCH(jsonRequest("/api/admin/users/teacher_1", { disabled: true }), params("teacher_1"));
  assert.equal(missingCsrf.status, 403);

  const authorized = createRoutes({ sessionActor: adminActor(), csrfValid: true, calls });
  const disabled = await authorized.detail.PATCH(jsonRequest("/api/admin/users/teacher_1", { disabled: true, reason: "内测暂停" }), params("teacher_1"));
  assert.equal(disabled.status, 200);
  assert.equal((await disabled.json()).status, "disabled");
  assert.deepEqual(calls.at(-1), ["status", { userId: "teacher_1", disabled: true, reason: "内测暂停", actorUserId: "admin_1" }]);

  const reset = await authorized.reset.POST(
    jsonRequest("/api/admin/users/teacher_1/reset-password", { newPassword: "M69 route reset passphrase 2026!" }),
    params("teacher_1"),
  );
  assert.equal(reset.status, 200);
  const body = await reset.json();
  assert.deepEqual(body, { userId: "teacher_1", status: "password_reset" });
  assert.doesNotMatch(JSON.stringify(body), /M69 route reset|passwordHash|sessionToken|csrf/i);
});

test("admin invite route accepts a bounded role without returning the initial password", async () => {
  const calls = [];
  const routes = createRoutes({ sessionActor: adminActor(), csrfValid: true, calls });

  const response = await routes.invite.POST(
    jsonRequest("/api/admin/users/invite", {
      email: "new-admin@example.test",
      displayName: "新管理员",
      initialPassword: "M69 invite passphrase 2026!",
      role: "admin",
    }),
  );

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.deepEqual(body, { userId: "new_user_1", status: "created" });
  assert.equal(calls.at(-1)[0], "provision");
  assert.equal(calls.at(-1)[1].role, "admin");
  assert.doesNotMatch(JSON.stringify(body), /M69 invite|passwordHash|sessionToken|csrf/i);
});

function createRoutes({ sessionActor, csrfValid = true, calls }) {
  const session = {
    async resolveWorkbenchSession() {
      if (!sessionActor) return { actor: null, authMode: "password", isNewSession: false, reason: "missing_public_session" };
      return {
        actor: sessionActor,
        authMode: "password",
        isNewSession: false,
        publicSession: { id: "session_admin", userId: sessionActor.userId, expiresAt: new Date("2026-07-12T00:00:00.000Z") },
      };
    },
  };
  const csrf = {
    publicCsrfHeaderName: "x-shanhai-csrf",
    async validateCsrfToken() {
      return csrfValid;
    },
  };
  const authorization = {
    canManageUsers(actor) {
      return Boolean(actor?.isAdmin && actor.authMode === "password");
    },
  };
  const management = {
    __calls: calls,
    async listManagedUsers(input) {
      calls.push(["list", input]);
      return {
        items: [
          {
            id: "teacher_1",
            email: "teacher@example.test",
            displayName: "王老师",
            role: "teacher",
            authMode: "password",
            status: "active",
            disabledAt: null,
            lastLoginAt: null,
            createdAt: new Date("2026-07-10T00:00:00.000Z"),
            updatedAt: new Date("2026-07-10T00:00:00.000Z"),
          },
        ],
      };
    },
    async updateManagedUserStatus(input) {
      calls.push(["status", input]);
      return { id: input.userId, status: input.disabled ? "disabled" : "active" };
    },
    async updateManagedUserRole(input) {
      calls.push(["role", input]);
      return { id: input.userId, role: input.role, status: "active" };
    },
    async resetManagedUserPassword(input) {
      calls.push(["reset", input]);
      return { userId: input.userId, status: "password_reset" };
    },
    async revokeManagedUserSessions(input) {
      calls.push(["revoke", input]);
      return { userId: input.userId, status: "sessions_revoked" };
    },
  };
  const imports = routeImports({ session, csrf, authorization, management });
  return {
    list: loadRoute("src/app/api/admin/users/route.ts", imports),
    detail: loadRoute("src/app/api/admin/users/[userId]/route.ts", imports),
    invite: loadRoute("src/app/api/admin/users/invite/route.ts", imports),
    reset: loadRoute("src/app/api/admin/users/[userId]/reset-password/route.ts", imports),
    revoke: loadRoute("src/app/api/admin/users/[userId]/sessions/revoke/route.ts", imports),
  };
}

function routeImports({ session, csrf, authorization, management }) {
  return {
    "@/server/auth/session": session,
    "@/server/auth/csrf": csrf,
    "@/server/auth/authorization": authorization,
    "@/server/auth/admin-user-management": management,
    "@/server/auth/user-provisioning": {
      UserProvisioningError: class UserProvisioningError extends Error {
        constructor(message, status) {
          super(message);
          this.status = status;
        }
      },
      async provisionPasswordUser(input) {
        managementCalls(management).push(["provision", input]);
        return { userId: "new_user_1", status: "created" };
      },
    },
    "@/server/auth/rate-limit": {
      checkRateLimit() {
        return { allowed: true, retryAfterSeconds: 0 };
      },
    },
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

function managementCalls(management) {
  return management.__calls;
}

function adminActor() {
  return { userId: "admin_1", displayName: "管理员", role: "admin", authMode: "password", isAdmin: true, projectRoles: {} };
}

function teacherActor() {
  return { userId: "teacher_1", displayName: "王老师", role: "teacher", authMode: "password", isAdmin: false, projectRoles: {} };
}

function jsonRequest(pathname, body) {
  return new Request(`https://localhost${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-shanhai-csrf": "csrf_ok" },
    body: JSON.stringify(body),
  });
}

function params(userId) {
  return { params: Promise.resolve({ userId }) };
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
    throw new Error(`Unexpected import in admin user routes test: ${specifier}`);
  };
  new Function("require", "exports", "module", compiled.outputText)(requireShim, module.exports, module);
  return module.exports;
}
