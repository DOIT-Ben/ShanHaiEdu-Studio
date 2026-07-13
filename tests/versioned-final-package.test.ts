import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildVersionedFinalPackage, verifyFinalPackageBuffer, type ClassroomRunSpec, type FinalPackageFile } from "@/server/package/versioned-final-package";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "shanhai-final-package-"));
  roots.push(root);
  const roles = ["lesson_plan", "pptx", "pdf", "image", "video"] as const;
  const files: FinalPackageFile[] = roles.map((role) => {
    const filePath = path.join(root, `${role}.bin`);
    writeFileSync(filePath, Buffer.from(`real-${role}-content`));
    return {
      role,
      filePath,
      packageFileName: role === "lesson_plan" ? "教案.md" : `${role}.${role}`,
      sha256: createHash("sha256").update(readFileSync(filePath)).digest("hex"),
      courseVersionId: "percentage-v1",
      courseAnchor: "百分数的意义",
      reviewBatchId: "review-20260712",
      deliveryStatus: "final_eligible",
      sourceArtifactId: `artifact-${role}`,
      sourceArtifactVersion: 2,
      sourceArtifactDigest: createHash("sha256").update(`artifact-${role}`).digest("hex"),
    };
  });
  const classroomRunSpec: ClassroomRunSpec = { schemaVersion: "classroom-run-spec.v1", courseVersionId: "percentage-v1", courseAnchor: "百分数的意义", reviewBatchId: "review-20260712", sequence: [
    { ordinal: 1, action: "play_intro_video", artifactRole: "video", instruction: "播放导入视频。" },
    { ordinal: 2, action: "ask_return_question", instruction: "提出回接问题。" },
    { ordinal: 3, action: "open_ppt", artifactRole: "pptx", pptPage: 1, instruction: "打开课件。" },
    { ordinal: 4, action: "teacher_explain", artifactRole: "pptx", pptPage: 2, instruction: "组织观察。" },
    { ordinal: 5, action: "reveal_answer", artifactRole: "pptx", pptPage: 6, instruction: "在讨论后揭示定义。" },
  ] };
  return { files, classroomRunSpec };
}

const inspectors = {
  pptx: async () => ({ slideCount: 12 }),
  pdf: () => ({ pageCount: 12 }),
  video: () => ({ durationSeconds: 18.125, width: 752, height: 416, fps: 24, videoCodec: "h264", audioCodec: "aac" }),
};

describe("V1 Stage 5 versioned final package", () => {
  it("builds and reverse-verifies a hash-bound package without claiming teacher signoff", async () => {
    const fixtureValue = fixture();
    const result = await buildVersionedFinalPackage({ ...fixtureValue, teacherSignoff: false, inspectors });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.manifest).toMatchObject({ courseVersionId: "percentage-v1", reviewBatchId: "review-20260712", requiredRoles: ["lesson_plan", "pptx", "pdf", "image", "video"], packageStatus: "integration_review_passed", teacherSignoff: false, mediaEvidence: { pptx: { slideCount: 12 }, pdf: { pageCount: 12 } }, files: { image: { sourceArtifactId: "artifact-image", sourceArtifactVersion: 2 } } });
    await expect(verifyFinalPackageBuffer(result.buffer, result.manifest)).resolves.toBeUndefined();
  });

  it("blocks a mixed version before writing a package", async () => {
    const fixtureValue = fixture();
    fixtureValue.files[3].courseVersionId = "percentage-v2";
    await expect(buildVersionedFinalPackage({ ...fixtureValue, teacherSignoff: false, inspectors })).rejects.toThrow("final_package_version_binding_mismatch");
  });

  it("blocks a classroom run spec from another review batch", async () => {
    const fixtureValue = fixture();
    fixtureValue.classroomRunSpec.reviewBatchId = "review-other";
    await expect(buildVersionedFinalPackage({ ...fixtureValue, teacherSignoff: false, inspectors })).rejects.toThrow("classroom_run_spec_version_mismatch");
  });

  it("blocks stale hashes and wrong media evidence", async () => {
    const stale = fixture();
    stale.files[0].sha256 = "a".repeat(64);
    await expect(buildVersionedFinalPackage({ ...stale, teacherSignoff: false, inspectors })).rejects.toThrow("final_package_sha256_mismatch:lesson_plan");
    const badPdf = fixture();
    await expect(buildVersionedFinalPackage({ ...badPdf, teacherSignoff: false, inspectors: { ...inspectors, pdf: () => ({ pageCount: 11 }) } })).rejects.toThrow("final_package_pdf_page_count_invalid");
  });
});
