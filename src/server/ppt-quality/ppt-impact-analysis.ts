import { hashRunInput } from "@/server/execution/run-input-snapshot";
import type { PptDesignPackage, PptRevision, PptRevisionImpact } from "./ppt-quality-types";

export function analyzePptRevisionImpact(input: PptDesignPackage, revision: PptRevision): PptRevisionImpact {
  const pageIds = new Set(input.pageSpecs.map((page) => page.pageId));
  const sampleIds = new Set(input.samplePlan.samplePageIds);
  let nextAction: PptRevisionImpact["nextAction"] = "repair_unit";
  let invalidatedPageIds: string[] = [];
  let invalidatedAssetIds: string[] = [];
  let invalidateSampleApproval = false;
  let reasonCodes: string[] = [];

  if (revision.kind === "page_text_layout") {
    assertPageExists(revision.pageId, pageIds);
    invalidatedPageIds = [revision.pageId];
    invalidateSampleApproval = sampleIds.has(revision.pageId);
    reasonCodes = ["page_text_or_layout_revised"];
  } else if (revision.kind === "page_asset") {
    const page = input.pageSpecs.find((item) => item.pageId === revision.pageId);
    if (!page) throw new Error(`Unknown pageId: ${revision.pageId}`);
    if (!page.aiAssets.some((asset) => asset.assetId === revision.assetId)) {
      throw new Error(`Asset ${revision.assetId} does not belong to ${revision.pageId}`);
    }
    invalidatedPageIds = [revision.pageId];
    invalidatedAssetIds = [revision.assetId];
    invalidateSampleApproval = sampleIds.has(revision.pageId);
    reasonCodes = ["page_asset_revised"];
  } else if (revision.kind === "narrative_transition") {
    const pageIndex = input.pageSpecs.findIndex((page) => page.pageId === revision.pageId);
    if (pageIndex < 0) throw new Error(`Unknown pageId: ${revision.pageId}`);
    invalidatedPageIds = input.pageSpecs.slice(pageIndex, pageIndex + 2).map((page) => page.pageId);
    invalidateSampleApproval = invalidatedPageIds.some((pageId) => sampleIds.has(pageId));
    reasonCodes = ["narrative_transition_revised"];
  } else if (revision.kind === "objective") {
    if (!input.objectives.some((objective) => objective.objectiveId === revision.objectiveId)) {
      throw new Error(`Unknown objectiveId: ${revision.objectiveId}`);
    }
    nextAction = "repair_upstream";
    invalidatedPageIds = input.pageSpecs
      .filter((page) => page.objectiveIds.includes(revision.objectiveId))
      .map((page) => page.pageId);
    invalidateSampleApproval = true;
    reasonCodes = ["learning_objective_revised"];
  } else {
    if (!input.evidenceBindings.some((evidence) => evidence.evidenceId === revision.evidenceId)) {
      throw new Error(`Unknown evidenceId: ${revision.evidenceId}`);
    }
    const affectedObjectiveIds = new Set(input.objectives
      .filter((objective) => objective.evidenceRefs.includes(revision.evidenceId))
      .map((objective) => objective.objectiveId));
    nextAction = "repair_upstream";
    invalidatedPageIds = input.pageSpecs
      .filter((page) => page.objectiveIds.some((objectiveId) => affectedObjectiveIds.has(objectiveId)))
      .map((page) => page.pageId);
    invalidateSampleApproval = true;
    reasonCodes = ["evidence_binding_revised"];
  }

  invalidatedPageIds = sortPageIds([...new Set(invalidatedPageIds)]);
  invalidatedAssetIds = [...new Set(invalidatedAssetIds)].sort();
  reasonCodes = [...new Set(reasonCodes)].sort();
  const semanticImpact = {
    nextAction,
    invalidatedPageIds,
    invalidatedAssetIds,
    invalidateSampleApproval,
    invalidateReports: true as const,
    reasonCodes,
  };
  return { ...semanticImpact, impactDigest: hashRunInput(semanticImpact) };
}

function assertPageExists(pageId: string, pageIds: Set<string>) {
  if (!pageIds.has(pageId)) throw new Error(`Unknown pageId: ${pageId}`);
}

function sortPageIds(pageIds: string[]) {
  return pageIds.sort((left, right) => Number(left.replace("page_", "")) - Number(right.replace("page_", "")));
}
