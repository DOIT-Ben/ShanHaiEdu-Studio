import { describe, expect, it } from "vitest";
import { pptxDownloadHeaders } from "./artifact-pptx";

describe("pptxDownloadHeaders", () => {
  it("uses RFC 5987 encoding so Chinese filenames are valid response headers", () => {
    const headers = pptxDownloadHeaders("百分数导入课.pptx");

    expect(() => new Response("ok", { headers })).not.toThrow();
    expect(headers["content-disposition"]).toContain("filename=\"pptx-file.pptx\"");
    expect(headers["content-disposition"]).toContain("filename*=UTF-8''%E7%99%BE%E5%88%86%E6%95%B0%E5%AF%BC%E5%85%A5%E8%AF%BE.pptx");
  });
});
