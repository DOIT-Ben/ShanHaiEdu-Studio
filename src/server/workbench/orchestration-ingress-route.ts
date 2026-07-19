import operationRegistry from "../../../config/orchestration-write-operations.json";

export type OrchestrationIngressOperation =
  | "project_create"
  | "project_lifecycle_update"
  | "teacher_message_submit"
  | "message_reaction_set"
  | "legacy_agent_run_start"
  | "legacy_agent_run_finish"
  | "generation_intensity_update"
  | "project_member_add"
  | "project_member_role_update"
  | "project_member_remove"
  | "teacher_artifact_create"
  | "artifact_approve"
  | "ppt_sample_review_submit"
  | "ppt_full_deck_review_submit"
  | "artifact_route_coze_ppt"
  | "artifact_route_image"
  | "artifact_route_video"
  | "unclassified_external";

export type OrchestrationIngressControlImpact =
  | "teacher_write"
  | "teacher_task_submission"
  | "legacy_external_orchestration"
  | "artifact_route"
  | "unclassified_external";

export type OrchestrationIngressWriteMethod = "POST" | "PUT" | "PATCH" | "DELETE";

type RegistryEntry = {
  method: OrchestrationIngressWriteMethod;
  routeTemplate: string;
  operation: Exclude<OrchestrationIngressOperation, "unclassified_external">;
  controlImpact: Exclude<OrchestrationIngressControlImpact, "unclassified_external">;
};

const registry = Object.freeze(operationRegistry.map(parseRegistryEntry));

export function resolveOrchestrationIngressOperation(request: Request) {
  const method = normalizeWriteMethod(request.method);
  if (!method) return null;
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/api/workbench/projects" && !pathname.startsWith("/api/workbench/projects/")) return null;
  for (const candidate of registry) {
    if (candidate.method !== method) continue;
    const routeParams = matchRouteTemplate(candidate.routeTemplate, pathname);
    if (!routeParams) continue;
    return {
      operation: candidate.operation,
      routeTemplate: candidate.routeTemplate,
      claimedProjectId: safeProjectId(routeParams.projectId),
      controlImpact: candidate.controlImpact,
    };
  }
  return {
    operation: "unclassified_external" as const,
    routeTemplate: "/api/workbench/projects/:unclassified",
    claimedProjectId: safeProjectId(/^\/api\/workbench\/projects\/([^/]+)/.exec(pathname)?.[1]),
    controlImpact: "unclassified_external" as const,
  };
}

export function normalizeWriteMethod(value: string): OrchestrationIngressWriteMethod | null {
  const method = value.toUpperCase();
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE" ? method : null;
}

export function safeProjectId(value: unknown) {
  if (typeof value !== "string") return null;
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return null; }
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(decoded) ? decoded : null;
}

export function findOrchestrationIngressClassification(operation: string) {
  return operation === "unclassified_external"
    ? { routeTemplate: "/api/workbench/projects/:unclassified", controlImpact: "unclassified_external" as const }
    : registry.find((entry) => entry.operation === operation) ?? null;
}

function parseRegistryEntry(value: unknown): RegistryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("orchestration_operation_registry_invalid");
  const source = value as Record<string, unknown>;
  const method = normalizeWriteMethod(String(source.method ?? ""));
  if (!method || typeof source.routeTemplate !== "string" || !source.routeTemplate.startsWith("/api/workbench/projects")) {
    throw new Error("orchestration_operation_registry_invalid");
  }
  return {
    method,
    routeTemplate: source.routeTemplate,
    operation: source.operation as RegistryEntry["operation"],
    controlImpact: source.controlImpact as RegistryEntry["controlImpact"],
  };
}

function matchRouteTemplate(template: string, pathname: string) {
  const templateSegments = template.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  if (templateSegments.length !== pathSegments.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < templateSegments.length; index += 1) {
    const templateSegment = templateSegments[index];
    const pathSegment = pathSegments[index];
    if (templateSegment.startsWith(":")) {
      params[templateSegment.slice(1)] = pathSegment;
    } else if (templateSegment !== pathSegment) {
      return null;
    }
  }
  return params;
}
