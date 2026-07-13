import { hashRunInput } from "@/server/execution/run-input-snapshot";

export type VideoNarrationScript = {
  schemaVersion: "video-narration-script.v1";
  language: "zh-CN";
  voiceId: string;
  text: string;
  courseAnchor: string;
  answerDisclosureBoundary: string;
  scriptDigest: string;
};

export function createVideoNarrationScript(input: Omit<VideoNarrationScript, "scriptDigest">): VideoNarrationScript {
  const script = { ...input, scriptDigest: hashRunInput(input) };
  const validation = validateVideoNarrationScript(script);
  if (!validation.valid) throw new Error(`video_narration_script_invalid:${validation.issues.join(",")}`);
  return script;
}

export function validateVideoNarrationScript(value: VideoNarrationScript): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (value.schemaVersion !== "video-narration-script.v1") issues.push("schema_version_invalid");
  if (value.language !== "zh-CN") issues.push("language_invalid");
  if (!value.voiceId?.trim()) issues.push("voice_missing");
  const text = value.text?.trim() ?? "";
  if (text.length < 10 || text.length > 500) issues.push("text_length_invalid");
  if (!value.courseAnchor?.trim() || !value.answerDisclosureBoundary?.trim()) issues.push("course_boundary_missing");
  const { scriptDigest, ...semantic } = value;
  if (hashRunInput(semantic) !== scriptDigest) issues.push("script_digest_invalid");
  return { valid: issues.length === 0, issues };
}
