import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const apiSourcePath = path.join(root, "src", "lib", "workbench-api.ts");
const actionsSourcePath = path.join(root, "src", "lib", "workbench-actions.ts");

const seedProjects = [
  {
    id: "project-a",
    title: "五年级百分数公开课",
    meta: "五年级数学",
    status: "active",
    currentStep: "需求澄清",
    updatedAt: "刚刚",
  },
  {
    id: "project-b",
    title: "二年级表内乘法",
    meta: "二年级数学",
    status: "review",
    currentStep: "教案确认",
    updatedAt: "昨天",
  },
];

const seedMessages = [
  {
    id: "m1",
    speaker: "assistant",
    title: "我们先确认公开课目标",
    body: "请告诉我年级、课题和需要的产物。",
  },
];

const seedArtifacts = [
  {
    key: "textbook-evidence",
    kind: "textbook_evidence",
    title: "教材",
    status: "approved",
    summary: "人教版五年级百分数单元。",
    updatedAt: "刚刚",
    reusable: true,
    sourceTitles: ["项目配置"],
    previewFields: [{ label: "教材版本", value: "人教版五年级上册" }],
    actions: {
      canCopy: true,
      canUseAsInput: true,
      canOpenDetail: true,
      canConfirm: false,
      canRegenerate: true,
    },
    content: {
      "证据摘要": "百分数用于表示两个量之间的关系。",
    },
  },
  {
    key: "intro-video-plan",
    kind: "intro_video_plan",
    title: "导入视频方案",
    status: "needs_review",
    summary: "用生活情境引出百分数。",
    updatedAt: "刚刚",
    reusable: true,
    sourceTitles: ["需求澄清"],
    previewFields: [{ label: "课程锚点", value: "百分数表示关系" }],
    actions: {
      canCopy: true,
      canUseAsInput: true,
      canOpenDetail: true,
      canConfirm: true,
      canRegenerate: true,
    },
    content: {
      "课程锚点": "百分数表示关系",
      "课堂问题": ["生活中哪里见过百分数？"],
    },
  },
];

const backendProject = {
  id: "backend-project-a",
  title: "五年级百分数公开课",
  status: "active",
  currentNodeKey: "requirement_spec",
  grade: "五年级",
  subject: "数学",
  textbookVersion: null,
  lessonTopic: "百分数",
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:01:00.000Z",
};

const backendNodes = [
  {
    id: "node-requirement",
    projectId: backendProject.id,
    key: "requirement_spec",
    title: "需求规格",
    status: "needs_review",
    order: 1,
    upstreamNodeKeys: [],
    approvedArtifactId: null,
    staleReason: null,
    updatedAt: "2026-07-07T00:01:00.000Z",
  },
  {
    id: "node-lesson",
    projectId: backendProject.id,
    key: "lesson_plan",
    title: "教案",
    status: "not_started",
    order: 2,
    upstreamNodeKeys: ["requirement_spec", "textbook_evidence"],
    approvedArtifactId: null,
    staleReason: null,
    updatedAt: "2026-07-07T00:01:00.000Z",
  },
];

const backendArtifact = {
  id: "artifact-requirement-v1",
  projectId: backendProject.id,
  nodeKey: "requirement_spec",
  title: "需求规格说明书",
  kind: "requirement_spec",
  status: "needs_review",
  summary: "围绕百分数公开课生成第一版需求规格。",
  markdownContent: "# 需求规格说明书\n\n## 课题\n百分数",
  structuredContent: { "课题": "百分数", "年级": "五年级" },
  version: 1,
  isApproved: false,
  createdAt: "2026-07-07T00:02:00.000Z",
  updatedAt: "2026-07-07T00:02:00.000Z",
};

const backendSnapshot = {
  project: backendProject,
  messages: [
    {
      id: "backend-message-1",
      projectId: backendProject.id,
      role: "teacher",
      content: "我想做一节百分数公开课。",
      artifactRefs: [],
      createdAt: "2026-07-07T00:03:00.000Z",
    },
  ],
  nodes: backendNodes,
  artifacts: [backendArtifact],
  agentRuns: [],
};

function loadWorkbenchApiModule() {
  const ts = require("typescript");
  const cache = new Map();
  const compileModule = (filename) => ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const requireStub = (id) => {
    if (id === "@/lib/mock-data") {
      return {
        projects: seedProjects,
        chatMessages: seedMessages,
        artifacts: seedArtifacts,
      };
    }
    if (id === "@/lib/workbench-mappers") {
      const mapperPath = path.join(root, "src", "lib", "workbench-mappers.ts");
      if (cache.has(mapperPath)) return cache.get(mapperPath).exports;
      const mapperModule = { exports: {} };
      cache.set(mapperPath, mapperModule);
      vm.runInNewContext(compileModule(mapperPath), {
        module: mapperModule,
        exports: mapperModule.exports,
        require: requireStub,
        URL,
        structuredClone,
        console,
      });
      return mapperModule.exports;
    }
    throw new Error(`Unexpected import in workbench-api test: ${id}`);
  };

  const module = { exports: {} };
  vm.runInNewContext(compileModule(apiSourcePath), {
    module,
    exports: module.exports,
    require: requireStub,
    URL,
    structuredClone,
    console,
  });

  return module.exports;
}

function loadWorkbenchActionsModule() {
  const ts = require("typescript");
  const compiled = ts.transpileModule(readFileSync(actionsSourcePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: () => {
      throw new Error("Unexpected import in workbench-actions test");
    },
    console,
  });

  return module.exports;
}

test("API client uses the shared workbench contract paths", async () => {
  const { createWorkbenchApiClient } = loadWorkbenchApiModule();
  const calls = [];
  const client = createWorkbenchApiClient({
    baseUrl: "https://example.test",
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => (String(url).endsWith("/projects") ? { projects: [backendProject] } : backendSnapshot),
      };
    },
  });

  await client.listProjects();
  await client.getProjectSnapshot("project-a");
  await client.sendMessage("project-a", "我想做百分数公开课", "导入视频方案：生活情境");
  await client.approveArtifact("project-a", "intro-video-plan");

  assert.equal(calls[0].url, "https://example.test/api/workbench/projects");
  assert.equal(calls[1].url, "https://example.test/api/workbench/projects/project-a/snapshot");
  assert.equal(calls[2].url, "https://example.test/api/workbench/projects/project-a/messages");
  assert.equal(calls[2].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[2].init.body), {
    role: "teacher",
    content: "我想做百分数公开课",
    artifactRefs: ["导入视频方案：生活情境"],
  });
  assert.equal(calls[3].url, "https://example.test/api/workbench/projects/project-a/snapshot");
  assert.equal(calls[4].url, "https://example.test/api/workbench/projects/project-a/artifacts/intro-video-plan/approve");
  assert.equal(calls[5].url, "https://example.test/api/workbench/projects/project-a/snapshot");
});

test("API client normalizes Backend Workflow Lite project lists and snapshots", async () => {
  const { createWorkbenchApiClient } = loadWorkbenchApiModule();
  const client = createWorkbenchApiClient({
    fetcher: async (url) => ({
      ok: true,
      json: async () => (String(url).endsWith("/projects") ? { projects: [backendProject] } : backendSnapshot),
    }),
  });

  const projects = await client.listProjects();
  assert.equal(projects[0].id, "backend-project-a");
  assert.equal(projects[0].currentStep, "需求规格");
  assert.equal(projects[0].meta, "五年级 数学");

  const snapshot = await client.getProjectSnapshot("backend-project-a");
  assert.equal(snapshot.project.id, "backend-project-a");
  assert.equal(snapshot.messages[0].speaker, "teacher");
  assert.equal(snapshot.messages[0].body, "我想做一节百分数公开课。");
  assert.equal(snapshot.artifacts.length, 2);

  const requirement = snapshot.artifacts.find((item) => item.nodeKey === "requirement_spec");
  assert.equal(requirement.key, "artifact-requirement-v1");
  assert.equal(requirement.title, "需求规格说明书");
  assert.equal(requirement.actions.canCopy, true);
  assert.equal(requirement.actions.canConfirm, true);
  assert.equal(requirement.content.Markdown, "# 需求规格说明书\n\n## 课题\n百分数");

  const lesson = snapshot.artifacts.find((item) => item.nodeKey === "lesson_plan");
  assert.equal(lesson.key, "node-lesson");
  assert.equal(lesson.summary, "还没有生成内容。");
  assert.equal(lesson.actions.canCopy, false);
  assert.equal(snapshot.activeArtifactKey, "artifact-requirement-v1");
});

test("API client does not expose backend-only structured labels in visible artifact fields", async () => {
  const { createWorkbenchApiClient } = loadWorkbenchApiModule();
  const snapshotWithBackendOnlyFields = {
    ...backendSnapshot,
    artifacts: [
      {
        ...backendArtifact,
        structuredContent: {
          "课题": "百分数",
          "课堂问题": ["生活中哪里见过百分数？"],
          schema: "internal-schema",
          node_id: "node-requirement",
          provider: "internal-provider",
          generationMode: "deterministic_draft",
          nextSuggestedAction: "查看并确认这份草稿",
        },
      },
    ],
  };
  const client = createWorkbenchApiClient({
    fetcher: async () => ({
      ok: true,
      json: async () => snapshotWithBackendOnlyFields,
    }),
  });

  const snapshot = await client.getProjectSnapshot("backend-project-a");
  const requirement = snapshot.artifacts.find((item) => item.nodeKey === "requirement_spec");
  const visibleLabels = [...requirement.previewFields.map((field) => field.label), ...Object.keys(requirement.content)].join("\n");

  assert.equal(visibleLabels.includes("schema"), false);
  assert.equal(visibleLabels.includes("node_id"), false);
  assert.equal(visibleLabels.includes("provider"), false);
  assert.equal(visibleLabels.includes("generationMode"), false);
  assert.equal(visibleLabels.includes("nextSuggestedAction"), false);
  assert.equal(requirement.content["课题"], "百分数");
  assert.deepEqual(requirement.content["课堂问题"], ["生活中哪里见过百分数？"]);
});

test("API client creates projects through backend shape and then reads a snapshot", async () => {
  const { createWorkbenchApiClient } = loadWorkbenchApiModule();
  const calls = [];
  const client = createWorkbenchApiClient({
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => (init?.method === "POST" ? { project: backendProject } : backendSnapshot),
      };
    },
  });

  const snapshot = await client.createProject();

  assert.equal(calls[0].url, "/api/workbench/projects");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[1].url, "/api/workbench/projects/backend-project-a/snapshot");
  assert.equal(snapshot.project.id, "backend-project-a");
});

test("API client approves by artifact id and refreshes the project snapshot", async () => {
  const { createWorkbenchApiClient } = loadWorkbenchApiModule();
  const calls = [];
  const client = createWorkbenchApiClient({
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () => (init?.method === "POST" ? { artifact: { ...backendArtifact, status: "approved", isApproved: true } } : backendSnapshot),
      };
    },
  });

  const snapshot = await client.approveArtifact("project-a", "artifact-requirement-v1");

  assert.equal(calls[0].url, "/api/workbench/projects/project-a/artifacts/artifact-requirement-v1/approve");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[1].url, "/api/workbench/projects/project-a/snapshot");
  assert.equal(snapshot.project.id, "backend-project-a");
  assert.equal(snapshot.activeArtifactKey, "artifact-requirement-v1");
});

test("API client keeps regenerate behind an explicit backend contract boundary", async () => {
  const { createWorkbenchApiClient, WorkbenchApiError } = loadWorkbenchApiModule();
  const calls = [];
  const client = createWorkbenchApiClient({
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      throw new Error("fetch should not be called for unfinished regenerate contract");
    },
  });

  await assert.rejects(() => client.regenerateArtifact("project-a", "artifact-requirement-v1"), (error) => {
    assert.ok(error instanceof WorkbenchApiError);
    assert.equal(error.status, 501);
    assert.equal(error.userMessage, "这个内容暂时还不能重做，请稍后再试。");
    return true;
  });
  assert.equal(calls.length, 0);
});

test("artifact action resolver blocks placeholders and prefers real artifact ids", () => {
  const { resolveArtifactActionKey } = loadWorkbenchActionsModule();
  const placeholder = {
    ...seedArtifacts[1],
    key: "node-lesson",
    artifactId: undefined,
    actions: { ...seedArtifacts[1].actions, canConfirm: false },
  };
  const backendArtifactItem = {
    ...seedArtifacts[1],
    key: "artifact-requirement-v1",
    artifactId: "artifact-requirement-v1",
    actions: { ...seedArtifacts[1].actions, canConfirm: true },
  };
  const developmentArtifactItem = {
    ...seedArtifacts[1],
    artifactId: undefined,
    actions: { ...seedArtifacts[1].actions, canConfirm: true },
  };

  assert.equal(resolveArtifactActionKey(placeholder, "confirm"), null);
  assert.equal(resolveArtifactActionKey(backendArtifactItem, "confirm"), "artifact-requirement-v1");
  assert.equal(resolveArtifactActionKey(developmentArtifactItem, "confirm"), "intro-video-plan");
});

test("API client normalizes failed responses to teacher-facing errors", async () => {
  const { createWorkbenchApiClient, WorkbenchApiError } = loadWorkbenchApiModule();
  const client = createWorkbenchApiClient({
    fetcher: async () => ({
      ok: false,
      status: 500,
      json: async () => ({ message: "provider stack trace" }),
    }),
  });

  await assert.rejects(
    () => client.getProjectSnapshot("project-a"),
    (error) => {
      assert.equal(error instanceof WorkbenchApiError, true);
      assert.equal(error.userMessage, "项目内容暂时没有取回，请稍后再试。");
      assert.equal(error.status, 500);
      return true;
    },
  );
});

test("development adapter updates snapshots without pretending to be production state", async () => {
  const { createDevelopmentWorkbenchAdapter } = loadWorkbenchApiModule();
  const adapter = createDevelopmentWorkbenchAdapter({
    seed: {
      projects: seedProjects,
      messages: seedMessages,
      artifacts: seedArtifacts,
    },
  });

  const projects = await adapter.listProjects();
  assert.deepEqual(projects.map((project) => project.id), ["project-a", "project-b"]);

  const before = await adapter.getProjectSnapshot("project-a");
  const afterSend = await adapter.sendMessage("project-a", "我想做百分数公开课", null);
  assert.equal(afterSend.messages.length, before.messages.length + 2);
  assert.equal(afterSend.messages.at(-2).speaker, "teacher");
  assert.equal(afterSend.messages.at(-1).speaker, "assistant");
  assert.equal(afterSend.artifacts[0].status, "needs_review");
  assert.equal(afterSend.activeArtifactKey, "intro-video-plan");

  const afterApprove = await adapter.approveArtifact("project-a", "intro-video-plan");
  assert.equal(afterApprove.artifacts.find((item) => item.key === "intro-video-plan").status, "approved");

  const afterRegenerate = await adapter.regenerateArtifact("project-a", "intro-video-plan");
  const regeneratedIntro = afterRegenerate.artifacts.find((item) => item.key === "intro-video-plan");
  assert.equal(regeneratedIntro.status, "needs_review");
  assert.match(regeneratedIntro.updatedAt, /刚刚/);
});
