import { setWorkbenchCsrfRequired, setWorkbenchCsrfToken } from "@/lib/csrf-token";

export type PasswordAuthUser = {
  id: string;
  email: string | null;
  displayName: string;
  role: string;
  authMode: "password";
};

export type PasswordAuthState = {
  enabled?: boolean;
  authMode?: "local" | "password" | "oauth" | "sso";
  authenticated: boolean;
  user: PasswordAuthUser | null;
  csrfToken?: string;
};

export type PasswordAuthClientOptions = {
  baseUrl?: string;
  fetcher?: typeof fetch;
};

export class PasswordAuthClientError extends Error {
  readonly status?: number;
  readonly userMessage: string;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "PasswordAuthClientError";
    this.status = status;
    this.userMessage = message;
  }
}

function endpoint(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export function createPasswordAuthClient(options: PasswordAuthClientOptions = {}) {
  const baseUrl = options.baseUrl ?? "";
  const fetcher = options.fetcher ?? fetch;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetcher(endpoint(baseUrl, path), {
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      ...init,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof body?.error === "string" ? body.error : "暂时没有处理成功，请稍后再试。";
      throw new PasswordAuthClientError(message, response.status);
    }
    captureCsrfToken(body);
    return body as T;
  }

  return {
    me() {
      return request<PasswordAuthState>("/api/auth/me");
    },
    register(input: { email: string; displayName?: string; password: string }) {
      return request<PasswordAuthState>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    login(input: { email: string; password: string }) {
      return request<PasswordAuthState>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    logout() {
      return request<PasswordAuthState & { revoked?: boolean }>("/api/auth/logout", {
        method: "POST",
      });
    },
  };
}

function captureCsrfToken(body: unknown) {
  if (!body || typeof body !== "object") return;
  const state = body as { enabled?: unknown; authMode?: unknown; authenticated?: unknown; csrfToken?: unknown; user?: unknown };
  if (typeof state.enabled === "boolean" || typeof state.authMode === "string") {
    setWorkbenchCsrfRequired(state.enabled === true || state.authMode === "password");
  } else if (state.authenticated === true || state.user) {
    setWorkbenchCsrfRequired(true);
  }
  if (typeof state.csrfToken === "string") {
    setWorkbenchCsrfToken(state.csrfToken);
    return;
  }
  if (state.authenticated === false) {
    setWorkbenchCsrfToken(null);
  }
}
