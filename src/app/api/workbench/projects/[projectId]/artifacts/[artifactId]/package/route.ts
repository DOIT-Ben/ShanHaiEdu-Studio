import { NextResponse } from "next/server";
import { withLocalWorkbenchActor } from "@/server/auth/workbench-route";
import { materialPackageDownloadHeaders } from "@/server/package/artifact-package";
import { readPackageAssetBuffer } from "@/server/tools/package-tool-adapter";
import { prisma } from "@/server/db/client";

type RouteContext = {
  params: Promise<{ projectId: string; artifactId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  return withLocalWorkbenchActor(request, async ({ service }) => {
    try {
      const { projectId, artifactId } = await context.params;
      const finalDelivery = await service.getArtifact(projectId, artifactId);
      if (finalDelivery.kind !== "final_delivery" || finalDelivery.nodeKey !== "final_delivery") {
        throw new Error("not_final_delivery_artifact");
      }
      if (!hasPackageAsset(finalDelivery)) throw new Error("stored_package_asset_not_found");
      const invocation = await prisma.toolInvocationRecord.findFirst({
        where: {
          projectId,
          artifactId,
          status: "succeeded",
          toolName: "create_final_package",
          observationId: { not: null },
          finishedAt: { not: null },
        },
        orderBy: { finishedAt: "desc" },
        select: {
          invocationId: true,
          projectId: true,
          taskId: true,
          intentEpoch: true,
          planRevision: true,
          toolName: true,
          executionEnvelopeJson: true,
          idempotencyKey: true,
          status: true,
          artifactId: true,
          observationId: true,
          finishedAt: true,
          observations: {
            select: {
              observationId: true,
              projectId: true,
              taskId: true,
              invocationId: true,
              intentEpoch: true,
              status: true,
              artifactId: true,
            },
          },
        },
      });
      const observation = invocation?.observations.find(
        (candidate) => candidate.observationId === invocation.observationId,
      ) ?? null;
      const storedPackage = await readPackageAssetBuffer(finalDelivery, invocation, observation);
      return new Response(toArrayBuffer(storedPackage.buffer), {
        status: 200,
        headers: materialPackageDownloadHeaders(storedPackage.filename),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Material package download failed";
      const status = message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: "这个材料包暂时没有生成成功，请稍后再试。" }, { status });
    }
  });
}

function hasPackageAsset(artifact: { structuredContent: Record<string, unknown> }) {
  const storage = artifact.structuredContent.storage;
  if (!storage || typeof storage !== "object" || Array.isArray(storage)) {
    return false;
  }
  const packageAsset = (storage as { packageAsset?: unknown }).packageAsset;
  return Boolean(packageAsset && typeof packageAsset === "object" && !Array.isArray(packageAsset));
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}
