import { describe, expect, it } from "vitest";

import { buildConversationMessagePostBody, createWorkbenchApiClient } from "@/lib/workbench-api";

describe("conversation message submission boundary", () => {
  it("keeps reference text separate from artifact identity and carries one idempotency key", () => {
    const body = buildConversationMessagePostBody({
      body: "只调整第三页",
      reference: "资料《修改意见.txt》：第三页文字太多",
      artifactRefs: ["artifact-ppt-v3"],
      confirmedActionId: "human:project-1:repair:decision-1",
      idempotencyKey: "message:one-turn",
      responseStyle: "pragmatic",
    });

    expect(body).toEqual({
      role: "teacher",
      content: "只调整第三页",
      reference: "资料《修改意见.txt》：第三页文字太多",
      artifactRefs: ["artifact-ppt-v3"],
      confirmedActionId: "human:project-1:repair:decision-1",
      idempotencyKey: "message:one-turn",
      responseStyle: "pragmatic",
    });
    expect(body.artifactRefs).not.toContain(body.reference);
  });

  it("issues one message POST with the caller idempotency key", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createWorkbenchApiClient({
      fetcher: async (input, init) => {
        calls.push({ url: String(input), init });
        if (init?.method === "POST") return new Response(JSON.stringify({}), { status: 202, headers: { "content-type": "application/json" } });
        return new Response(JSON.stringify({
          project: { id: "project-1" },
          messages: [],
          artifacts: [],
          turnJobs: [],
          activeArtifactKey: "",
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    await client.submitConversationMessage("project-1", {
      body: "继续调整",
      reference: null,
      artifactRefs: ["artifact-1"],
      idempotencyKey: "message:project-1:turn-1",
    });

    const posts = calls.filter((call) => call.init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]?.init?.body))).toMatchObject({
      idempotencyKey: "message:project-1:turn-1",
      artifactRefs: ["artifact-1"],
    });
  });

  it("submits checkpoint recovery through the controlled message API without a second teacher message", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createWorkbenchApiClient({
      fetcher: async (input, init) => {
        calls.push({ url: String(input), init });
        if (init?.method === "POST") return new Response(JSON.stringify({}), { status: 202, headers: { "content-type": "application/json" } });
        return new Response(JSON.stringify({
          project: { id: "project-1" },
          messages: [],
          artifacts: [],
          turnJobs: [],
          activeArtifactKey: "",
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });

    await client.recoverConversationTurn("project-1", "checkpoint-1");

    const posts = calls.filter((call) => call.init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]?.init?.body))).toEqual({ recoveryCheckpointId: "checkpoint-1" });
  });
});
