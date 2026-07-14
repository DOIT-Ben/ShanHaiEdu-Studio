import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { GET as getPackageRoute } from "@/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/package/route";
import { writeLocalArtifact } from "@/server/artifact-storage/local-artifact-storage";
import { createWorkbenchService } from "@/server/workbench/service";

describe("Local Real MVP M13 final material package route", () => {
  it("downloads only the ZIP persisted on the requested final-delivery version", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M13 persisted package" });
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ packageType: "version-bound-test" }));
    zip.file("lesson-plan.md", "# 教案");
    const buffer = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "STORE" }));
    const stored = writeLocalArtifact({ category: "package-artifacts", fileName: `${project.id}-final.zip`, buffer });
    const finalDelivery = await service.saveArtifact(project.id, {
      nodeKey: "final_delivery", kind: "final_delivery", title: "正式最终材料包", status: "needs_review",
      summary: "已持久化版本绑定 ZIP。", markdownContent: "# 最终材料包",
      structuredContent: {
        storage: { packageAsset: { fileName: `${project.id}-final.zip`, localOutput: stored.localOutput } },
      },
    });

    const response = await getPackageRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.id, artifactId: finalDelivery.id }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/zip");
    expect(Buffer.from(await response.arrayBuffer()).equals(buffer)).toBe(true);
  });

  it("fails closed when the requested final-delivery version has no persisted ZIP", async () => {
    const service = createWorkbenchService();
    const project = await service.createProject({ title: "M13 missing package" });
    const finalDelivery = await service.saveArtifact(project.id, {
      nodeKey: "final_delivery", kind: "final_delivery", title: "只有清单", status: "needs_review",
      summary: "未生成正式 ZIP。", markdownContent: "# 清单", structuredContent: {},
    });

    const response = await getPackageRoute(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: project.id, artifactId: finalDelivery.id }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).not.toContain("application/zip");
  });
});
