export type PreAgentControlKind = "pause" | "cancel" | "redirect";

export type PreAgentControlDecision = {
  kind: PreAgentControlKind;
  reasonCode: "teacher_requested_pause" | "teacher_requested_cancel" | "teacher_requested_redirect";
  advanceIntentEpoch: boolean;
  userMessage: string;
};

export type PreAgentControlResult<TAgentResult = unknown> =
  | { handled: true; control: PreAgentControlDecision }
  | { handled: false; agentResult: TAgentResult };

export async function commitPreAgentControl<TAgentResult>(input: {
  userMessage: string;
  hasActiveTask: boolean;
  hasPendingPlan: boolean;
  persist: (control: PreAgentControlDecision) => Promise<unknown>;
  dispatchAgent: () => Promise<TAgentResult>;
}): Promise<PreAgentControlResult<TAgentResult>> {
  const control = resolvePreAgentControl(input.userMessage, {
    hasActiveTask: input.hasActiveTask,
    hasPendingPlan: input.hasPendingPlan,
    allowRedirect: true,
  });
  if (control) {
    await input.persist(control);
    return { handled: true, control };
  }

  return { handled: false, agentResult: await input.dispatchAgent() };
}

export function resolvePreAgentControl(
  userMessage: string,
  state: { hasActiveTask: boolean; hasPendingPlan: boolean; allowRedirect?: boolean | "imperative" },
): PreAgentControlDecision | undefined {
  const message = userMessage.trim();
  if (!message || (!state.hasActiveTask && !state.hasPendingPlan)) return undefined;

  if (isExplicitPause(message)) {
    return decision("pause", "teacher_requested_pause", false, message);
  }
  if (isExplicitCancel(message)) {
    return decision("cancel", "teacher_requested_cancel", true, message);
  }
  if (state.allowRedirect && isExplicitRedirect(message, state.allowRedirect === "imperative")) {
    return decision("redirect", "teacher_requested_redirect", true, message);
  }
  return undefined;
}

function isExplicitPause(message: string): boolean {
  const normalized = compact(message);
  return /^(?:请)?(?:先)?(?:暂停|停一下|停|放一放)(?:这次|当前|刚才|这个)?(?:任务|计划|操作|这一步)?(?:，?(?:稍后|之后)再继续)?$/.test(normalized)
    || /^(?:稍后|之后)再继续$/.test(normalized);
}

function isExplicitCancel(message: string): boolean {
  const normalized = compact(message);
  return /^(?:请)?(?:先)?(?:取消|终止|停止)(?:这次|当前|刚才|这个)?(?:任务|计划|操作|这一步)?(?:，?(?:先|暂时)?不(?:要)?(?:继续|做)(?:了)?)?$/.test(normalized)
    || /^(?:不做了|算了)$/.test(normalized);
}

function isExplicitRedirect(message: string, imperativeOnly = false): boolean {
  const normalized = compact(message);
  if (imperativeOnly && !/^(?:请)?改道/.test(normalized)) return false;
  return /^(?:请)?(?:改道|改成|改为|转为|切换到)[，,:：]?(?:只|仅)?(?:做|生成|整理|制作)?.+/.test(normalized)
    && !/^(?:如果|是否|要不要|能不能|可不可以|为什么)/.test(normalized);
}

function compact(message: string): string {
  return message.replace(/\s+/g, "").replace(/[。.!！]+$/g, "");
}

function decision(
  kind: PreAgentControlKind,
  reasonCode: PreAgentControlDecision["reasonCode"],
  advanceIntentEpoch: boolean,
  userMessage: string,
): PreAgentControlDecision {
  return { kind, reasonCode, advanceIntentEpoch, userMessage };
}
