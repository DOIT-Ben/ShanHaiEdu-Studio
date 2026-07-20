import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GeneratingIndicator } from "@/components/conversation/messages/GeneratingIndicator";

describe("assistant-ui neutral waiting state", () => {
  it("renders a neutral label and real elapsed-time counter before activity exists", () => {
    const markup = renderToStaticMarkup(createElement(GeneratingIndicator, { mark: createElement("span", null, "mark") }));

    expect(markup).toContain('aria-label="小酷正在回复"');
    expect(markup).toContain("小酷正在回复");
    expect(markup).toContain("已运行 0 秒");
    expect(markup).not.toContain("正在理解你的备课要求");
    expect(markup).not.toContain("正在组织教案、课件和素材任务");
    expect(markup).not.toContain("正在保存本轮成果");
  });

  it("uses persisted execution state labels when one is supplied", () => {
    const queued = renderToStaticMarkup(createElement(GeneratingIndicator, { state: "queued", mark: createElement("span") }));
    const running = renderToStaticMarkup(createElement(GeneratingIndicator, { state: "running", mark: createElement("span") }));

    expect(queued).toContain("排队中");
    expect(running).toContain("正在生成");
  });
});
