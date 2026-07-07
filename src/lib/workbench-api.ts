import { artifacts as seedArtifacts, chatMessages as seedMessages, projects as seedProjects } from "@/lib/mock-data";
import { normalizeProjects, normalizeSnapshot, type BackendProjectRecord } from "@/lib/workbench-mappers";
import type { RealAssetKind } from "@/lib/artifact-real-assets";
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
const teacherFacingRegeneratePendingError = "这个内容暂时还不能重做，请稍后再试。";

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
      return request<unknown>(`/api/workbench/projects/${projectId}/artifacts/${artifactKey}/approve`, { method: "POST" }).then(() =>
        request<unknown>(`/api/workbench/projects/${projectId}/snapshot`).then(normalizeSnapshot),
      );
    },
    regenerateArtifact(projectId, artifactKey) {
      return request<unknown>(`/api/workbench/projects/${projectId}/artifacts/${artifactKey}/regenerate`, {
        method: "POST",
        body: JSON.stringify({
          summary: "请重新生成这一版内容。",
          markdownContent: "# 重做草稿\n\n- 已保留旧版本。\n- 新版本完成后请重新确认是否采用。",
        }),
      }).then(() => request<unknown>(`/api/workbench/projects/${projectId}/snapshot`).then(normalizeSnapshot));
    },
    generateRealAsset(projectId, artifactId, assetKind) {
      return request<unknown>(`/api/workbench/projects/${projectId}/artifacts/${artifactId}/${realAssetRouteSegment(assetKind)}`, {
        method: "POST",
      }).then(() => request<unknown>(`/api/workbench/projects/${projectId}/snapshot`).then(normalizeSnapshot));
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
    async generateRealAsset(projectId, artifactKey, assetKind) {
      const current = ensureSnapshot(projectId);
      if (!current) throw new WorkbenchApiError("Snapshot was not created.");
      current.artifacts = current.artifacts.map((item) =>
        item.key === artifactKey || item.artifactId === artifactKey
          ? {
              ...item,
              status: "needs_review",
              updatedAt: "刚刚",
              summary: `${item.summary} 已请求生成真实素材，完成后请核对再用于授课。`,
            }
          : item,
      );
      current.activeArtifactKey = artifactKey;
      touchProject(projectId, assetKind === "video" ? "生成导入视频" : "生成课堂素材");
      return snapshot(projectId);
    },
  };
}

function realAssetRouteSegment(assetKind: RealAssetKind) {
  if (assetKind === "pptx") return "coze-ppt";
  return assetKind;
}

export function createDefaultWorkbenchDataSource(): WorkbenchDataSource {
  if (process.env.NEXT_PUBLIC_WORKBENCH_DATA_SOURCE === "api") {
    return createWorkbenchApiClient();
  }
  return createDevelopmentWorkbenchAdapter();
}
