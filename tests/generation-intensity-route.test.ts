import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  project: { id: "project-1", generationIntensity: "standard" as string, intensityVersion: 0 },
  updates: [] as Array<{ intensity: string; expectedVersion: number }>,
}));

vi.mock("@/server/auth/workbench-route", () => ({
  withLocalWorkbenchActor: async (_request: Request, handler: (input: { service: typeof service }) => Promise<Response>) => handler({ service }),
}));

const service = {
  async getProject() { return { ...state.project }; },
  async updateProjectGenerationIntensity(_projectId: string, input: { intensity: string; expectedVersion: number }) {
    state.updates.push(input);
    state.project = { ...state.project, generationIntensity: input.intensity, intensityVersion: input.expectedVersion + 1 };
    return { ...state.project };
  },
};

import { PATCH } from "@/app/api/workbench/projects/[projectId]/generation-intensity/route";

describe("V1-5 generation intensity route", () => {
  beforeEach(() => {
    state.project = { id: "project-1", generationIntensity: "standard", intensityVersion: 0 };
    state.updates.length = 0;
  });

  it("updates ordinary levels immediately", async () => {
    const response = await patch({ intensity: "enhanced", expectedVersion: 0 });
    expect(response.status).toBe(200);
    expect(state.updates).toEqual([{ intensity: "enhanced", expectedVersion: 0 }]);
  });

  it("requires a version-bound confirmation before extreme", async () => {
    const pending = await patch({ intensity: "extreme", expectedVersion: 0 });
    const body = await pending.json() as { actionId: string };
    expect(pending.status).toBe(202);
    expect(state.updates).toEqual([]);

    const confirmed = await patch({ intensity: "extreme", expectedVersion: 0, confirmationActionId: body.actionId });
    expect(confirmed.status).toBe(200);
    expect(state.updates).toEqual([expect.objectContaining({ intensity: "extreme", expectedVersion: 0 })]);

    const replay = await patch({ intensity: "extreme", expectedVersion: 0, confirmationActionId: body.actionId });
    expect(replay.status).toBe(409);
    expect(state.updates).toHaveLength(1);
  });
});

function patch(body: Record<string, unknown>) {
  return PATCH(new Request("http://localhost/api/workbench/projects/project-1/generation-intensity", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ projectId: "project-1" }) });
}
