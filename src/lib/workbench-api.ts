import { artifacts as seedArtifacts, chatMessages as seedMessages, projects as seedProjects } from "@/lib/mock-data";
import { getWorkbenchCsrfToken, isWorkbenchCsrfRequired } from "@/lib/csrf-token";
import { normalizeProjects, normalizeSnapshot, type BackendProjectRecord } from "@/lib/workbench-mappers";
import type { RealAssetKind } from "@/lib/artifact-real-assets";
import type { ArtifactItem, ChatDeliveryPlan, ChatMessage, ProjectItem, ProjectLifecycleMutation, ProjectLifecycleState, WorkbenchDataSource, WorkbenchSendMessageOptions, WorkbenchSnapshot } from "@/lib/types";

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

type MessageTurnResponse = {
  assistantMessage?: {
    id: string;
  };
  agentTurn?: {
    quickReplies?: ChatMessage["quickReplies"];
    deliveryPlan?: BackendDeliveryPlan;
  };
};

type BackendDeliveryPlan = {
  id?: string;
  title?: string;
  summary?: string;
  steps?: BackendDeliveryPlanStep[];
};

type BackendDeliveryPlanStep = {
  id?: string;
  title?: string;
  teacherDescription?: string;
  status?: ChatDeliveryPlan["steps"][number]["status"];
  requiresConfirmation?: boolean;
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
    const headers = {
      "content-type": "application/json",
      ...csrfHeader(init?.method),
      ...(init?.headers ?? {}),
    };
    return fetcher(endpoint(baseUrl, path), {
      ...init,
      headers,
    }).then((response) => parseResponse<T>(response));
  }

  return {
    listProjects(view = "active") {
      const query = view === "active" ? "" : `?view=${encodeURIComponent(view)}`;
      return request<unknown>(`/api/workbench/projects${query}`).then(normalizeProjects);
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
    sendMessage(projectId, body, reference, options) {
      return request<unknown>(`/api/workbench/projects/${projectId}/messages`, {
        method: "POST",
        body: JSON.stringify(messagePostBody(body, reference, options)),
      }).then((turn) =>
        request<unknown>(`/api/workbench/projects/${projectId}/snapshot`)
          .then(normalizeSnapshot)
          .then((snapshot) => mergeTurnAssistantMetadata(snapshot, turn as MessageTurnResponse)),
      );
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
    generateRealAsset(projectId, artifactId, assetKind, options) {
      const confirmedActionId = normalizedConfirmedActionId(options);
      return request<unknown>(`/api/workbench/projects/${projectId}/artifacts/${artifactId}/${realAssetRouteSegment(assetKind)}`, {
        method: "POST",
        body: JSON.stringify(confirmedActionId ? { confirmedActionId } : {}),
      }).then(() => request<unknown>(`/api/workbench/projects/${projectId}/snapshot`).then(normalizeSnapshot));
    },
    mutateProjectLifecycle(projectId, mutation) {
      return request<unknown>(`/api/workbench/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify(mutation),
      }).then((value) => {
        const result = value as { changed?: unknown; project?: BackendProjectRecord };
        if (!result.project?.id) throw new WorkbenchApiError("Lifecycle response did not include a project.");
        const project = normalizeProjects({ projects: [result.project] })[0];
        if (!project) throw new WorkbenchApiError("Lifecycle response project could not be normalized.");
        return { changed: result.changed === true, project };
      });
    },
  };
}

function messagePostBody(body: string, reference: string | null, options?: WorkbenchSendMessageOptions) {
  const confirmedActionId = normalizedConfirmedActionId(options);
  return {
    role: "teacher",
    content: body,
    reference,
    artifactRefs: reference ? [reference] : [],
    ...(confirmedActionId ? { confirmedActionId } : {}),
    ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
  };
}

function normalizedConfirmedActionId(options?: WorkbenchSendMessageOptions) {
  const value = options?.confirmedActionId ?? options?.actionId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function mergeTurnAssistantMetadata(snapshot: WorkbenchSnapshot, turn: MessageTurnResponse): WorkbenchSnapshot {
  const quickReplies = turn.agentTurn?.quickReplies;
  const deliveryPlan = toChatDeliveryPlan(turn.agentTurn?.deliveryPlan);
  if ((!quickReplies?.length && !deliveryPlan) || !turn.assistantMessage?.id) return snapshot;

  return {
    ...snapshot,
    messages: snapshot.messages.map((message) =>
      message.id === turn.assistantMessage?.id && message.speaker === "assistant"
        ? { ...message, ...(quickReplies?.length ? { quickReplies } : {}), ...(deliveryPlan ? { deliveryPlan } : {}) }
        : message,
    ),
  };
}

function toChatDeliveryPlan(plan?: BackendDeliveryPlan): ChatDeliveryPlan | undefined {
  const steps = plan?.steps?.map(toChatDeliveryPlanStep).filter((step): step is ChatDeliveryPlan["steps"][number] => Boolean(step));
  if (!plan?.title || !plan.summary || !steps?.length) return undefined;

  return {
    id: plan.id ?? `delivery-plan-${plan.title}`,
    title: plan.title,
    summary: plan.summary,
    steps,
  };
}

function toChatDeliveryPlanStep(step: BackendDeliveryPlanStep): ChatDeliveryPlan["steps"][number] | null {
  if (!step.id || !step.title || !step.teacherDescription || !step.status) return null;

  return {
    id: step.id,
    title: step.title,
    teacherDescription: step.teacherDescription,
    status: step.status,
    statusLabel: deliveryPlanStatusLabel(step.status),
    requiresConfirmation: Boolean(step.requiresConfirmation),
  };
}

function deliveryPlanStatusLabel(status: ChatDeliveryPlan["steps"][number]["status"]) {
  const labels: Record<ChatDeliveryPlan["steps"][number]["status"], string> = {
    awaiting_confirmation: "等待确认",
    pending: "待推进",
    running: "正在推进",
    succeeded: "已完成",
    failed: "需要处理",
  };
  return labels[status];
}

function csrfHeader(method?: string): Record<string, string> {
  if (!isWorkbenchCsrfRequired()) return {};
  if (!isWriteMethod(method ?? "GET")) return {};
  const token = getWorkbenchCsrfToken();
  return token ? { "x-shanhai-csrf": token } : {};
}

function isWriteMethod(method: string) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
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
  const projects = clone(source.projects).map((project) => ({
    ...project,
    lifecycleState: project.lifecycleState ?? "active",
    lifecycleVersion: project.lifecycleVersion ?? 0,
    archivedAt: project.archivedAt ?? null,
    deletedAt: project.deletedAt ?? null,
  }));
  const snapshots = new Map<string, Omit<WorkbenchSnapshot, "project">>();

  function ensureSnapshot(projectId: string) {
    if (!snapshots.has(projectId)) {
      snapshots.set(projectId, {
        messages: clone(source.messages),
        artifacts: clone(source.artifacts),
        turnJobs: [],
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
    async listProjects(view: ProjectLifecycleState = "active") {
      return clone(projects.filter((project) => project.lifecycleState === view));
    },
    async createProject() {
      const project: ProjectItem = {
        id: `dev-project-${Date.now()}`,
        title: "新的公开课项目",
        meta: "刚刚",
        status: "active",
        currentStep: "需求澄清",
        updatedAt: "刚刚",
        lifecycleState: "active",
        lifecycleVersion: 0,
        archivedAt: null,
        deletedAt: null,
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
        turnJobs: [],
        activeArtifactKey: source.artifacts[0]?.key ?? "",
      });
      return snapshot(project.id);
    },
    async getProjectSnapshot(projectId) {
      return snapshot(projectId);
    },
    async mutateProjectLifecycle(projectId: string, mutation: ProjectLifecycleMutation) {
      const project = projectById(projectId);
      if (project.lifecycleVersion !== mutation.expectedLifecycleVersion) {
        throw new WorkbenchApiError("Project lifecycle version conflict.", "项目状态已变化，请刷新后再操作。", 409);
      }

      const active = project.lifecycleState === "active";
      if (mutation.action === "rename") {
        const title = mutation.title?.trim() ?? "";
        if (!active || !title || title.length > 80) {
          throw new WorkbenchApiError("Project lifecycle mutation rejected.", "该项目当前不能执行这个操作。", 409);
        }
        if (title === project.title) return { changed: false, project: clone(project) };
        project.title = title;
      } else if (mutation.action === "archive") {
        if (project.lifecycleState === "archived") return { changed: false, project: clone(project) };
        if (!active) throw new WorkbenchApiError("Project lifecycle mutation rejected.", "该项目当前不能执行这个操作。", 409);
        project.lifecycleState = "archived";
        project.archivedAt = new Date().toISOString();
      } else if (mutation.action === "trash") {
        if (project.lifecycleState === "trash") return { changed: false, project: clone(project) };
        project.lifecycleState = "trash";
        project.deletedAt = new Date().toISOString();
      } else {
        if (active) return { changed: false, project: clone(project) };
        project.lifecycleState = "active";
        project.archivedAt = null;
        project.deletedAt = null;
      }
      project.lifecycleVersion += 1;
      project.updatedAt = "刚刚";
      project.meta = "刚刚";
      return { changed: true, project: clone(project) };
    },
    async sendMessage(projectId, body, reference) {
      const current = ensureSnapshot(projectId);
      if (!current) throw new WorkbenchApiError("Snapshot was not created.");
      const timestamp = Date.now();
      current.messages.push({
        id: `${projectId}-teacher-${timestamp}`,
        speaker: "teacher",
        body: reference ? `${body}\n\n引用：${reference}` : body,
        turnStatus: "running",
        turnStatusLabel: "正在生成",
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
  if (process.env.NEXT_PUBLIC_WORKBENCH_DATA_SOURCE === "mock") {
    return createDevelopmentWorkbenchAdapter();
  }
  return createWorkbenchApiClient();
}
