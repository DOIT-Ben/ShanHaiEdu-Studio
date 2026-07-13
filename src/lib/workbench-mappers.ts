import type { RealAssetKind } from "@/lib/artifact-real-assets";
import type {
  ArtifactItem,
  ArtifactKind,
  ArtifactStatus,
  ChatDeliveryPlan,
  ChatMessage,
  ConversationTurnJob,
  ConversationTurnJobStatus,
  ProjectItem,
  ProjectStatus,
  WorkbenchSnapshot,
} from "@/lib/types";

export type BackendProjectRecord = {
  id: string;
  title: string;
  status: ProjectStatus;
  currentNodeKey: ArtifactKind;
  grade: string | null;
  subject: string | null;
  textbookVersion: string | null;
  lessonTopic: string | null;
  lifecycleState?: ProjectItem["lifecycleState"];
  lifecycleVersion?: number;
  archivedAt?: string | null;
  deletedAt?: string | null;
  generationIntensity?: ProjectItem["generationIntensity"];
  intensityVersion?: number;
  generationIntensitySuggestion?: ProjectItem["generationIntensitySuggestion"];
  createdAt: string;
  updatedAt: string;
};

export type BackendMessageRecord = {
  id: string;
  projectId: string;
  role: "teacher" | "assistant" | "system";
  content: string;
  artifactRefs: string[];
  metadata?: Record<string, unknown>;
  reaction?: "helpful" | "unhelpful";
  createdAt: string;
};

type BackendConversationTurnJobRecord = {
  id: string;
  projectId: string;
  teacherMessageId: string;
  assistantMessageId: string | null;
  status: ConversationTurnJobStatus;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
};

type BackendPendingDeliveryPlan = {
  status?: string;
  actionId?: string;
  toolPlan?: {
    capabilityId?: string;
  };
  deliveryPlan?: BackendDeliveryPlan;
};

type BackendDeliveryPlan = {
  id?: string;
  title?: string;
  summary?: string;
  currentStepId?: string;
  steps?: BackendDeliveryPlanStep[];
};

type BackendDeliveryPlanStep = {
  id?: string;
  title?: string;
  teacherDescription?: string;
  status?: ChatDeliveryPlan["steps"][number]["status"];
  requiresConfirmation?: boolean;
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
  turnJobs?: BackendConversationTurnJobRecord[];
};

const nodeTitleByKey: Record<ArtifactKind, string> = {
  requirement_spec: "需求规格",
  textbook_evidence: "教材",
  lesson_plan: "教案",
  ppt_outline: "PPT 大纲",
  intro_video_plan: "导入",
  ppt_draft: "PPT 大纲",
  ppt_design_draft: "PPT 设计稿",
  pptx_artifact: "PPTX 文件",
  knowledge_anchor_extract: "知识锚点",
  creative_theme_generate: "创意主题",
  video_script_generate: "视频脚本",
  storyboard_generate: "视频分镜",
  asset_brief_generate: "资产说明",
  asset_image_generate: "资产图",
  video_segment_plan: "片段计划",
  video_segment_generate: "分镜视频",
  concat_only_assemble: "最终视频",
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
    lifecycleState: project.lifecycleState ?? (project.deletedAt ? "trash" : project.archivedAt ? "archived" : "active"),
    lifecycleVersion: typeof project.lifecycleVersion === "number" && Number.isInteger(project.lifecycleVersion) ? project.lifecycleVersion : 0,
    archivedAt: project.archivedAt ?? null,
    deletedAt: project.deletedAt ?? null,
    generationIntensity: project.generationIntensity ?? "standard",
    intensityVersion: typeof project.intensityVersion === "number" ? project.intensityVersion : 0,
    generationIntensitySuggestion: project.generationIntensitySuggestion ?? null,
  };
}

function mapBackendMessage(message: BackendMessageRecord, turnJobsByTeacherMessageId = new Map<string, ConversationTurnJob>()): ChatMessage {
  const pendingPlan = pendingDeliveryPlanFromMessage(message);
  const deliveryPlan = toChatDeliveryPlan(pendingPlan?.deliveryPlan, pendingActionId(pendingPlan));
  const quickReplies = quickRepliesFromPendingPlan(pendingPlan, deliveryPlan);
  const turnJob = message.role === "teacher" ? turnJobsByTeacherMessageId.get(message.id) : undefined;

  return {
    id: message.id,
    speaker: message.role === "assistant" ? "assistant" : "teacher",
    body: teacherVisibleMessageBody(message),
    timeLabel: formatDateLabel(message.createdAt),
    ...(turnJob && turnJob.status !== "succeeded" ? { turnStatus: turnJob.status, turnStatusLabel: turnJob.statusLabel } : {}),
    artifactRefs: message.artifactRefs,
    ...(quickReplies.length ? { quickReplies } : {}),
    ...(deliveryPlan ? { deliveryPlan } : {}),
    ...(message.reaction ? { reaction: message.reaction } : {}),
  };
}

function teacherVisibleMessageBody(message: BackendMessageRecord) {
  return sanitizeTeacherVisibleText(message.content);
}

function sanitizeTeacherVisibleText(value: string) {
  return value
    .replace(/schema/gi, "结构")
    .replace(/manifest/gi, "清单")
    .replace(/provider/gi, "生成服务")
    .replace(/node_id/gi, "节点")
    .replace(/storage/gi, "文件保存")
    .replace(/\bAPI\b/g, "接口")
    .replace(/debug/gi, "排查")
    .replace(/local path/gi, "本地位置")
    .replace(/capabilityId/gi, "能力")
    .replace(/runtimeKind/gi, "运行方式")
    .replace(/providerStatus/gi, "生成状态")
    .replace(/placeholder/gi, "临时内容");
}

function mapBackendTurnJob(job: BackendConversationTurnJobRecord): ConversationTurnJob {
  return {
    id: job.id,
    projectId: job.projectId,
    teacherMessageId: job.teacherMessageId,
    assistantMessageId: job.assistantMessageId,
    status: job.status,
    statusLabel: turnStatusLabel(job.status),
    errorMessage: job.errorMessage ? sanitizeTeacherVisibleText(job.errorMessage) : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function turnStatusLabel(status: ConversationTurnJobStatus) {
  const labels: Record<ConversationTurnJobStatus, string> = {
    queued: "排队中",
    running: "正在生成",
    succeeded: "已完成",
    failed: "生成失败，可重试",
    canceled: "已取消",
    blocked: "未达标，需要处理",
  };
  return labels[status];
}

function pendingDeliveryPlanFromMessage(message: BackendMessageRecord): BackendPendingDeliveryPlan | null {
  if (message.role !== "assistant") return null;
  const value = message.metadata?.pendingDeliveryPlan;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pendingPlan = value as BackendPendingDeliveryPlan;
  return pendingPlan.status === "pending" ? pendingPlan : null;
}

function quickRepliesFromPendingPlan(pendingPlan: BackendPendingDeliveryPlan | null, deliveryPlan?: ChatDeliveryPlan): NonNullable<ChatMessage["quickReplies"]> {
  if (!pendingPlan?.toolPlan?.capabilityId) return [];
  const hasCompletedStep = Boolean(deliveryPlan?.steps.some((step) => step.status === "succeeded"));
  const actionId = pendingActionId(pendingPlan);
  return [
    {
      label: hasCompletedStep ? "继续下一步" : "确认开始",
      prompt: hasCompletedStep ? "继续下一步" : "确认开始",
      ...(actionId ? { actionId } : {}),
      recommended: true,
    },
  ];
}

function toChatDeliveryPlan(plan?: BackendDeliveryPlan, actionId?: string): ChatDeliveryPlan | undefined {
  const steps = plan?.steps?.map(toChatDeliveryPlanStep).filter((step): step is ChatDeliveryPlan["steps"][number] => Boolean(step));
  if (!plan?.title || !plan.summary || !steps?.length) return undefined;

  return {
    id: plan.id ?? `delivery-plan-${plan.title}`,
    ...(actionId ? { actionId } : {}),
    title: plan.title,
    summary: plan.summary,
    steps,
  };
}

function pendingActionId(pendingPlan: BackendPendingDeliveryPlan | null) {
  return typeof pendingPlan?.actionId === "string" && pendingPlan.actionId.trim() ? pendingPlan.actionId.trim() : undefined;
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

function contentFromArtifact(artifact: BackendArtifactRecord): Record<string, string | string[]> {
  const content: Record<string, string | string[]> = {};
  if (artifact.markdownContent) content["正文"] = sanitizeTeacherVisibleText(artifact.markdownContent);
  for (const [key, value] of Object.entries(artifact.structuredContent ?? {})) {
    if (!isVisibleStructuredLabel(key)) continue;
    const visibleValue = toTeacherVisibleStructuredValue(value);
    if (visibleValue) content[key] = visibleValue;
  }
  if (!Object.keys(content).length) content.说明 = sanitizeTeacherVisibleText(artifact.summary || "还没有可复用内容。");
  return content;
}

function previewFieldsFromContent(artifact: BackendArtifactRecord): { label: string; value: string }[] {
  const fields = Object.entries(artifact.structuredContent ?? {})
    .filter(([label]) => isVisibleStructuredLabel(label))
    .map(([label, value]) => ({ label, value: toTeacherVisibleStructuredValue(value) }))
    .filter((field): field is { label: string; value: string | string[] } => Boolean(field.value))
    .slice(0, 3)
    .map(({ label, value }) => ({ label, value: sanitizeTeacherVisibleText(Array.isArray(value) ? value.join("、") : value) }));
  return fields.length ? fields : [{ label: "内容", value: sanitizeTeacherVisibleText(artifact.summary || "已生成内容") }];
}

function toTeacherVisibleStructuredValue(value: unknown): string | string[] | null {
  if (typeof value === "string") return value.trim() ? sanitizeTeacherVisibleText(value) : null;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const entries = value
      .filter((entry) => typeof entry === "string" || typeof entry === "number")
      .map((entry) => sanitizeTeacherVisibleText(String(entry)))
      .filter(Boolean);
    return entries.length ? entries : null;
  }
  return null;
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
    ["capability", "id"],
    ["runtime", "kind"],
    ["provider", "status"],
    ["place", "holder"],
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
      previewFields: [{ label: "内容", value: "还没有生成内容" }],
      actions: { canCopy: false, canUseAsInput: false, canOpenDetail: true, canConfirm: false, canRegenerate: false },
      content: { 正文: "还没有生成内容。" },
      realAssetDownloads: [],
    };
  }

  const pptSampleReview = pptSampleReviewFromContent(artifact.structuredContent);
  const pptFullDeckReview = pptFullDeckReviewFromContent(artifact.structuredContent);
  const hasSealedSampleSet = isObjectRecord(artifact.structuredContent.pptKeySampleSet);
  const hasSealedFullDeck = isObjectRecord(artifact.structuredContent.pptFullDeckPackage);

  return {
    key: artifact.id,
    artifactId: artifact.id,
    nodeKey: node.key,
    version: artifact.version,
    kind: artifact.kind,
    title: artifact.title || nodeTitleByKey[node.key] || node.title,
    status: mapStatus(artifact.status),
    summary: sanitizeTeacherVisibleText(artifact.summary || "已生成内容。"),
    updatedAt: formatDateLabel(artifact.updatedAt),
    reusable: artifact.isApproved || artifact.status === "approved" || artifact.status === "needs_review",
    sourceTitles: node.upstreamNodeKeys.map((key) => nodeTitleByKey[key] ?? key),
    previewFields: previewFieldsFromContent(artifact),
    actions: {
      canCopy: true,
      canUseAsInput: true,
      canOpenDetail: true,
      canConfirm: artifact.status === "needs_review" && (!pptSampleReview || hasSealedSampleSet) && (!pptFullDeckReview || hasSealedFullDeck),
      canRegenerate: true,
    },
    content: contentFromArtifact(artifact),
    realAssetDownloads: realAssetDownloadsFromContent(artifact.structuredContent),
    routeGenerationActions: routeGenerationActionsFromContent(artifact.structuredContent),
    pptSampleReview,
    pptFullDeckReview,
  };
}

function pptFullDeckReviewFromContent(structuredContent: Record<string, unknown>): ArtifactItem["pptFullDeckReview"] {
  const candidate = structuredContent.pptFullDeckCandidate;
  if (!isObjectRecord(candidate) || typeof candidate.candidateDigest !== "string" || !Array.isArray(candidate.pageIds)) return undefined;
  const pageIds = candidate.pageIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const review = structuredContent.pptFullDeckReview;
  const overallStatus = isObjectRecord(review) ? review.overallStatus : undefined;
  const qa = isObjectRecord(review) && Array.isArray(review.qa)
    ? review.qa.flatMap((entry) => {
        if (!isObjectRecord(entry) || typeof entry.pageId !== "string") return [];
        const design = pptReviewStatus(entry.design);
        const visual = pptReviewStatus(entry.visual);
        const provenance = pptReviewStatus(entry.provenance);
        const readability = pptReviewStatus(entry.readability);
        if (!design || !visual || !provenance || !readability) return [];
        const findings = Array.isArray(entry.findings) ? entry.findings.filter((finding): finding is string => typeof finding === "string") : [];
        return [{ pageId: entry.pageId, design, visual, provenance, readability, findings }];
      })
    : undefined;
  return {
    candidateDigest: candidate.candidateDigest,
    pageIds,
    reviewStatus: overallStatus === "passed" || overallStatus === "failed" ? overallStatus : "awaiting_delivery_review",
    ...(qa?.length ? { qa } : {}),
  };
}

function pptSampleReviewFromContent(structuredContent: Record<string, unknown>): ArtifactItem["pptSampleReview"] {
  const candidate = structuredContent.pptKeySampleCandidate;
  if (!isObjectRecord(candidate) || typeof candidate.candidateDigest !== "string" || !Array.isArray(candidate.samplePageIds)) return undefined;
  const pageIds = candidate.samplePageIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const overviews = Array.isArray(candidate.overviews) ? candidate.overviews : [];
  const allowedKinds = new Set(["scene_and_primary_props", "micro_assets", "assembled_samples"] as const);
  const overviewKinds = overviews
    .map((value) => isObjectRecord(value) ? value.kind : undefined)
    .filter((value): value is "scene_and_primary_props" | "micro_assets" | "assembled_samples" =>
      typeof value === "string" && allowedKinds.has(value as "scene_and_primary_props" | "micro_assets" | "assembled_samples"));
  const review = structuredContent.pptKeySampleReview;
  const overallStatus = isObjectRecord(review) ? review.overallStatus : undefined;
  const qa = isObjectRecord(review) && Array.isArray(review.qa)
    ? review.qa.flatMap((entry) => {
        if (!isObjectRecord(entry) || typeof entry.pageId !== "string") return [];
        const design = pptReviewStatus(entry.design);
        const visual = pptReviewStatus(entry.visual);
        const provenance = pptReviewStatus(entry.provenance);
        if (!design || !visual || !provenance) return [];
        const findings = Array.isArray(entry.findings) ? entry.findings.filter((finding): finding is string => typeof finding === "string") : [];
        return [{ pageId: entry.pageId, design, visual, provenance, findings }];
      })
    : undefined;
  return {
    candidateDigest: candidate.candidateDigest,
    pageIds,
    overviewKinds,
    reviewStatus: overallStatus === "passed" || overallStatus === "failed" ? overallStatus : "awaiting_dvp_review",
    ...(qa?.length ? { qa } : {}),
  };
}

function pptReviewStatus(value: unknown): "passed" | "failed" | null {
  return value === "passed" || value === "failed" ? value : null;
}

function routeGenerationActionsFromContent(structuredContent: Record<string, unknown>) {
  const actions = structuredContent.routeGenerationActions;
  if (!isObjectRecord(actions)) return undefined;
  const result: NonNullable<ArtifactItem["routeGenerationActions"]> = {};
  for (const capabilityId of ["coze_ppt", "image_asset", "video_segment_generate"] as const) {
    const action = actions[capabilityId];
    if (!isObjectRecord(action)) continue;
    const actionId = action.actionId;
    if (typeof actionId === "string" && actionId.trim()) {
      result[capabilityId] = { actionId: actionId.trim() };
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function realAssetDownloadsFromContent(structuredContent: Record<string, unknown>): RealAssetKind[] {
  const storage = structuredContent.storage;
  if (!storage || typeof storage !== "object" || Array.isArray(storage)) return [];
  const storageRecord = storage as Record<string, unknown>;
  const downloads: RealAssetKind[] = [];
  if (isObjectRecord(storageRecord.cozePptx)) downloads.push("pptx");
  if (isObjectRecord(storageRecord.imageAsset)) downloads.push("image");
  if (isObjectRecord(storageRecord.videoAsset)) downloads.push("video");
  return downloads;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeProjects(value: unknown): ProjectItem[] {
  if (isBackendProjectList(value)) return value.projects.map(mapBackendProject);
  return value as ProjectItem[];
}

export function normalizeSnapshot(value: unknown): WorkbenchSnapshot {
  if (!isBackendSnapshot(value)) return value as WorkbenchSnapshot;
  const turnJobs = (value.turnJobs ?? []).map(mapBackendTurnJob);
  const turnJobsByTeacherMessageId = new Map(turnJobs.map((job) => [job.teacherMessageId, job]));
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
    messages: value.messages.filter((message) => message.role !== "system").map((message) => mapBackendMessage(message, turnJobsByTeacherMessageId)),
    artifacts,
    turnJobs,
    activeArtifactKey: activeArtifact?.key ?? "",
  };
}
