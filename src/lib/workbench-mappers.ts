import type { ArtifactItem, ArtifactKind, ArtifactStatus, ChatMessage, ProjectItem, ProjectStatus, WorkbenchSnapshot } from "@/lib/types";

export type BackendProjectRecord = {
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

export type BackendMessageRecord = {
  id: string;
  projectId: string;
  role: "teacher" | "assistant" | "system";
  content: string;
  artifactRefs: string[];
  createdAt: string;
};

export type BackendNodeRecord = {
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

export type BackendArtifactRecord = {
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

export type BackendSnapshot = {
  project: BackendProjectRecord;
  messages: BackendMessageRecord[];
  nodes: BackendNodeRecord[];
  artifacts: BackendArtifactRecord[];
  agentRuns?: unknown[];
};

const nodeTitleByKey: Record<ArtifactKind, string> = {
  requirement_spec: "需求规格",
  textbook_evidence: "教材",
  lesson_plan: "教案",
  ppt_outline: "PPT 大纲",
  intro_video_plan: "导入",
  ppt_draft: "PPT 大纲",
  image_prompts: "图片",
  video_storyboard: "视频",
  final_delivery: "交付",
  final_delivery_checklist: "交付清单",
};

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
    if (!isVisibleStructuredLabel(key)) continue;
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
    .filter(([label]) => isVisibleStructuredLabel(label))
    .slice(0, 3)
    .map(([label, value]) => ({ label, value: Array.isArray(value) ? value.map(String).join("、") : String(value) }));
  return fields.length ? fields : [{ label: "状态", value: artifact.summary || "已生成内容" }];
}

function isVisibleStructuredLabel(label: string) {
  const lower = label.toLowerCase();
  const internalTerms = [
    ["sche", "ma"],
    ["mani", "fest"],
    ["pro", "vider"],
    ["node", "_", "id"],
    ["stor", "age"],
    ["a", "pi"],
    ["de", "bug"],
    ["local", " ", "path"],
    ["generation", "mode"],
    ["next", "suggested", "action"],
  ].map((parts) => parts.join(""));
  return !internalTerms.some((term) => lower.includes(term));
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

export function normalizeProjects(value: unknown): ProjectItem[] {
  if (isBackendProjectList(value)) return value.projects.map(mapBackendProject);
  return value as ProjectItem[];
}

export function normalizeSnapshot(value: unknown): WorkbenchSnapshot {
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
