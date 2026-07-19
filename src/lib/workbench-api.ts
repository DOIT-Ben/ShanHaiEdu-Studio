import { getWorkbenchCsrfToken, isWorkbenchCsrfRequired } from "@/lib/csrf-token";
import { normalizeProjects, normalizeSnapshot, type BackendProjectRecord } from "@/lib/workbench-mappers";
import type { RealAssetKind } from "@/lib/artifact-real-assets";
import type {
  ArtifactItem,
  ConversationMessageSubmission,
  WorkbenchDataSource,
  WorkbenchSendMessageOptions,
  WorkbenchSnapshot,
} from "@/lib/types";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type WorkbenchApiClientOptions = {
  baseUrl?: string;
  fetcher?: Fetcher;
};

type MessageTurnResponse = {
  assistantMessage?: {
    id: string;
  };
  agentTurn?: {
    quickReplies?: WorkbenchSnapshot["messages"][number]["quickReplies"];
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

  function submitConversationMessage(projectId: string, submission: ConversationMessageSubmission) {
    return request<unknown>(`/api/workbench/projects/${projectId}/messages`, {
      method: "POST",
      body: JSON.stringify(buildConversationMessagePostBody(submission)),
    }).then((turn) =>
      request<unknown>(`/api/workbench/projects/${projectId}/snapshot`)
        .then(normalizeSnapshot)
        .then((snapshot) => mergeTurnAssistantMetadata(snapshot, turn as MessageTurnResponse)),
    );
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
    submitConversationMessage,
    recoverConversationTurn(projectId, checkpointId) {
      return request<unknown>(`/api/workbench/projects/${projectId}/messages`, {
        method: "POST",
        body: JSON.stringify({ recoveryCheckpointId: checkpointId }),
      }).then(() => request<unknown>(`/api/workbench/projects/${projectId}/snapshot`).then(normalizeSnapshot));
    },
    sendMessage(projectId, body, reference, options) {
      return submitConversationMessage(projectId, {
        body,
        reference,
        artifactRefs: [],
        ...messageSubmissionOptions(options),
      });
    },
    setMessageReaction(projectId, messageId, value) {
      return request<unknown>(`/api/workbench/projects/${projectId}/messages/${messageId}/reaction`, {
        method: "POST",
        body: JSON.stringify({ value }),
      }).then((result) => normalizeSnapshot((result as { snapshot: unknown }).snapshot));
    },
    approveArtifact(projectId, artifactKey) {
      return request<unknown>(`/api/workbench/projects/${projectId}/artifacts/${artifactKey}/approve`, { method: "POST" }).then(() =>
        request<unknown>(`/api/workbench/projects/${projectId}/snapshot`).then(normalizeSnapshot),
      );
    },
    submitPptSampleReview(projectId, artifactKey, review) {
      return request<unknown>(`/api/workbench/projects/${projectId}/artifacts/${artifactKey}/ppt-sample-review`, {
        method: "POST",
        body: JSON.stringify(review),
      }).then(() => request<unknown>(`/api/workbench/projects/${projectId}/snapshot`).then(normalizeSnapshot));
    },
    submitPptFullDeckReview(projectId, artifactKey, review) {
      return request<unknown>(`/api/workbench/projects/${projectId}/artifacts/${artifactKey}/ppt-full-deck-review`, {
        method: "POST",
        body: JSON.stringify(review),
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
    updateGenerationIntensity(projectId, intensity, expectedVersion, confirmationActionId) {
      return request<unknown>(`/api/workbench/projects/${projectId}/generation-intensity`, {
        method: "PATCH",
        body: JSON.stringify({ intensity, expectedVersion, ...(confirmationActionId ? { confirmationActionId } : {}) }),
      }).then((value) => {
        const result = value as { project?: BackendProjectRecord; confirmationRequired?: boolean; actionId?: string };
        if (!result.project?.id) throw new WorkbenchApiError("Generation intensity response did not include a project.");
        const project = normalizeProjects({ projects: [result.project] })[0];
        if (!project) throw new WorkbenchApiError("Generation intensity project could not be normalized.");
        return { project, ...(result.confirmationRequired ? { confirmationRequired: true, actionId: result.actionId } : {}) };
      });
    },
  };
}

export function buildConversationMessagePostBody(submission: ConversationMessageSubmission) {
  return {
    role: "teacher",
    content: submission.body,
    reference: submission.reference,
    artifactRefs: [...new Set(submission.artifactRefs.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))],
    ...(submission.confirmedActionId?.trim() ? { confirmedActionId: submission.confirmedActionId.trim() } : {}),
    ...(submission.idempotencyKey?.trim() ? { idempotencyKey: submission.idempotencyKey.trim() } : {}),
    ...(submission.responseStyle ? { responseStyle: submission.responseStyle } : {}),
  };
}

function messageSubmissionOptions(options?: WorkbenchSendMessageOptions) {
  const confirmedActionId = normalizedConfirmedActionId(options);
  return {
    ...(confirmedActionId ? { confirmedActionId } : {}),
    ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    ...(options?.responseStyle ? { responseStyle: options.responseStyle } : {}),
  };
}

function normalizedConfirmedActionId(options?: WorkbenchSendMessageOptions) {
  const value = options?.confirmedActionId ?? options?.actionId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function mergeTurnAssistantMetadata(snapshot: WorkbenchSnapshot, turn: MessageTurnResponse): WorkbenchSnapshot {
  const quickReplies = turn.agentTurn?.quickReplies;
  if (!quickReplies?.length || !turn.assistantMessage?.id) return snapshot;

  return {
    ...snapshot,
    messages: snapshot.messages.map((message) =>
      message.id === turn.assistantMessage?.id && message.speaker === "assistant"
        ? { ...message, quickReplies }
        : message,
    ),
  };
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

function realAssetRouteSegment(assetKind: RealAssetKind) {
  if (assetKind === "pptx") return "coze-ppt";
  return assetKind;
}
