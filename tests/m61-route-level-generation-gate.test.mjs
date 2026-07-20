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
    const source = [
      readSource(routeCase.routePath),
      ...(routeCase.label === "video"
        ? [readSource("src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/video/video-route-generation.ts")]
        : []),
    ].join("\n");
    const guardIndex = source.indexOf("assertRouteLevelGenerationConfirmation({");
    const createJobIndex = source.indexOf("createGenerationJob");
    const commitResultIndex = source.indexOf("await commitArtifactRouteToolSuccess({");

    assert.match(source, /assertRouteLevelGenerationConfirmation/,
      `${routeCase.label} route must use a route-level PlanGuard/HumanGate helper`);
    assert.match(source, new RegExp(`capabilityId:\\s*"${routeCase.capabilityId}"`),
      `${routeCase.label} route must bind the guard to the server-side capability id`);
    assert.match(source, /confirmedActionId:\s*readConfirmedActionId\(body\)/,
      `${routeCase.label} route must accept body.confirmedActionId/actionId through a shared parser`);
    assert.ok(guardIndex >= 0 && createJobIndex >= 0 && guardIndex < createJobIndex,
      `${routeCase.label} route must guard before creating a generation job`);
    assert.ok(guardIndex >= 0 && commitResultIndex >= 0 && guardIndex < commitResultIndex,
      `${routeCase.label} route must guard before the control-plane atomic result commit`);
    assert.match(source, /runWithProjectExecutionLease/,
      `${routeCase.label} route must hold a project execution lease across generation`);
    assert.match(source, /claimArtifactRouteToolExecution/,
      `${routeCase.label} route must claim a validated ExecutionEnvelope before Tool execution`);
    assert.doesNotMatch(source, /commitGenerationResult|resumeStagedGenerationResult/,
      `${routeCase.label} route must not bypass Invocation\/Observation\/Event with the legacy generation commit`);
    assert.doesNotMatch(source, /expectedActionId\s*[:=]\s*body\./,
      `${routeCase.label} route must not let the same request self-provide expectedActionId`);
  }
});
