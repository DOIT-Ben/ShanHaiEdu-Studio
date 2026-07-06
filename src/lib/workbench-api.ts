import { artifacts as seedArtifacts, chatMessages as seedMessages, projects as seedProjects } from "@/lib/mock-data";
import type { ArtifactItem, ChatMessage, ProjectItem, WorkbenchDataSource, WorkbenchSnapshot } from "@/lib/types";

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

const teacherFacingLoadError = "项目内容暂时没有取回，请稍后再试。";

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

type ServerProject = {
  id: string;
  title: string;
  status: string;
  currentNodeKey: string;
  grade: string | null;
  subject: string | null;
  textbookVersion: string | null;
  lessonTopic: string | null;
  updatedAt: string;
};

type ServerMessage = {
  id: string;
  role: string;
  content: string;
};

type ServerNode = {
  key: string;
  title: string;
  status: string;
  updatedAt: string;
};

type ServerArtifact = {
  id: string;
  nodeKey: string;
  kind: string;
  title: string;
  status: string;
  summary: string;
  markdownContent: string;
  structuredContent: Record<string, unknown>;
  version: number;
  isApproved: boolean;
  updatedAt: string;
};

type ServerSnapshot = {
  project: ServerProject;
  messages: ServerMessage[];
  nodes: ServerNode[];
  artifacts: ServerArtifact[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactDate(value: string | null | undefined) {
  if (!value) return "刚刚";
  return value.includes("T") ? "刚刚" : value;
}

function statusForProject(status: string): ProjectItem["status"] {
  if (status === "review" || status === "blocked" || status === "done") return status;
  return "active";
}

function statusForArtifact(status: string): ArtifactItem["status"] {
  if (status === "approved" || status === "in_progress" || status === "needs_review" || status === "blocked" || status === "stale") return status;
  if (status === "failed") return "blocked";
  return "not_started";
}

function nodeLabel(key: string) {
  const labels: Record<string, string> = {
    requirement_spec: "需求规格",
    textbook_evidence: "教材证据",
    lesson_plan: "教案",
    ppt_outline: "PPT 大纲",
    ppt_draft: "PPT 草稿",
    intro_video_plan: "导入视频方案",
    image_prompts: "图片提示词",
    video_storyboard: "视频分镜",
    final_delivery: "最终交付",
    final_delivery_checklist: "最终交付清单",
  };
  return labels[key] ?? "备课产物";
}

function mapProject(project: ServerProject): ProjectItem {
  const meta = [project.grade, project.subject, project.lessonTopic].filter(Boolean).join(" · ") || "公开课备课";
  return {
    id: project.id,
    title: project.title,
    meta,
    status: statusForProject(project.status),
    currentStep: nodeLabel(project.currentNodeKey),
    updatedAt: compactDate(project.updatedAt),
  };
}

function mapMessage(message: ServerMessage): ChatMessage {
  return {
    id: message.id,
    speaker: message.role === "teacher" ? "teacher" : "assistant",
    body: message.content,
  };
}

function artifactContent(artifact: ServerArtifact): Record<string, string | string[]> {
  if (isObject(artifact.structuredContent)) {
    const internalFields = new Set(["generationMode", "nextSuggestedAction", "regeneratedFromArtifactId"]);
    const entries = Object.entries(artifact.structuredContent).filter(
      ([key, value]) => !internalFields.has(key) && (typeof value === "string" || Array.isArray(value)),
    );
    if (entries.length > 0) return Object.fromEntries(entries) as Record<string, string | string[]>;
  }
  return {
    "内容摘要": artifact.markdownContent || artifact.summary,
  };
}

function mapArtifact(artifact: ServerArtifact): ArtifactItem {
  const status = statusForArtifact(artifact.status);
  const reusable = status === "approved" || status === "needs_review";
  return {
    key: artifact.nodeKey,
    kind: artifact.kind as ArtifactItem["kind"],
    title: artifact.title || nodeLabel(artifact.nodeKey),
    status,
    summary: artifact.summary,
    updatedAt: compactDate(artifact.updatedAt),
    reusable,
    sourceTitles: ["当前项目"],
    previewFields: [
      { label: "状态", value: status === "approved" ? "已确认" : status === "needs_review" ? "待确认" : "未开始" },
      { label: "版本", value: `第 ${artifact.version} 版` },
    ],
    actions: {
      canCopy: Boolean(artifact.summary || artifact.markdownContent),
      canUseAsInput: reusable,
      canOpenDetail: true,
      canConfirm: status === "needs_review",
      canRegenerate: true,
    },
    content: artifactContent(artifact),
  };
}

function normalizeProjectList(value: unknown): ProjectItem[] {
  const rawProjects = Array.isArray(value) ? value : isObject(value) && Array.isArray(value.projects) ? value.projects : [];
  return rawProjects.map((project) => mapProject(project as ServerProject));
}

function normalizeSnapshot(value: unknown): WorkbenchSnapshot {
  if (!isObject(value)) throw new WorkbenchApiError("Invalid snapshot response.");
  const serverSnapshot = value as unknown as ServerSnapshot;
  const artifacts = (serverSnapshot.artifacts ?? []).map(mapArtifact);
  const activeArtifactKey =
    artifacts.find((artifact) => artifact.status === "needs_review")?.key ??
    artifacts.find((artifact) => artifact.status === "approved")?.key ??
    artifacts[0]?.key ??
    serverSnapshot.nodes?.[0]?.key ??
    "";
  return {
    project: mapProject(serverSnapshot.project),
    messages: (serverSnapshot.messages ?? []).map(mapMessage),
    artifacts,
    activeArtifactKey,
  };
}

export function createWorkbenchApiClient(options: WorkbenchApiClientOptions = {}): WorkbenchDataSource {
  const baseUrl = options.baseUrl ?? "";
  const fetcher = options.fetcher ?? fetch;

  function request<T>(path: string, init?: RequestInit) {
    return fetcher(endpoint(baseUrl, path), {
      method: init?.method ?? "GET",
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    }).then((response) => parseResponse<T>(response));
  }

  return {
    listProjects() {
      return request<unknown>("/api/workbench/projects").then(normalizeProjectList);
    },
    async createProject() {
      const response = await request<unknown>("/api/workbench/projects", {
        method: "POST",
        body: JSON.stringify({ title: "新的公开课项目", subject: "数学", grade: "五年级", lessonTopic: "百分数" }),
      });
      const project = isObject(response) && isObject(response.project) ? (response.project as unknown as ServerProject) : null;
      if (!project?.id) throw new WorkbenchApiError("Project creation response did not include an id.");
      return request<unknown>(`/api/workbench/projects/${project.id}/snapshot`).then(normalizeSnapshot);
    },
    getProjectSnapshot(projectId) {
      return request<unknown>(`/api/workbench/projects/${projectId}/snapshot`).then(normalizeSnapshot);
    },
    async sendMessage(projectId, body, reference) {
      await request<unknown>(`/api/workbench/projects/${projectId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body, reference }),
      });
      return request<unknown>(`/api/workbench/projects/${projectId}/snapshot`).then(normalizeSnapshot);
    },
    async approveArtifact(projectId, artifactKey) {
      await request<unknown>(`/api/workbench/projects/${projectId}/artifacts/${artifactKey}/approve`, { method: "POST" });
      return request<unknown>(`/api/workbench/projects/${projectId}/snapshot`).then(normalizeSnapshot);
    },
    async regenerateArtifact(projectId, artifactKey) {
      await request<unknown>(`/api/workbench/projects/${projectId}/artifacts/${artifactKey}/regenerate`, { method: "POST" });
      return request<unknown>(`/api/workbench/projects/${projectId}/snapshot`).then(normalizeSnapshot);
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
