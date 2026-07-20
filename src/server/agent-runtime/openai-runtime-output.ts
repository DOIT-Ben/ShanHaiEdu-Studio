import { taskGuidance } from "./task-guidance";
import type { AgentRuntimeTask } from "./types";
import { RuntimeFailureError, extractPptCandidateValidationDetails } from "./openai-runtime-error";
import {
  normalizePptDesignSemanticCandidate,
} from "@/server/ppt-quality/ppt-design-candidate";
import { createStoryboardManifest, type StoryboardManifest } from "@/server/video-quality/video-production-contract";
import { createVideoNarrationScript, type VideoNarrationScript } from "@/server/video-quality/video-narration-contract";

export type StructuredRuntimeOutput = {
  assistantMessage: {
    title: string;
    body: string;
  };
  artifactDraft: {
    title: string;
    summary: string;
    markdown?: string;
    structuredContentJson?: string | null;
    videoStoryboardManifest?: unknown;
    structuredContent?: Record<string, unknown>;
  };
  nextSuggestedAction: {
    label: string;
  };
};

export function parseStructuredOutput(outputText: string | undefined, task: AgentRuntimeTask): StructuredRuntimeOutput {
  if (!outputText) {
    throw new RuntimeFailureError("missing_field", true, "runtime_output_missing");
  }

  let parsed: Partial<StructuredRuntimeOutput>;
  try {
    parsed = JSON.parse(outputText) as Partial<StructuredRuntimeOutput>;
  } catch {
    throw new RuntimeFailureError("parse", true, "runtime_output_json_invalid");
  }
  assertNonEmptyString(parsed.assistantMessage?.title);
  assertNonEmptyString(parsed.assistantMessage?.body);
  assertNonEmptyString(parsed.artifactDraft?.title);
  assertNonEmptyString(parsed.artifactDraft?.summary);
  assertNonEmptyString(parsed.nextSuggestedAction?.label);
  if (task === "storyboard_generate") {
    const manifest = normalizeStoryboardManifestCandidate(parsed.artifactDraft.videoStoryboardManifest);
    parsed.artifactDraft.structuredContent = { videoStoryboardManifest: manifest };
    parsed.artifactDraft.markdown = renderStoryboardMarkdown(manifest);
    return parsed as StructuredRuntimeOutput;
  }
  assertNonEmptyString(parsed.artifactDraft?.markdown);
  assertMarkdownMeetsTaskGuidance(parsed.artifactDraft.markdown, task);

  parsed.artifactDraft.structuredContent = parseStructuredContent(
    parsed.artifactDraft.structuredContentJson,
    task,
  );

  return parsed as StructuredRuntimeOutput;
}

function assertNonEmptyString(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RuntimeFailureError("missing_field", true, "runtime_output_required_text_missing");
  }
}

function assertMarkdownMeetsTaskGuidance(markdown: string, task: AgentRuntimeTask): void {
  const guidance = taskGuidance[task];
  const missingField = guidance.requiredFields.find((field) => !markdown.includes(field));

  if (missingField || !markdown.includes("## 自检清单")) {
    throw new RuntimeFailureError(
      "validation",
      true,
      "runtime_markdown_contract_invalid",
      missingField ? [missingField] : ["self_check_missing"],
    );
  }
}

function parseStructuredContent(
  structuredContentJson: string | null | undefined,
  task: AgentRuntimeTask,
): Record<string, unknown> | undefined {
  if (structuredContentJson === null || structuredContentJson === undefined) {
    if (task === "ppt_design" || task === "storyboard_generate" || task === "video_script_generate") {
      throw new RuntimeFailureError(
        "missing_field",
        true,
        task === "ppt_design" ? "ppt_design_candidate_missing" : "runtime_structured_content_missing",
      );
    }
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(structuredContentJson) as unknown;
  } catch {
    throw new RuntimeFailureError("parse", true, "runtime_structured_content_json_invalid");
  }
  if (!isRecord(parsed)) throw new RuntimeFailureError("validation", true, "runtime_structured_content_invalid");
  if (task === "storyboard_generate") {
    const manifest = parsed.videoStoryboardManifest;
    if (!isRecord(manifest)) throw new RuntimeFailureError("missing_field", true, "storyboard_candidate_missing");
    const validatedManifest = normalizeStoryboardManifestCandidate(manifest);
    return { ...parsed, videoStoryboardManifest: validatedManifest };
  }
  if (task === "video_script_generate") {
    const script = parsed.videoNarrationScript;
    if (!isRecord(script)) throw new RuntimeFailureError("missing_field", true, "video_script_candidate_missing");
    const semantic = { ...script }; delete semantic.scriptDigest;
    return { ...parsed, videoNarrationScript: createVideoNarrationScript(semantic as Omit<VideoNarrationScript, "scriptDigest">) };
  }
  if (task !== "ppt_design") return parsed;

  const candidateValue = parsed.pptDesignCandidate;
  if (!isRecord(candidateValue)) throw new RuntimeFailureError("missing_field", true, "ppt_design_candidate_missing");
  try {
    const semanticCandidate = normalizePptDesignSemanticCandidate(candidateValue);
    return {
      ...parsed,
      pptDesignCandidate: semanticCandidate,
    };
  } catch (error) {
    throw new RuntimeFailureError(
      "validation",
      true,
      "ppt_design_candidate_semantics_invalid",
      extractPptCandidateValidationDetails(error),
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStoryboardManifestCandidate(value: unknown): StoryboardManifest {
  if (!isRecord(value)) throw new RuntimeFailureError("missing_field", true, "storyboard_candidate_missing");
  const candidate = { ...value }; delete candidate.manifestDigest;
  const references = Array.isArray(candidate.references)
    ? candidate.references.map((reference) => {
        if (!isRecord(reference)) return reference;
        const { sha256, ...rest } = reference;
        return typeof sha256 === "string" && sha256.trim() ? { ...rest, sha256 } : rest;
      })
    : candidate.references;
  const shots = Array.isArray(candidate.shots)
    ? candidate.shots.map((shot) => {
        if (!isRecord(shot)) return shot;
        const shotId = typeof shot.shotId === "string" ? shot.shotId : "";
        const referenceAssetIds = Array.isArray(references)
          ? references.filter((reference) => isRecord(reference) && Array.isArray(reference.applicableShotIds) && reference.applicableShotIds.includes(shotId))
              .map((reference) => String((reference as Record<string, unknown>).assetId ?? ""))
              .filter(Boolean)
          : [];
        return { ...shot, referenceAssetIds };
      })
    : candidate.shots;
  try {
    return createStoryboardManifest({ ...candidate, shots, references } as Omit<StoryboardManifest, "manifestDigest">);
  } catch (error) {
    const details = error instanceof Error && error.message.includes(":")
      ? error.message.slice(error.message.indexOf(":") + 1).split(",").map((item) => item.trim()).filter(Boolean)
      : [];
    throw new RuntimeFailureError("validation", true, "storyboard_candidate_invalid", details);
  }
}

function renderStoryboardMarkdown(manifest: StoryboardManifest): string {
  const shots = manifest.shots;
  const shotLines = (render: (shot: StoryboardManifest["shots"][number]) => string) => shots.map((shot) => `- ${shot.shotId}: ${render(shot)}`);
  return [
    "## 目标总时长",
    `${manifest.intent.targetDurationRange.minSeconds}-${manifest.intent.targetDurationRange.maxSeconds} 秒。`,
    "",
    "## 分镜 ID",
    ...shots.map((shot) => `- ${shot.shotId}`),
    "",
    "## 每镜头时长",
    ...shotLines((shot) => `${shot.durationTargetRange.minSeconds}-${shot.durationTargetRange.maxSeconds} 秒`),
    "",
    "## 镜头目标",
    ...shotLines((shot) => shot.sceneFunction),
    "",
    "## 场景",
    ...shotLines((shot) => shot.mainSubject),
    "",
    "## 画面动作",
    ...shotLines((shot) => shot.subjectAction),
    "",
    "## 镜头运动",
    ...shotLines((shot) => shot.cameraMotion),
    "",
    "## 旁白或字幕",
    ...shotLines((shot) => shot.ordinal === shots.length
      ? `${manifest.intent.classroomReturnQuestion}（仅结尾回接）`
      : `${shot.sceneFunction}；按受控脚本在本镜头时段对齐`),
    "",
    "## 角色、道具、场景资产",
    ...shotLines((shot) => shot.referenceAssetIds.length ? shot.referenceAssetIds.join("、") : `${shot.mainSubject}（后续资产说明绑定）`),
    "",
    "## 关键帧要求",
    ...shotLines((shot) => `${shot.startFrameIntent} -> ${shot.endFrameIntent}`),
    "",
    "## 连贯性说明",
    ...shotLines((shot) => shot.continuityKeys.join("、")),
    "",
    "## 自检清单",
    `- 独立短片通过唯一课程锚点回接：${manifest.intent.courseAnchor}`,
    `- 答案披露边界：${manifest.intent.answerDisclosureBoundary}`,
    "- 镜头时长、顺序、资产引用和连续性均来自已校验分镜结构。",
  ].join("\n");
}
