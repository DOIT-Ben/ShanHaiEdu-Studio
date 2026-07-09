import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function readSource(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

const routeCases = [
  {
    label: "Coze PPTX",
    routePath: "src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/coze-ppt/route.ts",
    capabilityId: "coze_ppt",
  },
  {
    label: "image",
    routePath: "src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/image/route.ts",
    capabilityId: "image_asset",
  },
  {
    label: "video",
    routePath: "src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/video/route.ts",
    capabilityId: "video_segment_generate",
  },
];

test("M61 real generation routes require route-level PlanGuard/HumanGate before jobs or artifacts", () => {
  for (const routeCase of routeCases) {
    const source = readSource(routeCase.routePath);
    const guardIndex = source.indexOf("assertRouteLevelGenerationConfirmation({");
    const createJobIndex = source.indexOf("createGenerationJob");
    const saveArtifactIndex = source.indexOf("saveArtifact");

    assert.match(source, /assertRouteLevelGenerationConfirmation/,
      `${routeCase.label} route must use a route-level PlanGuard/HumanGate helper`);
    assert.match(source, new RegExp(`capabilityId:\\s*"${routeCase.capabilityId}"`),
      `${routeCase.label} route must bind the guard to the server-side capability id`);
    assert.match(source, /confirmedActionId:\s*readConfirmedActionId\(body\)/,
      `${routeCase.label} route must accept body.confirmedActionId/actionId through a shared parser`);
    assert.ok(guardIndex >= 0 && createJobIndex >= 0 && guardIndex < createJobIndex,
      `${routeCase.label} route must guard before creating a generation job`);
    assert.ok(guardIndex >= 0 && saveArtifactIndex >= 0 && guardIndex < saveArtifactIndex,
      `${routeCase.label} route must guard before saving generated artifacts`);
    assert.doesNotMatch(source, /expectedActionId\s*[:=]\s*body\./,
      `${routeCase.label} route must not let the same request self-provide expectedActionId`);
  }
});
