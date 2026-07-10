import { getWorkbenchCsrfToken } from "@/lib/csrf-token";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type ManagedUser = {
  id: string;
  email: string | null;
  displayName: string;
  role: string;
  authMode: string;
  status: "active" | "disabled";
  disabledAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProjectMember = {
  userId: string;
  email: string | null;
  displayName: string;
  role: "owner" | "editor" | "viewer";
};

export class UserManagementApiError extends Error {
  readonly status?: number;
  readonly userMessage: string;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "UserManagementApiError";
    this.status = status;
    this.userMessage = message;
  }
}

export function createUserManagementClient(options: { baseUrl?: string; fetcher?: Fetcher } = {}) {
  const baseUrl = options.baseUrl ?? "";
  const fetcher = options.fetcher ?? fetch;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetcher(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...csrfHeader(init?.method),
        ...(init?.headers ?? {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof body?.error === "string" ? body.error : "操作没有完成，请稍后再试。";
      throw new UserManagementApiError(message, response.status);
    }
    return body as T;
  }

  return {
    listUsers(query = "") {
      const search = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
      return request<{ items: ManagedUser[] }>(`/api/admin/users${search}`);
    },
    inviteUser(input: { email: string; displayName: string; initialPassword: string; role?: "teacher" | "admin" }) {
      return request<{ userId: string; status: string }>("/api/admin/users/invite", { method: "POST", body: JSON.stringify(input) });
    },
    updateUser(userId: string, input: { disabled?: boolean; reason?: string; role?: "teacher" | "admin" }) {
      return request<ManagedUser>(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: JSON.stringify(input) });
    },
    resetPassword(userId: string, newPassword: string) {
      return request<{ userId: string; status: "password_reset" }>(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ newPassword }),
      });
    },
    revokeSessions(userId: string) {
      return request<{ userId: string; status: "sessions_revoked" }>(`/api/admin/users/${encodeURIComponent(userId)}/sessions/revoke`, { method: "POST" });
    },
    listProjectMembers(projectId: string) {
      return request<{ items: ProjectMember[] }>(`/api/workbench/projects/${encodeURIComponent(projectId)}/members`);
    },
    addProjectMember(projectId: string, input: { email: string; role: "editor" | "viewer" }) {
      return request<ProjectMember>(`/api/workbench/projects/${encodeURIComponent(projectId)}/members`, { method: "POST", body: JSON.stringify(input) });
    },
    updateProjectMember(projectId: string, userId: string, role: "editor" | "viewer") {
      return request<ProjectMember>(`/api/workbench/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
    },
    removeProjectMember(projectId: string, userId: string) {
      return request<{ userId: string; status: "removed" }>(`/api/workbench/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
    },
  };
}

function csrfHeader(method?: string): Record<string, string> {
  if (!method || method.toUpperCase() === "GET") return {};
  const token = getWorkbenchCsrfToken();
  return token ? { "x-shanhai-csrf": token } : {};
}
