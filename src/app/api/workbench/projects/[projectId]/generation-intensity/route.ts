import { NextResponse } from "next/server";

import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import {
  createGenerationIntensityConfirmationAction,
  isValidGenerationIntensityConfirmationAction,
} from "@/server/generation-intensity/generation-intensity-confirmation";
import { generationIntensityIds, type GenerationIntensity } from "@/server/generation-intensity/generation-intensity-policy";

type RouteContext = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId } = await context.params;
      const project = await service.getProject(projectId);
      return NextResponse.json({
        generationIntensity: project.generationIntensity,
        intensityVersion: project.intensityVersion,
      });
    } catch {
      return NextResponse.json({ error: "生成强度暂时没有取回，请稍后再试。" }, { status: 404 });
    }
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    const { projectId } = await context.params;
    try {
      const body = await parseRequest(request);
      const project = await service.getProject(projectId);
      if (project.intensityVersion !== body.expectedVersion) {
        return NextResponse.json({ error: "生成强度已变化，请刷新后再操作。", code: "intensity_version_conflict", project }, { status: 409 });
      }
      if (body.intensity === "extreme" && !isValidGenerationIntensityConfirmationAction({
        actionId: body.confirmationActionId,
        projectId,
        expectedVersion: body.expectedVersion,
        target: body.intensity,
      })) {
        return NextResponse.json({
          project,
          confirmationRequired: true,
          actionId: createGenerationIntensityConfirmationAction({ projectId, expectedVersion: body.expectedVersion, target: body.intensity }),
        }, { status: 202 });
      }
      const updated = await service.updateProjectGenerationIntensity(projectId, body);
      return NextResponse.json({ project: updated });
    } catch (error) {
      const conflict = error instanceof Error && /version conflict/i.test(error.message);
      return NextResponse.json(
        { error: conflict ? "生成强度已变化，请刷新后再操作。" : "生成强度暂时没有更新，请稍后再试。", ...(conflict ? { code: "intensity_version_conflict" } : {}) },
        { status: conflict ? 409 : 400 },
      );
    }
  });
}

async function parseRequest(request: Request): Promise<{
  intensity: GenerationIntensity;
  expectedVersion: number;
  confirmationActionId?: string;
}> {
  const value = await request.json() as Record<string, unknown>;
  if (!value || typeof value !== "object" || !generationIntensityIds.includes(value.intensity as GenerationIntensity)) throw new Error("Invalid intensity");
  if (!Number.isInteger(value.expectedVersion) || (value.expectedVersion as number) < 0) throw new Error("Invalid version");
  return {
    intensity: value.intensity as GenerationIntensity,
    expectedVersion: value.expectedVersion as number,
    ...(typeof value.confirmationActionId === "string" ? { confirmationActionId: value.confirmationActionId } : {}),
  };
}
