import { artifacts as seedArtifacts, chatMessages as seedMessages, projects as seedProjects } from "@/lib/mock-data";
import type { ArtifactItem, ArtifactKind, ArtifactStatus, ChatMessage, ProjectItem, ProjectStatus, WorkbenchDataSource, WorkbenchSnapshot } from "@/lib/types";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type WorkbenchApiClientOptions = {
  baseUrl?: string;
  fetcher?: Fetcher;
};

type DevelopmentAdapterOptions = {
  seed?: {
    projects: ProjectItem[];
    messages: ChatMessage[];
    artifacts: ArtifactItem[];
  };
};

type BackendProjectRecord = {
  id: string;
  title: string;
  status: ProjectStatus;
  currentNodeKey: ArtifactKind;
  grade: string | null;
  subject: string | null;
  textbookVersion: string | null;
  lessonTopic: string | null;
  createdAt: string;
  updatedAt: string;
};

type BackendMessageRecord = {
  id: string;
  projectId: string;
  role: "teacher" | "assistant" | "system";
  content: string;
  artifactRefs: string[];
  createdAt: string;
};

type BackendNodeRecord = {
  id: string;
  projectId: string;
  key: ArtifactKind;
  title: string;
  status: ArtifactStatus | "failed";
  order: number;
  upstreamNodeKeys: ArtifactKind[];
  approvedArtifactId: string | null;
  staleReason: string | null;
  updatedAt: string;
};

type BackendArtifactRecord = {
  id: string;
  projectId: string;
  nodeKey: ArtifactKind;
  title: string;
  kind: ArtifactKind;
  status: ArtifactStatus | "failed";
  summary: string;
  markdownContent: string;
  structuredContent: Record<string, unknown>;
  version: number;
  isApproved: boolean;
  createdAt: string;
  updatedAt: string;
};

type BackendSnapshot = {
  project: BackendProjectRecord;
  messages: BackendMessageRecord[];
  nodes: BackendNodeRecord[];
  artifacts: BackendArtifactRecord[];
  agentRuns?: unknown[];
};

const teacherFacingLoadError = "项目内容暂时没有取回，请稍后再试。";

const nodeTitleByKey: Record<ArtifactKind, string> = {
  requirement_spec: "需求规格",
  textbook_evidence: "教材",
  lesson_plan: "教案",
  intro_video_plan: "导入",
  ppt_draft: "PPT",
  image_prompts: "图片",
  video_storyboard: "视频",
  final_delivery: "交付",
};

export class WorkbenchApiError extends Error {
  readonly status?: number;
  readonly userMessage: string;

  constructor(message: string, userMessage = teacherFacingLoadError, status?: number) {
    super(message);
    this.name = "WorkbenchApiError";
    this.status = status;
    this.userMessage = userMessage;
  }
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function endpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = `Workbench request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) detail = body.message;
    } catch {
      // Keep the stable teacher-facing error if the response body is not JSON.
    }
    throw new WorkbenchApiError(detail, teacherFacingLoadError, response.status);
  }
  return (await response.json()) as T;
}

function isBackendProjectList(value: unknown): value is { projects: BackendProjectRecord[] } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { projects?: unknown }).projects));
}

function isBackendSnapshot(value: unknown): value is BackendSnapshot {
  const snapshot = value as Partial<BackendSnapshot>;
  return Boolean(snapshot?.project && Array.isArray(snapshot.messages) && Array.isArray(snapshot.nodes) && Array.isArray(snapshot.artifacts));
}

function mapStatus(status: ArtifactStatus | "failed"): ArtifactStatus {
  return status === "failed" ? "blocked" : status;
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function mapBackendProject(project: BackendProjectRecord): ProjectItem {
  const meta = [project.grade, project.subject].filter(Boolean).join(" ") || project.lessonTopic || formatDateLabel(project.updatedAt);
  return {
    id: project.id,
    title: project.title,
    meta,
    status: project.status,
    currentStep: nodeTitleByKey[project.currentNodeKey] ?? "需求澄清",
    updatedAt: formatDateLabel(project.updatedAt),
  };
}

function mapBackendMessage(message: BackendMessageRecord): ChatMessage {
  return {
    id: message.id,
    speaker: message.role === "assistant" ? "assistant" : "teacher",
    body: message.content,
  };
}

function contentFromArtifact(artifact: BackendArtifactRecord): Record<string, string | string[]> {
  const content: Record<string, string | string[]> = {};
  if (artifact.markdownContent) content.Markdown = artifact.markdownContent;
  for (const [key, value] of Object.entries(artifact.structuredContent ?? {})) {
    if (Array.isArray(value)) {
      content[key] = value.map(String);
    } else if (value !== null && value !== undefined) {
      content[key] = String(value);
    }
  }
  if (!Object.keys(content).length) content.说明 = artifact.summary || "还没有可复用内容。";
  return content;
}

function previewFieldsFromContent(artifact: BackendArtifactRecord): { label: string; value: string }[] {
  const fields = Object.entries(artifact.structuredContent ?? {})
    .slice(0, 3)
    .map(([label, value]) => ({ label, value: Array.isArray(value) ? value.map(String).join("、") : String(value) }));
  return fields.length ? fields : [{ label: "状态", value: artifact.summary || "已生成内容" }];
}

function mapBackendNodeToArtifactItem(node: BackendNodeRecord, artifact?: BackendArtifactRecord): ArtifactItem {
  if (!artifact) {
    const title = nodeTitleByKey[node.key] ?? node.title;
    return {
      key: node.id,
      nodeKey: node.key,
      kind: node.key,
      title,
      status: mapStatus(node.status),
      summary: "还没有生成内容。",
      updatedAt: formatDateLabel(node.updatedAt),
      reusable: false,
      sourceTitles: node.upstreamNodeKeys.map((key) => nodeTitleByKey[key] ?? key),
      previewFields: [{ label: "状态", value: "还没有生成内容" }],
      actions: { canCopy: false, canUseAsInput: false, canOpenDetail: true, canConfirm: false, canRegenerate: false },
      content: { 说明: "还没有生成内容。" },
    };
  }

  return {
    key: artifact.id,
    artifactId: artifact.id,
    nodeKey: node.key,
    version: artifact.version,
    kind: artifact.kind,
    title: artifact.title || nodeTitleByKey[node.key] || node.title,
    status: mapStatus(artifact.status),
    summary: artifact.summary || "已生成内容。",
    updatedAt: formatDateLabel(artifact.updatedAt),
    reusable: artifact.isApproved || artifact.status === "approved" || artifact.status === "needs_review",
    sourceTitles: node.upstreamNodeKeys.map((key) => nodeTitleByKey[key] ?? key),
    previewFields: previewFieldsFromContent(artifact),
    actions: {
      canCopy: true,
      canUseAsInput: true,
      canOpenDetail: true,
      canConfirm: artifact.status === "needs_review",
      canRegenerate: true,
    },
    content: contentFromArtifact(artifact),
  };
}

function normalizeProjects(value: unknown): ProjectItem[] {
  if (isBackendProjectList(value)) return value.projects.map(mapBackendProject);
  return value as ProjectItem[];
}

function normalizeSnapshot(value: unknown): WorkbenchSnapshot {
  if (!isBackendSnapshot(value)) return value as WorkbenchSnapshot;
  const artifactsByNode = new Map<string, BackendArtifactRecord>();
  for (const artifact of value.artifacts) {
    const current = artifactsByNode.get(artifact.nodeKey);
    if (!current || artifact.version >= current.version) artifactsByNode.set(artifact.nodeKey, artifact);
  }
  const artifacts = value.nodes
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((node) => mapBackendNodeToArtifactItem(node, artifactsByNode.get(node.key)));
  const activeArtifact =
    artifacts.find((item) => item.nodeKey === value.project.currentNodeKey && item.artifactId) ??
    artifacts.find((item) => item.status === "needs_review") ??
    artifacts[0];

  return {
    project: mapBackendProject(value.project),
    messages: value.messages.filter((message) => message.role !== "system").map(mapBackendMessage),
    artifacts,
    activeArtifactKey: activeArtifact?.key ?? "",
  };
}

export function createWorkbenchApiClient(options: WorkbenchApiClientOptions = {}): WorkbenchDataSource {
  const baseUrl = options.baseUrl ?? "";
  const fetcher = options.fetcher ?? fetch;

  function request<T>(path: string, init?: RequestInit) {
    return fetcher(endpoint(baseUrl, path), {
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    }).then((response) => parseResponse<T>(response));
  }

  return {
    listProjects() {
      return request<unknown>("/api/workbench/projects").then(normalizeProjects);
    },
    createProject() {
      return request<unknown>("/api/workbench/projects", { method: "POST" }).then((value) => {
        const project = (value as { project?: BackendProjectRecord }).project;
        if (!project?.id) return normalizeSnapshot(value);
        return request<unknown>(`/api/workbench/projects/${project.id}/snapshot`).then(normalizeSnapshot);
      });
    },
    getProjectSnapshot(projectId) {
      return request<unknown>(`/api/workbench/projects/${projectId}/snapshot`).then(normalizeSnapshot);
    },
    sendMessage(projectId, body, reference) {
      return request<unknown>(`/api/workbench/projects/${projectId}/messages`, {
        method: "POST",
        body: JSON.stringify({ role: "teacher", content: body, artifactRefs: reference ? [reference] : [] }),
      }).then(() => request<unknown>(`/api/workbench/projects/${projectId}/snapshot`).then(normalizeSnapshot));
    },
    approveArtifact(projectId, artifactKey) {
      return request<unknown>(`/api/workbench/projects/${projectId}/artifacts/${artifactKey}/approve`, { method: "POST" }).then(normalizeSnapshot);
    },
    regenerateArtifact(projectId, artifactKey) {
      return request<unknown>(`/api/workbench/projects/${projectId}/artifacts/${artifactKey}/regenerate`, { method: "POST" }).then(normalizeSnapshot);
    },
  };
}

export function artifactText(item: ArtifactItem) {
  const fields = item.previewFields.map((field) => `${field.label}：${field.value}`).join("；");
  return `${item.title}｜${item.summary}｜${fields}`;
}

function preferredActiveArtifactKey(artifacts: ArtifactItem[], fallbackKey?: string) {
  return artifacts.find((item) => item.key === "intro-video-plan")?.key ?? artifacts.find((item) => item.status === "needs_review")?.key ?? fallbackKey ?? artifacts[0]?.key ?? "";
}

export function createDevelopmentWorkbenchAdapter(options: DevelopmentAdapterOptions = {}): WorkbenchDataSource {
  const source = options.seed ?? {
    projects: seedProjects,
    messages: seedMessages,
    artifacts: seedArtifacts,
  };
  const projects = clone(source.projects);
  const snapshots = new Map<string, Omit<WorkbenchSnapshot, "project">>();

  function ensureSnapshot(projectId: string) {
    if (!snapshots.has(projectId)) {
      snapshots.set(projectId, {
        messages: clone(source.messages),
        artifacts: clone(source.artifacts),
        activeArtifactKey: preferredActiveArtifactKey(source.artifacts),
      });
    }
    return snapshots.get(projectId);
  }

  function projectById(projectId: string) {
    const project = projects.find((entry) => entry.id === projectId);
    if (!project) throw new WorkbenchApiError("Project was not found.", "没有找到这个项目，请重新选择。", 404);
    return project;
  }

  function snapshot(projectId: string): WorkbenchSnapshot {
    const project = projectById(projectId);
    const current = ensureSnapshot(projectId);
    if (!current) throw new WorkbenchApiError("Snapshot was not created.");
    return clone({ project, ...current });
  }

  function touchProject(projectId: string, currentStep: string) {
    const project = projectById(projectId);
    project.updatedAt = "刚刚";
    project.meta = "刚刚";
    project.currentStep = currentStep;
    project.status = "active";
  }

  return {
    async listProjects() {
      return clone(projects);
    },
    async createProject() {
      const project: ProjectItem = {
        id: `dev-project-${Date.now()}`,
        title: "新的公开课项目",
        meta: "刚刚",
        status: "active",
        currentStep: "需求澄清",
        updatedAt: "刚刚",
      };
      projects.unshift(project);
      snapshots.set(project.id, {
        messages: [
          {
            id: `${project.id}-welcome`,
            speaker: "assistant",
            title: "我们先确认公开课目标",
            body: "请直接描述年级、课题、教材版本和希望生成的材料，我会整理成可确认的备课链路。",
          },
        ],
        artifacts: clone(source.artifacts).map((item) => ({ ...item, status: item.key === "textbook-evidence" ? "needs_review" : "not_started" })),
        activeArtifactKey: source.artifacts[0]?.key ?? "",
      });
      return snapshot(project.id);
    },
    async getProjectSnapshot(projectId) {
      return snapshot(projectId);
    },
    async sendMessage(projectId, body, reference) {
      const current = ensureSnapshot(projectId);
      if (!current) throw new WorkbenchApiError("Snapshot was not created.");
      const timestamp = Date.now();
      current.messages.push({
        id: `${projectId}-teacher-${timestamp}`,
        speaker: "teacher",
        body: reference ? `${body}\n\n引用：${reference}` : body,
      });
      current.messages.push({
        id: `${projectId}-assistant-${timestamp}`,
        speaker: "assistant",
        title: "已收到，我会把它整理进当前备课链路。",
        body: "下一步会同步更新右侧产物节点。请先确认生成内容是否适合作为后续输入。",
        tone: "focus",
      });
      current.artifacts = current.artifacts.map((item, index) =>
        index === 0 || item.key === "intro-video-plan" ? { ...item, status: "needs_review", updatedAt: "刚刚" } : item,
      );
      current.activeArtifactKey = preferredActiveArtifactKey(current.artifacts, current.activeArtifactKey);
      touchProject(projectId, "等待确认");
      return snapshot(projectId);
    },
    async approveArtifact(projectId, artifactKey) {
      const current = ensureSnapshot(projectId);
      if (!current) throw new WorkbenchApiError("Snapshot was not created.");
      current.artifacts = current.artifacts.map((item) =>
        item.key === artifactKey ? { ...item, status: "approved", updatedAt: "刚刚" } : item,
      );
      current.activeArtifactKey = artifactKey;
      touchProject(projectId, "已确认");
      return snapshot(projectId);
    },
    async regenerateArtifact(projectId, artifactKey) {
      const current = ensureSnapshot(projectId);
      if (!current) throw new WorkbenchApiError("Snapshot was not created.");
      current.artifacts = current.artifacts.map((item) =>
        item.key === artifactKey
          ? {
              ...item,
              status: "needs_review",
              updatedAt: "刚刚",
              summary: `${item.summary} 已保留旧版，新的版本完成后再确认采用。`,
            }
          : item,
      );
      current.activeArtifactKey = artifactKey;
      touchProject(projectId, "等待确认");
      return snapshot(projectId);
    },
  };
}

export function createDefaultWorkbenchDataSource(): WorkbenchDataSource {
  if (process.env.NEXT_PUBLIC_WORKBENCH_DATA_SOURCE === "api") {
    return createWorkbenchApiClient();
  }
  return createDevelopmentWorkbenchAdapter();
}
