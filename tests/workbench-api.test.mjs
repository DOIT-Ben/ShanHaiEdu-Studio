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
const realAssetActionsSourcePath = path.join(root, "src", "lib", "artifact-real-assets.ts");

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

function loadWorkbenchApiModule(options = {}) {
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
    if (id === "@/lib/csrf-token") {
      return {
        getWorkbenchCsrfToken: () => null,
        setWorkbenchCsrfToken: () => {},
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
        process: { env: options.env ?? {} },
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
    process: { env: options.env ?? {} },
    fetch: options.fetch,
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

function loadRealAssetActionsModule() {
  const ts = require("typescript");
  const compiled = ts.transpileModule(readFileSync(realAssetActionsSourcePath, "utf8"), {
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
      throw new Error("Unexpected import in artifact-real-assets test");
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
    reference: "导入视频方案：生活情境",
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

test("API client regenerates artifacts through the backend route and refreshes the project snapshot", async () => {
  const { createWorkbenchApiClient } = loadWorkbenchApiModule();
  const calls = [];
  const client = createWorkbenchApiClient({
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () =>
          init?.method === "POST"
            ? { artifact: { ...backendArtifact, status: "needs_review", isApproved: false, version: 2 } }
            : backendSnapshot,
      };
    },
  });

  const snapshot = await client.regenerateArtifact("project-a", "artifact-requirement-v1");

  assert.equal(calls[0].url, "/api/workbench/projects/project-a/artifacts/artifact-requirement-v1/regenerate");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(JSON.parse(calls[0].init.body).summary, "请重新生成这一版内容。");
  assert.equal(calls[1].url, "/api/workbench/projects/project-a/snapshot");
  assert.equal(snapshot.project.id, "backend-project-a");
});

test("API client triggers real asset generation through backend routes and refreshes the snapshot", async () => {
  const { createWorkbenchApiClient } = loadWorkbenchApiModule();
  const calls = [];
  const client = createWorkbenchApiClient({
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        json: async () =>
          init?.method === "POST"
            ? { artifact: { ...backendArtifact, status: "needs_review", isApproved: false, version: 2 } }
            : backendSnapshot,
      };
    },
  });

  await client.generateRealAsset("project-a", "artifact-ppt-v1", "pptx");
  await client.generateRealAsset("project-a", "artifact-ppt-v1", "image");
  await client.generateRealAsset("project-a", "artifact-video-plan-v1", "video");

  assert.equal(calls[0].url, "/api/workbench/projects/project-a/artifacts/artifact-ppt-v1/coze-ppt");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[1].url, "/api/workbench/projects/project-a/snapshot");
  assert.equal(calls[2].url, "/api/workbench/projects/project-a/artifacts/artifact-ppt-v1/image");
  assert.equal(calls[2].init.method, "POST");
  assert.equal(calls[3].url, "/api/workbench/projects/project-a/snapshot");
  assert.equal(calls[4].url, "/api/workbench/projects/project-a/artifacts/artifact-video-plan-v1/video");
  assert.equal(calls[4].init.method, "POST");
  assert.equal(calls[5].url, "/api/workbench/projects/project-a/snapshot");
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

test("real asset generation actions are teacher-facing and scoped to supported artifacts", () => {
  const { getRealAssetGenerationActions } = loadRealAssetActionsModule();
  const pptArtifact = {
    ...seedArtifacts[1],
    key: "artifact-ppt-v1",
    artifactId: "artifact-ppt-v1",
    nodeKey: "ppt_draft",
    kind: "ppt_draft",
    title: "PPT 大纲与逐页脚本",
  };
  const videoArtifact = {
    ...seedArtifacts[1],
    key: "artifact-video-plan-v1",
    artifactId: "artifact-video-plan-v1",
    nodeKey: "intro_video_plan",
    kind: "intro_video_plan",
    title: "导入视频方案",
  };
  const finalDeliveryArtifact = {
    ...seedArtifacts[1],
    key: "artifact-final-v1",
    artifactId: "artifact-final-v1",
    nodeKey: "final_delivery",
    kind: "final_delivery",
    title: "最终交付清单",
  };

  const pptActions = getRealAssetGenerationActions(pptArtifact);
  assert.equal(pptActions.map((action) => action.kind).join(","), "pptx,image");
  assert.equal(pptActions.map((action) => action.label).join(","), "生成真实 PPTX,生成课堂视觉图");
  assert.match(pptActions[0].successNotice, /真实 PPTX/);
  assert.match(pptActions[1].successNotice, /课堂视觉图/);

  const videoActions = getRealAssetGenerationActions(videoArtifact);
  assert.equal(videoActions.map((action) => action.kind).join(","), "video");
  assert.equal(videoActions.map((action) => action.label).join(","), "生成导入视频");

  assert.equal(getRealAssetGenerationActions(finalDeliveryArtifact).length, 0);
  const visibleText = [...pptActions, ...videoActions].flatMap((action) => [action.label, action.pendingLabel, action.successNotice, action.failureNotice]).join("\n");
  assert.equal(/schema|manifest|provider|node_id|storage|API|debug|local path/i.test(visibleText), false);
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

  const afterGenerate = await adapter.generateRealAsset("project-a", "intro-video-plan", "video");
  const generatedIntro = afterGenerate.artifacts.find((item) => item.key === "intro-video-plan");
  assert.equal(generatedIntro.status, "needs_review");
  assert.match(generatedIntro.summary, /真实素材/);
});

test("default workbench data source uses the real API client unless mock is explicit", async () => {
  const calls = [];
  const { createDefaultWorkbenchDataSource } = loadWorkbenchApiModule({
    fetch: async (url) => {
      calls.push(String(url));
      return {
        ok: true,
        json: async () => ({ projects: [backendProject] }),
      };
    },
  });

  const dataSource = createDefaultWorkbenchDataSource();
  const projects = await dataSource.listProjects();

  assert.deepEqual(calls, ["/api/workbench/projects"]);
  assert.equal(projects[0].id, "backend-project-a");
});

test("mock workbench data source is available only through an explicit local switch", async () => {
  const calls = [];
  const { createDefaultWorkbenchDataSource } = loadWorkbenchApiModule({
    env: { NEXT_PUBLIC_WORKBENCH_DATA_SOURCE: "mock" },
    fetch: async (url) => {
      calls.push(String(url));
      throw new Error("mock data source should not call fetch");
    },
  });

  const dataSource = createDefaultWorkbenchDataSource();
  const projects = await dataSource.listProjects();

  assert.deepEqual(calls, []);
  assert.deepEqual(projects.map((project) => project.id), ["project-a", "project-b"]);
});
