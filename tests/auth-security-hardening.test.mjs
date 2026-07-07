import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);

test("workbench auth wrapper rejects cross-site write requests and allows same-origin writes", async () => {
  const route = loadAuthRouteModule();

  const blocked = await route.withLocalWorkbenchActor(
    new Request("http://localhost/api/workbench/projects", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    }),
    async () => new Response("created", { status: 201 }),
  );
  assert.equal(blocked.status, 403);
  assert.equal(await blocked.text(), '{"error":"请求暂时不能处理，请刷新页面后重试。"}');

  const allowed = await route.withLocalWorkbenchActor(
    new Request("http://localhost/api/workbench/projects", {
      method: "POST",
      headers: { origin: "http://localhost" },
    }),
    async () => new Response("created", { status: 201 }),
  );
  assert.equal(allowed.status, 201);
});

test("workbench auth wrapper treats loopback host aliases as same-origin", async () => {
  const route = loadAuthRouteModule();
  const response = await route.withLocalWorkbenchActor(
    new Request("http://localhost:3117/api/workbench/projects", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3117" },
    }),
    async () => new Response("created", { status: 201 }),
  );

  assert.equal(response.status, 201);
});

test("workbench auth wrapper keeps GET requests readable across origins", async () => {
  const route = loadAuthRouteModule();
  const response = await route.withLocalWorkbenchActor(
    new Request("http://localhost/api/workbench/projects", {
      method: "GET",
      headers: { origin: "https://evil.example" },
    }),
    async () => new Response("ok", { status: 200 }),
  );

  assert.equal(response.status, 200);
});

test("local session cookie is Secure for https requests and forwarded https", () => {
  const session = loadLocalSessionModule();
  const resolved = session.resolveLocalWorkbenchActor(new Request("https://localhost/api/workbench/projects"), {
    generateUserId: () => "local-user-secure",
  });

  const httpsHeader = session.createLocalSessionSetCookieHeader(
    resolved,
    new Request("https://localhost/api/workbench/projects"),
  );
  assert.match(httpsHeader, /HttpOnly/);
  assert.match(httpsHeader, /SameSite=Lax/);
  assert.match(httpsHeader, /Secure/);

  const forwardedHeader = session.createLocalSessionSetCookieHeader(
    resolved,
    new Request("http://localhost/api/workbench/projects", {
      headers: { "x-forwarded-proto": "https" },
    }),
  );
  assert.match(forwardedHeader, /Secure/);

  const httpHeader = session.createLocalSessionSetCookieHeader(
    resolved,
    new Request("http://localhost/api/workbench/projects"),
  );
  assert.doesNotMatch(httpHeader, /Secure/);
});

test("next config defines baseline security headers", async () => {
  const config = loadTsModule(path.join(root, "next.config.ts"), {});
  const headers = await config.default.headers();
  const flattened = headers.flatMap((entry) => entry.headers);
  const byKey = Object.fromEntries(flattened.map((header) => [header.key, header.value]));

  assert.equal(byKey["X-Frame-Options"], "SAMEORIGIN");
  assert.equal(byKey["X-Content-Type-Options"], "nosniff");
  assert.equal(byKey["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.match(byKey["Permissions-Policy"], /camera=\(\)/);
});

function loadAuthRouteModule() {
  return loadTsModule(path.join(root, "src", "server", "auth", "workbench-route.ts"), {
    "@/server/auth/local-session": loadLocalSessionModule(),
    "@/server/auth/session": loadSessionModule(),
    "@/server/workbench/service": {
      createWorkbenchService: () => ({}),
    },
    "next/server": {
      NextResponse: {
        json(body, init = {}) {
          return new Response(JSON.stringify(body), {
            status: init.status ?? 200,
            headers: { "content-type": "application/json" },
          });
        },
      },
    },
  });
}

function loadLocalSessionModule() {
  return loadTsModule(path.join(root, "src", "server", "auth", "local-session.ts"), {
    "node:crypto": require("node:crypto"),
  });
}

function loadActorModule() {
  return loadTsModule(path.join(root, "src", "server", "auth", "actor.ts"), {});
}

function loadSessionModule() {
  return loadTsModule(path.join(root, "src", "server", "auth", "session.ts"), {
    "@/server/auth/local-session": loadLocalSessionModule(),
    "@/server/auth/actor": loadActorModule(),
    "node:crypto": require("node:crypto"),
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
    throw new Error(`Unexpected import in auth security test: ${specifier}`);
  };
  new Function("require", "exports", "module", compiled.outputText)(requireShim, module.exports, module);
  return module.exports;
}
