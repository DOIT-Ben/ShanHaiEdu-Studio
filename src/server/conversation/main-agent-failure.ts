export type MainAgentFailurePhase = "direct_response" | "agent_tool_loop" | "output_parse";

export type MainAgentFailureCategory =
  | "provider_policy"
  | "authorization"
  | "rate_limit"
  | "timeout"
  | "network"
  | "invalid_response"
  | "control_plane"
  | "provider_unavailable"
  | "unexpected";

export type MainAgentFailureRetryability = "retryable" | "after_provider_health_change" | "not_retryable";

export type MainAgentFailure = {
  phase: MainAgentFailurePhase;
  reasonCode: string;
  category: MainAgentFailureCategory;
  retryability: MainAgentFailureRetryability;
  summary: string;
  evidenceDigest?: string;
};

export function classifyMainAgentFailure(input: {
  phase: MainAgentFailurePhase;
  reason: string;
  diagnosticSummary: string;
  evidenceDigest?: string;
}): MainAgentFailure {
  const diagnostic = input.diagnosticSummary.toLowerCase();
  const reason = input.reason.toLowerCase();
  const base = { phase: input.phase, ...(input.evidenceDigest ? { evidenceDigest: input.evidenceDigest } : {}) };

  if (/\b403\b|request was blocked|policy block|forbidden/.test(diagnostic)) {
    return { ...base, reasonCode: "main_agent_provider_policy_blocked", category: "provider_policy", retryability: "after_provider_health_change", summary: "当前智能服务通道拒绝了这次请求。" };
  }
  if (/\b401\b|unauthorized|invalid authentication|authentication failed/.test(diagnostic)) {
    return { ...base, reasonCode: "main_agent_provider_authorization_failed", category: "authorization", retryability: "after_provider_health_change", summary: "当前智能服务通道未通过身份校验。" };
  }
  if (/\b429\b|rate limit|too many requests/.test(diagnostic)) {
    return { ...base, reasonCode: "main_agent_provider_rate_limited", category: "rate_limit", retryability: "retryable", summary: "当前智能服务通道暂时繁忙。" };
  }
  if (/timeout|timed out|deadline|aborterror/.test(diagnostic)) {
    return { ...base, reasonCode: "main_agent_provider_timeout", category: "timeout", retryability: "retryable", summary: "本轮智能处理超过了等待时间。" };
  }
  if (/econnreset|econnrefused|enotfound|dns|network|fetch failed|socket|disconnected/.test(diagnostic)) {
    return { ...base, reasonCode: "main_agent_provider_network_failed", category: "network", retryability: "retryable", summary: "当前智能服务通道连接失败。" };
  }
  if (/control_plane_dispatch_failed|tool invocation|task aggregate plan revision/.test(`${reason} ${diagnostic}`)) {
    return { ...base, reasonCode: "control_plane_lifecycle_conflict", category: "control_plane", retryability: "not_retryable", summary: "任务执行状态发生冲突，当前进度已保存并暂停恢复。" };
  }
  if (input.phase === "output_parse" || /empty_output|invalid|schema|parse/.test(reason)) {
    return { ...base, reasonCode: "main_agent_response_invalid", category: "invalid_response", retryability: "retryable", summary: "本轮智能结果不完整，未进入后续执行。" };
  }
  if (/adapter_failed|provider|service unavailable|\b5\d\d\b/.test(`${reason} ${diagnostic}`)) {
    return { ...base, reasonCode: "main_agent_provider_unavailable", category: "provider_unavailable", retryability: "after_provider_health_change", summary: "当前智能服务通道暂时不可用。" };
  }
  return { ...base, reasonCode: "main_agent_execution_failed", category: "unexpected", retryability: "not_retryable", summary: "本轮智能处理没有可靠完成。" };
}
