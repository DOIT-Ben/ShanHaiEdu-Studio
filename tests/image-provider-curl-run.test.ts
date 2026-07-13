import { describe, expect, it } from "vitest";
import { resolveCurlCommand } from "@/server/image-generation/image-provider-curl-run";

describe("image provider curl command", () => {
  it("uses the native curl executable for each production platform", () => {
    expect(resolveCurlCommand("win32")).toBe("curl.exe");
    expect(resolveCurlCommand("linux")).toBe("curl");
    expect(resolveCurlCommand("darwin")).toBe("curl");
  });
});
