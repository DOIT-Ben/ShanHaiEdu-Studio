import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const apiSourcePath = path.join(root, "src", "lib", "workbench-api.ts");

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

function loadWorkbenchApiModule() {
  const ts = require("typescript");
  const source = readFileSync(apiSourcePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const module = { exports: {} };
  const requireStub = (id) => {
    if (id === "@/lib/mock-data") {
      return {
        projects: seedProjects,
        chatMessages: seedMessages,
        artifacts: seedArtifacts,
      };
    }
    throw new Error(`Unexpected import in workbench-api test: ${id}`);
  };

  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: requireStub,
    URL,
    structuredClone,
    console,
  });

  return module.exports;
}

test("API client uses the shared workbench contract paths", async () => {
  const { createWorkbenchApiClient } = loadWorkbenchApiModule();
  const calls = [];
  const serverProject = {
    id: "project-a",
    title: "五年级百分数公开课",
    status: "active",
    currentNodeKey: "requirement_spec",
    grade: "五年级",
    subject: "数学",
    textbookVersion: "人教版",
    lessonTopic: "百分数",
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
  };
  const serverSnapshot = {
    project: serverProject,
    messages: [
      {
        id: "m1",
        projectId: "project-a",
        role: "teacher",
        content: "我想做百分数公开课",
        artifactRefs: [],
        createdAt: "2026-07-07T00:00:00.000Z",
      },
    ],
    nodes: [
      {
        id: "n1",
        projectId: "project-a",
        key: "requirement_spec",
        title: "需求规格",
        status: "needs_review",
        order: 1,
        upstreamNodeKeys: [],
        approvedArtifactId: null,
        staleReason: null,
        updatedAt: "2026-07-07T00:00:00.000Z",
      },
    ],
    artifacts: [
      {
        id: "a1",
        projectId: "project-a",
        nodeKey: "requirement_spec",
        title: "需求规格说明书",
        kind: "requirement_spec",
        status: "needs_review",
        summary: "已整理公开课目标。",
        markdownContent: "## 项目概述\n- 百分数公开课",
        structuredContent: { generationMode: "deterministic_draft", nextSuggestedAction: "查看并确认这份草稿" },
        version: 1,
        isApproved: false,
        createdAt: "2026-07-07T00:00:00.000Z",
        updatedAt: "2026-07-07T00:00:00.000Z",
      },
    ],
    agentRuns: [],
  };
  const client = createWorkbenchApiClient({
    baseUrl: "https://example.test",
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/projects") && (!init || init.method === "GET")) {
        return { ok: true, json: async () => ({ projects: [serverProject] }) };
      }
      if (String(url).endsWith("/projects") && init?.method === "POST") {
        return { ok: true, json: async () => ({ project: serverProject }) };
      }
      return {
        ok: true,
        json: async () => serverSnapshot,
      };
    },
  });

  const projects = await client.listProjects();
  const snapshot = await client.getProjectSnapshot("project-a");
  const afterCreate = await client.createProject();
  await client.sendMessage("project-a", "我想做百分数公开课", "导入视频方案：生活情境");
  await client.approveArtifact("project-a", "intro-video-plan");
  await client.regenerateArtifact("project-a", "intro-video-plan");

  assert.equal(projects[0].currentStep, "需求规格");
  assert.equal(snapshot.messages[0].speaker, "teacher");
  assert.equal(snapshot.artifacts[0].key, "requirement_spec");
  assert.equal(snapshot.artifacts[0].actions.canConfirm, true);
  assert.equal(snapshot.artifacts[0].content["内容摘要"], "## 项目概述\n- 百分数公开课");
  assert.equal("generationMode" in snapshot.artifacts[0].content, false);
  assert.equal(snapshot.activeArtifactKey, "requirement_spec");
  assert.equal(afterCreate.project.id, "project-a");
  assert.equal(calls[0].url, "https://example.test/api/workbench/projects");
  assert.equal(calls[1].url, "https://example.test/api/workbench/projects/project-a/snapshot");
  assert.equal(calls[2].url, "https://example.test/api/workbench/projects");
  assert.equal(calls[3].url, "https://example.test/api/workbench/projects/project-a/snapshot");
  assert.equal(calls[4].url, "https://example.test/api/workbench/projects/project-a/messages");
  assert.equal(calls[4].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[4].init.body), {
    body: "我想做百分数公开课",
    reference: "导入视频方案：生活情境",
  });
  assert.equal(calls[5].url, "https://example.test/api/workbench/projects/project-a/snapshot");
  assert.equal(calls[6].url, "https://example.test/api/workbench/projects/project-a/artifacts/intro-video-plan/approve");
  assert.equal(calls[7].url, "https://example.test/api/workbench/projects/project-a/snapshot");
  assert.equal(calls[8].url, "https://example.test/api/workbench/projects/project-a/artifacts/intro-video-plan/regenerate");
  assert.equal(calls[9].url, "https://example.test/api/workbench/projects/project-a/snapshot");
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
