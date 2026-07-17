import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("assistant-ui neutral waiting state", () => {
  it("does not invent client-side work stages before a persisted event exists", () => {
    const controller = readFileSync(path.join(process.cwd(), "src/hooks/useWorkbenchController.ts"), "utf8");
    const indicator = readFileSync(path.join(process.cwd(), "src/components/conversation/messages/GeneratingIndicator.tsx"), "utf8");

    expect(controller).not.toContain("正在理解你的备课要求");
    expect(controller).not.toContain("正在组织教案、课件和素材任务");
    expect(controller).not.toContain("正在保存本轮成果");
    expect(indicator).toContain('"小酷正在回复"');
    expect(indicator).toContain("elapsedSeconds");
  });
});
