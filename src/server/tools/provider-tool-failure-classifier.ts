import { VideoTaskPersistenceUnknownError } from "@/server/video-generation/video-generation-run";
import { VideoNarrationProviderError } from "@/server/video-generation/video-narration-provider";

import type { ProviderFailureDetails } from "./provider-tool-result-contract";

export function classifyVideoNarrationFailure(
  error: unknown,
  capabilityId: string,
  provider: string | undefined,
  providerRetryable: boolean,
): ProviderFailureDetails {
  if (!(error instanceof VideoNarrationProviderError)) {
    return classifyMediaFailure(error, capabilityId, provider, providerRetryable, "video");
  }

  const contractFailure = error.phase === "provider_response" || error.phase === "subtitle_validation";
  if (contractFailure) {
    return {
      capabilityId,
      provider,
      status: "failed",
      kind: "quality_gate_failed",
      userMessage: "旁白服务返回的音频或字幕没有通过执行校验，系统已保留脚本并交回智能体调整。",
      internalReason: error.code,
      retryable: false,
      errorCategory: "provider_contract_rejected",
      reasonCode: error.code,
      retryAction: "fix_inputs",
    };
  }

  return {
    capabilityId,
    provider,
    status: error.retryable ? "retryable_failed" : "failed",
    kind: "provider_unavailable",
    userMessage: "旁白服务暂时没有可靠完成，系统已保留脚本和恢复位置。",
    internalReason: error.code,
    retryable: error.retryable,
    errorCategory: error.code,
    reasonCode: error.code,
    retryAction: error.retryable ? "wait_for_provider" : "do_not_retry_automatically",
  };
}

export function classifyMediaFailure(
  error: unknown,
  capabilityId: string,
  provider: string | undefined,
  providerRetryable: boolean,
  media: "image" | "video",
): ProviderFailureDetails {
  const internalReason = error instanceof Error ? error.message : `Unknown ${media} provider error`;
  if (error instanceof VideoTaskPersistenceUnknownError) {
    return {
      capabilityId,
      provider,
      status: "failed",
      kind: "provider_unavailable",
      userMessage: "视频任务已经提交，但恢复信息没有可靠保存。系统已暂停自动重试，请等待管理员核对。",
      internalReason,
      retryable: false,
      errorCategory: "submission_unknown",
    };
  }
  if (internalReason.toLowerCase().includes(`invalid_${media}_output`) ||
      (media === "image" && internalReason === "model_gateway_image_lineage_incomplete")) {
    return {
      capabilityId,
      provider,
      status: "failed",
      kind: "quality_gate_failed",
      userMessage: media === "image"
        ? "课堂视觉图没有通过交付校验，请调整输入后再继续。"
        : "分镜视频没有通过交付校验，请调整输入后再继续。",
      internalReason,
      retryable: false,
      errorCategory: "quality_gate_failed",
    };
  }
  if (media === "image" &&
      internalReason.startsWith("minimax_image_generation_request_failed:status_2013")) {
    return {
      capabilityId,
      provider,
      status: "failed",
      kind: "quality_gate_failed",
      userMessage: "当前图片参数没有通过生成服务校验，系统已保留任务，请调整输入后继续。",
      internalReason,
      retryable: false,
      errorCategory: "provider_input_invalid",
      reasonCode: internalReason,
      retryAction: "fix_inputs",
    };
  }
  if (media === "image" && internalReason.startsWith("ppt_full_evidence_")) {
    return {
      capabilityId,
      provider,
      status: "failed",
      kind: "quality_gate_failed",
      userMessage: "正式课件缺少可核验的教材依据，系统没有调用生成服务。",
      internalReason,
      retryable: false,
      errorCategory: "quality_gate_failed",
    };
  }
  if (media === "video" && (
    internalReason.startsWith("video_provider_") ||
    internalReason.startsWith("video_storyboard_manifest_")
  )) {
    return {
      capabilityId,
      provider,
      status: "failed",
      kind: "quality_gate_failed",
      userMessage: "当前分镜或目标镜头没有通过执行校验，系统没有调用生成服务。",
      internalReason,
      retryable: false,
      errorCategory: "quality_gate_failed",
    };
  }

  return {
    capabilityId,
    provider,
    status: providerRetryable ? "retryable_failed" : "failed",
    kind: "provider_unavailable",
    userMessage: media === "image"
      ? "课堂视觉图生成服务暂时没有完成这一步，可以稍后重试。"
      : "分镜视频生成服务暂时没有完成这一步，可以稍后重试。",
    internalReason,
    retryable: providerRetryable,
    errorCategory: "provider_unavailable",
  };
}

export function classifyCozePptFailure(
  error: unknown,
  capabilityId: string,
  provider: string | undefined,
  providerRetryable: boolean,
): ProviderFailureDetails {
  const internalReason = error instanceof Error ? error.message : "Unknown coze_ppt provider error";

  if (isCozePptQualityGateFailure(internalReason)) {
    return {
      capabilityId,
      provider,
      status: "failed",
      kind: "quality_gate_failed",
      userMessage: "PPTX 没有通过交付校验，请先调整设计稿或生成结果后再继续。",
      internalReason,
      retryable: false,
      errorCategory: "quality_gate_failed",
    };
  }

  return {
    capabilityId,
    provider,
    status: providerRetryable ? "retryable_failed" : "failed",
    kind: "provider_unavailable",
    userMessage: "PPTX 生成服务暂时没有完成这一步，可以稍后重试。",
    internalReason,
    retryable: providerRetryable,
    errorCategory: "provider_unavailable",
  };
}

function isCozePptQualityGateFailure(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return (
    normalized.includes("invalid ppt design") ||
    normalized.includes("invalid_ppt_design") ||
    normalized.includes("invalid pptx") ||
    normalized.includes("invalid_pptx") ||
    normalized.includes("invalid_coze_pptx") ||
    normalized.includes("slide count mismatch") ||
    normalized.includes("slide_count_mismatch") ||
    normalized.includes("validation failed") ||
    normalized.includes("quality gate") ||
    normalized.includes("quality_gate") ||
    reason.includes("PPT 设计稿未逐页完整") ||
    reason.includes("范围合并页") ||
    reason.includes("独立四层设计")
  );
}
