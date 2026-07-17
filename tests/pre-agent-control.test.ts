import { describe, expect, it, vi } from "vitest";

import { commitPreAgentControl, resolvePreAgentControl } from "@/server/conversation/turn-intake-control";

describe("pre-agent control", () => {
  it.each(["暂停", "取消这次任务", "改道，只做视频脚本"])("commits %s before any executable agent dispatch", async (message) => {
    const order: string[] = [];
    const dispatchAgent = vi.fn(async () => order.push("agent"));
    const result = await commitPreAgentControl({
      userMessage: message,
      hasActiveTask: true,
      hasPendingPlan: true,
      persist: async () => order.push("control"),
      dispatchAgent,
    });

    expect(result.handled).toBe(true);
    expect(order).toEqual(["control"]);
    expect(dispatchAgent).not.toHaveBeenCalled();
  });

  it.each([
    "如果改成视频脚本会有什么区别？",
    "我不是说不要做 PPT，你理解了吗？",
    "我不是要暂停，继续说",
    "如果取消当前任务会怎样？",
    "为什么要停止当前任务？",
  ])("does not infer an operational control from ambiguous text before the Main Agent: %s", (message) => {
    expect(resolvePreAgentControl(message, { hasActiveTask: true, hasPendingPlan: true })).toBeUndefined();
  });

  it("treats an explicit redirect as an epoch-invalidating control", () => {
    expect(resolvePreAgentControl("改道，只做视频脚本", { hasActiveTask: true, hasPendingPlan: false, allowRedirect: true })).toEqual({
      kind: "redirect",
      reasonCode: "teacher_requested_redirect",
      advanceIntentEpoch: true,
      userMessage: "改道，只做视频脚本",
    });
  });

  it("keeps the current task identity when pausing", () => {
    expect(resolvePreAgentControl("暂停", { hasActiveTask: true, hasPendingPlan: true })).toEqual({
      kind: "pause",
      reasonCode: "teacher_requested_pause",
      advanceIntentEpoch: false,
      userMessage: "暂停",
    });
  });
});
