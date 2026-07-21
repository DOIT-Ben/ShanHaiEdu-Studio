import { executeFinalPackage } from "./package-tool-final-adapter";
import {
  executePptFullDeckAssembly,
  executePptKeySampleAssembly,
  executePptPageRepair,
  executePptImageSlideAssembly,
} from "./package-tool-ppt-adapter";
import { executeConcatOnlyAssemble } from "./package-tool-video-adapter";
import {
  buildFailureResult,
  type PackageToolAdapterInput,
} from "./package-tool-adapter-shared";
import type { ToolExecutionResult } from "./tool-types";

export type { PackageArtifactRef, PackageToolAdapterInput } from "./package-tool-adapter-shared";
export type {
  PersistedFinalPackageObservation,
  PersistedFinalPackageToolInvocation,
} from "./package-tool-final-adapter";
export { readPackageAssetBuffer } from "./package-tool-final-adapter";

export async function executePackageTool(input: PackageToolAdapterInput): Promise<ToolExecutionResult> {
  if (input.tool.adapterKind !== "package" || !input.tool.implemented) {
    return buildFailureResult(input, "tool_failed", "这一步暂时无法执行，请稍后重试。", "Unsupported package tool.", "unsupported_package_tool");
  }

  try {
    if (input.tool.capabilityId === "concat_only_assemble") return await executeConcatOnlyAssemble(input);
    if (input.tool.capabilityId === "final_package") return await executeFinalPackage(input);
    if (input.tool.capabilityId === "ppt_key_samples") return await executePptKeySampleAssembly(input);
    if (input.tool.capabilityId === "ppt_full_deck") return await executePptFullDeckAssembly(input);
    if (input.tool.capabilityId === "ppt_page_repair") return await executePptPageRepair(input);
    if (input.tool.capabilityId === "ppt_image_slide_assembly") return await executePptImageSlideAssembly(input);
    return buildFailureResult(input, "tool_failed", "这类打包工具暂时不能自动执行。", `Unsupported package capability: ${input.tool.capabilityId}`, "unsupported_package_tool");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown package tool error";
    return buildFailureResult(input, "quality_gate_failed", "生成结果没有通过交付校验，我没有保存这份结果。", reason, "quality_gate_failed");
  }
}
