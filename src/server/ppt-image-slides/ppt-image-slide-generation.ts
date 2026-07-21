import { createHash } from "node:crypto";
import type { ArtifactRecord, ProjectRecord } from "@/server/workbench/types";
import { hashRunInput } from "@/server/execution/run-input-snapshot";
import { generateImageFromPrompt } from "@/server/image-generation/image-generation-run";
import type { ImageGenerationResult } from "@/server/image-generation/image-generation-run";
import type { PptDesignPackage } from "@/server/ppt-quality/ppt-quality-types";
import type { PptImageSlideBundle } from "./ppt-image-slide-types";

export async function generatePptImageSlideBundle(input: {
  project: ProjectRecord;
  designArtifact: ArtifactRecord;
  generateImage?: typeof generateImageFromPrompt;
}): Promise<PptImageSlideBundle> {
  const designPackage = input.designArtifact.structuredContent.pptDesignPackage as PptDesignPackage | undefined;
  if (!designPackage || !Array.isArray(designPackage.pageSpecs) || designPackage.pageSpecs.length !== designPackage.brief.targetSlideCount) {
    throw new Error("ppt_image_slide_design_invalid");
  }
  const entries: PptImageSlideBundle["entries"] = [];
  for (const page of designPackage.pageSpecs) {
    const prompt = [
      "生成一张 16:9 教学课件整页视觉图，只负责背景、空间、材质和主视觉，不生成任何文字、数字、公式、答案或水印。",
      `主题：${designPackage.brief.topic}`,
      `页面 ${page.pageNumber}：${page.primaryVisualBrief}`,
      `画面要求：${page.aiScene.brief}`,
      `视觉系统：${designPackage.visualSystem.materialLanguage}；${designPackage.visualSystem.lighting}；${designPackage.visualSystem.camera}`,
    ].join("\n");
    const result: ImageGenerationResult = await (input.generateImage ?? generateImageFromPrompt)({ project: input.project, prompt, aspectRatio: "16:9", normalizeCanvas: true, gatewayCapability: "ppt_image", fileStem: `ppt-page-${page.pageId}` });
    entries.push({
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      prompt,
      promptDigest: createHash("sha256").update(prompt).digest("hex"),
      storageRef: result.localOutput,
      fileName: result.fileName,
      sha256: result.sha256,
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      mime: result.mime,
      provider: result.provider,
      model: result.model,
      rawAsset: { fileName: result.rawAsset.fileName, storageRef: result.rawAsset.localOutput, sha256: result.rawAsset.sha256, bytes: result.rawAsset.bytes, width: result.rawAsset.width ?? result.width, height: result.rawAsset.height ?? result.height, mime: result.rawAsset.mime },
      normalizedAsset: { fileName: result.normalizedAsset.fileName, storageRef: result.normalizedAsset.localOutput, sha256: result.normalizedAsset.sha256, bytes: result.normalizedAsset.bytes, width: result.normalizedAsset.width, height: result.normalizedAsset.height, mime: result.normalizedAsset.mime },
      processingChain: result.rawAsset.sha256 === result.normalizedAsset.sha256 ? [] : [{ operation: "resize_to_16_9_canvas", sourceSha256: result.rawAsset.sha256, targetSha256: result.normalizedAsset.sha256 }],
    });
  }
  return { schemaVersion: "ppt-image-slide-bundle.v1", designPackageDigest: hashRunInput(designPackage), entries };
}
