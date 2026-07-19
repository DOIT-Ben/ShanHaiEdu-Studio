import { describe, expect, it, vi } from "vitest";

import { digestOrchestrationAuditEvent } from "@/server/conversation/orchestration-audit-event-digest";
import {
  evaluateOrchestrationIngressAudit,
  resolveOrchestrationIngressOperation,
  runWithOrchestrationIngressAudit,
  type OrchestrationIngressAuditEvent,
  type OrchestrationIngressAuditStore,
} from "@/server/workbench/orchestration-ingress-audit";

describe("VR-A13 authenticated workbench ingress audit", () => {
  it("uses the authoritative registry for every project write and excludes non-project writes", () => {
    const known = [
      ["POST", "/api/workbench/projects", "project_create"],
      ["PATCH", "/api/workbench/projects/project_1", "project_lifecycle_update"],
      ["POST", "/api/workbench/projects/project_1/artifacts", "teacher_artifact_create"],
      ["POST", "/api/workbench/projects/project_1/artifacts/artifact_1/approve", "artifact_approve"],
      ["POST", "/api/workbench/projects/project_1/artifacts/artifact_1/coze-ppt", "artifact_route_coze_ppt"],
      ["POST", "/api/workbench/projects/project_1/artifacts/artifact_1/image", "artifact_route_image"],
      ["POST", "/api/workbench/projects/project_1/artifacts/artifact_1/ppt-full-deck-review", "ppt_full_deck_review_submit"],
      ["POST", "/api/workbench/projects/project_1/artifacts/artifact_1/ppt-sample-review", "ppt_sample_review_submit"],
      ["POST", "/api/workbench/projects/project_1/artifacts/artifact_1/video", "artifact_route_video"],
      ["PATCH", "/api/workbench/projects/project_1/generation-intensity", "generation_intensity_update"],
      ["POST", "/api/workbench/projects/project_1/members", "project_member_add"],
      ["DELETE", "/api/workbench/projects/project_1/members/user_1", "project_member_remove"],
      ["PATCH", "/api/workbench/projects/project_1/members/user_1", "project_member_role_update"],
      ["POST", "/api/workbench/projects/project_1/messages", "teacher_message_submit"],
      ["POST", "/api/workbench/projects/project_1/messages/message_1/reaction", "message_reaction_set"],
    ] as const;

    expect(known).toHaveLength(15);
    for (const [method, pathname, operation] of known) {
      expect(resolveOrchestrationIngressOperation(new Request(`https://localhost${pathname}`, { method })))
        .toMatchObject({ operation, claimedProjectId: pathname === "/api/workbench/projects" ? null : "project_1" });
    }
    expect(resolveOrchestrationIngressOperation(new Request(
      "https://localhost/api/workbench/projects/project_1/agent-runs",
      { method: "POST" },
    ))).toMatchObject({
      operation: "unclassified_external",
      claimedProjectId: "project_1",
      controlImpact: "unclassified_external",
    });
    expect(resolveOrchestrationIngressOperation(new Request(
      "https://localhost/api/workbench/projects/project_1/new-write?source=main_agent",
      { method: "POST", headers: { "x-orchestration-source": "main_agent" } },
    ))).toEqual({
      operation: "unclassified_external",
      routeTemplate: "/api/workbench/projects/:unclassified",
      claimedProjectId: "project_1",
      controlImpact: "unclassified_external",
    });
    expect(resolveOrchestrationIngressOperation(new Request(
      "https://localhost/api/workbench/projects/project_1",
      { method: "GET" },
    ))).toBeNull();
    expect(resolveOrchestrationIngressOperation(new Request(
      "https://localhost/api/feedback",
      { method: "POST" },
    ))).toBeNull();
  });

  it("persists attempted before business and a project-bound committed terminal", async () => {
    const calls: string[] = [];
    const store = memoryStore((event) => calls.push(`audit:${event.recordType}`));
    const response = await runWithOrchestrationIngressAudit({
      request: new Request("https://localhost/api/workbench/projects", {
        method: "POST",
        headers: { "x-orchestration-source": "main_agent" },
        body: JSON.stringify({ source: "main_agent", secret: "must-not-persist" }),
      }),
      identity: identity(),
      store,
      handler: async () => {
        calls.push("business");
        return Response.json({ project: { id: "project_created" }, token: "must-not-persist" }, { status: 201 });
      },
      randomId: ids("attempt_1", "event_1", "event_2"),
      now: times("2026-07-18T00:00:00.000Z", "2026-07-18T00:00:01.000Z"),
    });

    expect(response.status).toBe(201);
    expect(calls).toEqual(["audit:attempted", "business", "audit:resolved"]);
    expect(store.events).toHaveLength(2);
    expect(store.events[0]).toMatchObject({
      attemptId: "attempt_1",
      sequence: 1,
      recordType: "attempted",
      operationKind: "external_mutation",
      authority: "teacher_http",
      claimedProjectId: null,
      resolvedProjectId: null,
      actorUserId: "teacher_1",
      actorAuthMode: "password",
      authSessionDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      outcome: null,
    });
    expect(store.events[1]).toMatchObject({
      attemptId: "attempt_1",
      sequence: 2,
      recordType: "resolved",
      outcome: "committed",
      resolvedProjectId: "project_created",
      reasonCode: "http_2xx",
    });
    expect(JSON.parse(store.events[1].payloadJson)).toEqual({
      schemaVersion: "orchestration-ingress-audit.v2",
      operation: "project_create",
      routeTemplate: "/api/workbench/projects",
      method: "POST",
      controlImpact: "teacher_write",
      httpStatus: 201,
    });
    expect(JSON.stringify(store.events)).not.toMatch(/must-not-persist|main_agent|x-orchestration-source|auth_session_1/);
    expect(evaluateOrchestrationIngressAudit(store.events)).toMatchObject({ go: true, openAttemptIds: [] });
    const reloadedWithDatabaseFieldOrder = store.events.map((event) => (
      Object.fromEntries(Object.entries(structuredClone(event)).reverse()) as OrchestrationIngressAuditEvent
    ));
    expect(evaluateOrchestrationIngressAudit(reloadedWithDatabaseFieldOrder)).toMatchObject({ go: true });
  });

  it("fails closed before business when attempted persistence fails", async () => {
    const handler = vi.fn(async () => new Response("created", { status: 201 }));
    const store: OrchestrationIngressAuditStore = {
      append: vi.fn(async () => { throw new Error("audit_unavailable"); }),
    };
    await expect(runWithOrchestrationIngressAudit({
      request: new Request("https://localhost/api/workbench/projects", { method: "POST" }),
      identity: identity(),
      store,
      handler,
    })).rejects.toThrow(/audit_unavailable/);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not return business success when terminal persistence fails", async () => {
    const store = memoryStore(undefined, 2);
    const handler = vi.fn(async () => Response.json({ status: "updated" }, { status: 200 }));
    await expect(runWithOrchestrationIngressAudit({
      request: new Request("https://localhost/api/workbench/projects/project_1", { method: "PATCH" }),
      identity: identity(),
      store,
      handler,
    })).rejects.toThrow(/audit_unavailable/);
    expect(handler).toHaveBeenCalledOnce();
    expect(store.events).toHaveLength(1);
    expect(evaluateOrchestrationIngressAudit(store.events)).toMatchObject({ go: false, openAttemptIds: [store.events[0].attemptId] });
  });

  it("leaves project creation open when a committed response has no valid project identity", async () => {
    const store = memoryStore();
    await expect(runWithOrchestrationIngressAudit({
      request: new Request("https://localhost/api/workbench/projects", { method: "POST" }),
      identity: identity(),
      store,
      handler: async () => Response.json({ status: "created" }, { status: 201 }),
    })).rejects.toThrow(/project_resolution_failed/);
    expect(store.events).toHaveLength(1);
    expect(evaluateOrchestrationIngressAudit(store.events).go).toBe(false);
  });

  it("binds a committed teacher submission to the response message identity", async () => {
    const store = memoryStore();
    await runWithOrchestrationIngressAudit({
      request: new Request("https://localhost/api/workbench/projects/project_1/messages", { method: "POST" }),
      identity: identity(),
      store,
      handler: async () => Response.json({ message: { id: "message_1" } }, { status: 202 }),
      randomId: ids("legacy_attempt_1", "v2_event_1", "v2_event_2"),
    });
    expect(store.events[0]).toMatchObject({ teacherMessageId: null, recordType: "attempted" });
    expect(store.events[1]).toMatchObject({ teacherMessageId: "message_1", recordType: "resolved", outcome: "committed" });
    expect(evaluateOrchestrationIngressAudit(store.events)).toMatchObject({ go: true });
  });

  it("keeps pre-v2 audit rows valid without accepting unsigned teacher-message bindings", () => {
    const legacy = legacyAuditPair();
    expect(evaluateOrchestrationIngressAudit(legacy)).toMatchObject({ go: true, resolvedCount: 1 });

    const injected = legacy.map((event, index) => index === 1
      ? { ...event, teacherMessageId: "unsigned_message" }
      : event);
    expect(evaluateOrchestrationIngressAudit(injected)).toMatchObject({
      go: false,
      invalidAttemptIds: ["legacy_attempt_1"],
    });
  });

  it("rejects v2 teacher-message tampering and mixed audit schema pairs", async () => {
    const store = memoryStore();
    await runWithOrchestrationIngressAudit({
      request: new Request("https://localhost/api/workbench/projects/project_1/messages", { method: "POST" }),
      identity: identity(),
      store,
      handler: async () => Response.json({ message: { id: "message_1" } }, { status: 202 }),
    });
    const tampered = store.events.map((event, index) => index === 1
      ? { ...event, teacherMessageId: "message_2" }
      : event);
    expect(evaluateOrchestrationIngressAudit(tampered)).toMatchObject({
      go: false,
      invalidAttemptIds: [store.events[0].attemptId],
    });

    const legacyAttempt = legacyAuditPair()[0];
    const mixed = [legacyAttempt, store.events[1]];
    expect(evaluateOrchestrationIngressAudit(mixed)).toMatchObject({
      go: false,
      invalidAttemptIds: [store.events[0].attemptId],
    });
  });

  it("rejects unsigned authority columns on an external audit event", async () => {
    const store = memoryStore();
    await runWithOrchestrationIngressAudit({
      request: new Request("https://localhost/api/workbench/projects/project_1", { method: "PATCH" }),
      identity: identity(),
      store,
      handler: async () => new Response(null, { status: 204 }),
    });
    const injected = store.events.map((event) => ({
      ...event,
      taskId: "injected_task",
      turnJobId: "injected_turn",
      toolInvocationId: "injected_tool",
    })) as OrchestrationIngressAuditEvent[];
    expect(evaluateOrchestrationIngressAudit(injected)).toMatchObject({
      go: false,
      invalidAttemptIds: [store.events[0].attemptId],
    });
  });

  it("cross-checks resolved outcome and reason against the persisted HTTP status", async () => {
    const store = memoryStore();
    await runWithOrchestrationIngressAudit({
      request: new Request("https://localhost/api/workbench/projects/project_1", { method: "PATCH" }),
      identity: identity(),
      store,
      handler: async () => new Response(null, { status: 500 }),
    });
    const forged = store.events.map((event, index) => {
      if (index === 0) return event;
      const changed = { ...event, outcome: "committed" as const, reasonCode: "http_2xx" as const };
      return { ...changed, eventDigest: currentV2IngressDigest(changed) };
    });
    expect(evaluateOrchestrationIngressAudit(forged)).toMatchObject({
      go: false,
      invalidAttemptIds: [store.events[0].attemptId],
    });
  });

  it("rejects an empty attempt identity even when both event digests are recomputed", async () => {
    const store = memoryStore();
    await runWithOrchestrationIngressAudit({
      request: new Request("https://localhost/api/workbench/projects/project_1", { method: "PATCH" }),
      identity: identity(),
      store,
      handler: async () => new Response(null, { status: 204 }),
    });
    const forged = store.events.map((event) => {
      const changed = { ...event, attemptId: "" };
      return { ...changed, eventDigest: currentV2IngressDigest(changed) };
    });
    expect(evaluateOrchestrationIngressAudit(forged)).toMatchObject({
      go: false,
      invalidAttemptIds: [""],
    });
  });

  it("does not return teacher submission success without a response message identity", async () => {
    const store = memoryStore();
    await expect(runWithOrchestrationIngressAudit({
      request: new Request("https://localhost/api/workbench/projects/project_1/messages", { method: "POST" }),
      identity: identity(),
      store,
      handler: async () => Response.json({ status: "queued" }, { status: 202 }),
    })).rejects.toThrow(/teacher_message_resolution_failed/);
    expect(store.events).toHaveLength(1);
    expect(evaluateOrchestrationIngressAudit(store.events)).toMatchObject({ go: false });
  });

  it("records rejected responses and thrown handlers without persisting private details", async () => {
    const rejected = memoryStore();
    await runWithOrchestrationIngressAudit({
      request: new Request("https://localhost/api/workbench/projects/project_1", { method: "PATCH" }),
      identity: identity(),
      store: rejected,
      handler: async () => Response.json({ error: "sensitive body" }, { status: 409 }),
    });
    expect(rejected.events.at(-1)).toMatchObject({
      recordType: "resolved",
      outcome: "rejected",
      resolvedProjectId: "project_1",
      reasonCode: "http_4xx",
    });
    expect(JSON.parse(rejected.events.at(-1)!.payloadJson).httpStatus).toBe(409);

    const failed = memoryStore();
    await expect(runWithOrchestrationIngressAudit({
      request: new Request("https://localhost/api/workbench/projects/project_1/messages", { method: "POST" }),
      identity: identity(),
      store: failed,
      handler: async () => { throw new Error("private provider error"); },
    })).rejects.toThrow(/private provider error/);
    expect(failed.events.at(-1)).toMatchObject({
      recordType: "resolved",
      outcome: "failed",
      resolvedProjectId: null,
      reasonCode: "handler_exception",
    });
    expect(JSON.stringify(failed.events)).not.toContain("private provider error");
  });

  it("rejects digest tampering in an otherwise complete attempt pair", async () => {
    const store = memoryStore();
    await runWithOrchestrationIngressAudit({
      request: new Request("https://localhost/api/workbench/projects/project_1", { method: "PATCH" }),
      identity: identity(),
      store,
      handler: async () => new Response(null, { status: 204 }),
    });
    store.events[1] = { ...store.events[1], eventDigest: "0".repeat(64) };
    expect(evaluateOrchestrationIngressAudit(store.events)).toMatchObject({
      go: false,
      invalidAttemptIds: [store.events[0].attemptId],
    });
  });
});

function identity() {
  return {
    actorUserId: "teacher_1",
    actorAuthMode: "password" as const,
    authSessionId: "auth_session_1",
  };
}

function memoryStore(
  onAppend: ((event: OrchestrationIngressAuditEvent) => void) | undefined = undefined,
  failAtAppend: number | undefined = undefined,
): OrchestrationIngressAuditStore & { events: OrchestrationIngressAuditEvent[] } {
  const events: OrchestrationIngressAuditEvent[] = [];
  let appendCount = 0;
  return {
    events,
    async append(event) {
      appendCount += 1;
      if (appendCount === failAtAppend) throw new Error("audit_unavailable");
      const stored = structuredClone({ ...event, sequence: events.length + 1 });
      events.push(stored);
      onAppend?.(stored);
      return stored;
    },
  };
}

function ids(...values: string[]) {
  let index = 0;
  return () => values[index++] ?? `id_${index}`;
}

function times(...values: string[]) {
  let index = 0;
  return () => new Date(values[index++] ?? values.at(-1));
}

function legacyAuditPair(): OrchestrationIngressAuditEvent[] {
  return [
    {
      sequence: 1,
      eventId: "legacy_event_1",
      attemptId: "legacy_attempt_1",
      recordType: "attempted",
      outcome: null,
      operationKind: "external_mutation",
      authority: "teacher_http",
      claimedProjectId: "project_1",
      resolvedProjectId: null,
      actorUserId: "teacher_1",
      actorAuthMode: "password",
      authSessionDigest: "6ba4e038655718b1ccf5a97f9dfeea2a2453dca4c1517d3a98fe2e4fca4caac1",
      teacherMessageId: null,
      reasonCode: null,
      payloadJson: "{\"operation\":\"teacher_message_submit\",\"routeTemplate\":\"/api/workbench/projects/:projectId/messages\",\"method\":\"POST\",\"controlImpact\":\"teacher_task_submission\",\"httpStatus\":null}",
      eventDigest: "7d310a7929c507b748c0e80d2d961cf223aab00b18c1bbc0cd198b333ab31a06",
      occurredAt: "2026-07-18T00:00:00.000Z",
    },
    {
      sequence: 2,
      eventId: "legacy_event_2",
      attemptId: "legacy_attempt_1",
      recordType: "resolved",
      outcome: "committed",
      operationKind: "external_mutation",
      authority: "teacher_http",
      claimedProjectId: "project_1",
      resolvedProjectId: "project_1",
      actorUserId: "teacher_1",
      actorAuthMode: "password",
      authSessionDigest: "6ba4e038655718b1ccf5a97f9dfeea2a2453dca4c1517d3a98fe2e4fca4caac1",
      teacherMessageId: null,
      reasonCode: "http_2xx",
      payloadJson: "{\"operation\":\"teacher_message_submit\",\"routeTemplate\":\"/api/workbench/projects/:projectId/messages\",\"method\":\"POST\",\"controlImpact\":\"teacher_task_submission\",\"httpStatus\":202}",
      eventDigest: "8b89f2bbebf7e56a6d277b1465449098f229ecd2b0941e5ce8560bec00b5a110",
      occurredAt: "2026-07-18T00:00:01.000Z",
    },
  ];
}

function currentV2IngressDigest(event: OrchestrationIngressAuditEvent) {
  return digestOrchestrationAuditEvent(event, "shanhai-orchestration-audit-event.v2");
}
