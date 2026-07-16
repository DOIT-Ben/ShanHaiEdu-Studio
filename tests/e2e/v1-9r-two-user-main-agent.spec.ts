import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { loginThroughApi, teacherCredentials, type E2ECredentials } from "./support/feedback";

const secondTeacherCredentials: E2ECredentials = {
  email: process.env.M67_E2E_SECOND_TEACHER_EMAIL ?? "m67-teacher-b@example.test",
  password: process.env.M67_E2E_SECOND_TEACHER_PASSWORD ?? "M67 second teacher password 2026!",
};
const activeTurnStatuses = new Set(["queued", "running"]);
const deterministicFixture = process.env.M67_E2E_DETERMINISTIC === "1";

test.describe("V1-9R two-user Main Agent black-box", () => {
  test("keeps autonomous task scope, intensity, and artifacts isolated across two invited teachers", async ({ browser }, testInfo) => {
    test.skip(deterministicFixture, "V1-9R5 requires the real Main Agent runtime; deterministic fixtures cannot satisfy this gate.");
    test.setTimeout(1_500_000);
    const viewport = testInfo.project.name === "chromium-narrow"
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 };
    const teacherA = await createTeacherProject(browser, teacherCredentials, "R5-A 投篮命中率公开课", viewport);
    const teacherB = await createTeacherProject(browser, secondTeacherCredentials, "R5-B 机械信标脚本", viewport);

    try {
      const pptGoal = "请做五年级数学百分数公开课完整材料包，包括教案、约 10 页 PPT、课堂图片、A 侧投篮命中率独立创意导入视频和最终整包。课程锚点只做与课程任务之间的最小回接。";
      const scriptGoal = "只做五年级数学百分数公开课的 B 侧机械信标独立创意导入视频脚本，不做 PPT，不生成图片或成片，也不打包。课程锚点只做与课程任务之间的最小回接。";
      await Promise.all([
        sendTeacherPrompt(teacherA.page, pptGoal),
        sendTeacherPrompt(teacherB.page, scriptGoal),
      ]);

      const [snapshotA, snapshotB] = await Promise.all([
        waitForTurnSettlement(teacherA.context.request, teacherA.projectId, 1, "teacher-a"),
        waitForTurnSettlement(teacherB.context.request, teacherB.projectId, 1, "teacher-b"),
      ]);
      writeSanitizedRuntimeEvidence(snapshotA, snapshotB, testInfo.project.name);

      const teacherMessageA = latestTeacherMessage(snapshotA);
      const teacherMessageB = latestTeacherMessage(snapshotB);
      expect(teacherMessageA.metadata.taskBrief).toMatchObject({
        goal: expect.stringContaining("A 侧投篮命中率"),
        requestedOutputs: expect.arrayContaining(["lesson_plan", "ppt", "image", "video", "package"]),
        excludedOutputs: [],
      });
      expect(teacherMessageA.metadata.taskBrief.requestedOutputs).toHaveLength(5);
      expect(teacherMessageA.metadata.intentGrant).toMatchObject({ standardWorkAuthorized: true, projectId: teacherA.projectId });
      expect(teacherMessageB.metadata.taskBrief).toMatchObject({
        goal: expect.stringContaining("B 侧机械信标"),
        requestedOutputs: ["video_script"],
        excludedOutputs: expect.arrayContaining(["ppt", "image", "video", "package"]),
      });
      expect(teacherMessageB.metadata.intentGrant).toMatchObject({ standardWorkAuthorized: true, projectId: teacherB.projectId });

      expect(snapshotA.artifacts.filter((artifact) => artifact.kind === "requirement_spec")).toHaveLength(1);
      expect(JSON.stringify(snapshotA.artifacts)).not.toContain("deterministic_draft");
      expect(JSON.stringify(snapshotB.artifacts)).not.toContain("deterministic_draft");
      expect(snapshotA.messages.some((message) => message.metadata.orchestrationMode === "fixed_delivery_plan_fallback")).toBe(false);
      expect(artifactKinds(snapshotA)).toEqual(expect.arrayContaining(["requirement_spec"]));
      expect(snapshotA.generationJobs).toHaveLength(0);
      expectDynamicMainAgentTrajectory(snapshotA);
      expectHonestFailureRecovery(snapshotA);

      expect(artifactKinds(snapshotB)).toEqual(expect.arrayContaining([
        "requirement_spec",
        "creative_theme_generate",
        "video_script_generate",
      ]));
      expect(pendingDecisions(snapshotB)).toHaveLength(0);
      expectDynamicMainAgentTrajectory(snapshotB);
      const teacherBReplies = snapshotB.messages
        .filter((message) => message.role === "assistant")
        .map((message) => message.content)
        .join("\n");
      expect(teacherBReplies).not.toMatch(/请(?:补充|确认)[^。]*(?:年级|课题)|还缺少已确认的[^。]*(?:年级|课题)/);
      expect(snapshotB.artifacts.some((artifact) => ["lesson_plan", "ppt_draft", "ppt_design_draft", "pptx_artifact", "image_prompts", "video_segment_generate", "concat_only_assemble", "final_delivery"].includes(artifact.kind))).toBe(false);
      expect(snapshotB.generationJobs).toHaveLength(0);
      expect(pendingDecisionReasonCodes(snapshotA)).toEqual(expect.not.arrayContaining(["missing_grant", "grant_scope_mismatch"]));
      expect(pendingDecisionReasonCodes(snapshotB)).toEqual(expect.not.arrayContaining(["missing_grant", "grant_scope_mismatch"]));

      const oneSentenceProjectId = await createProjectForTeacher(
        teacherA.context.request,
        teacherA.csrfToken,
        "R5-A 一句话PPT候选",
      );
      await teacherA.page.reload();
      await selectProjectFromWorkbench(teacherA.page, oneSentenceProjectId, viewport);
      await sendTeacherPrompt(teacherA.page, "请做五年级数学百分数公开课PPT，用投篮命中率导入，约10页。");
      const oneSentencePpt = await waitForTurnSettlement(teacherA.context.request, oneSentenceProjectId, 1, "teacher-a-one-sentence-ppt");
      expect(latestTeacherMessage(oneSentencePpt).metadata.taskBrief).toMatchObject({
        requestedOutputs: ["ppt"],
        goal: expect.stringContaining("投篮命中率"),
      });
      expect(artifactKinds(oneSentencePpt)).toEqual(expect.arrayContaining(["ppt_design_draft"]));
      expect(artifactKinds(oneSentencePpt)).not.toEqual(expect.arrayContaining(["pptx_artifact", "image_prompts", "video_segment_generate", "concat_only_assemble", "final_delivery"]));
      expect(oneSentencePpt.generationJobs).toHaveLength(0);
      expect(JSON.stringify(oneSentencePpt.artifacts)).not.toContain("deterministic_draft");
      expectDynamicMainAgentTrajectory(oneSentencePpt);

      await sendTeacherPrompt(teacherB.page, "把独立创意改成 B 侧机械信标故障，不要投篮方案，只做视频脚本。");
      const redirectedB = await waitForTurnSettlement(teacherB.context.request, teacherB.projectId, 2, "teacher-b-redirect");
      expect(latestTeacherMessage(redirectedB).metadata.taskBrief).toMatchObject({
        goal: expect.stringContaining("B 侧机械信标故障"),
        requestedOutputs: ["video_script"],
      });
      expect(JSON.stringify(redirectedB)).not.toContain("A 侧投篮命中率");

      const intensityResponse = await teacherA.context.request.patch(`/api/workbench/projects/${teacherA.projectId}/generation-intensity`, {
        headers: { "x-shanhai-csrf": teacherA.csrfToken },
        data: { intensity: "deep", expectedVersion: snapshotA.project.intensityVersion },
      });
      expect(intensityResponse.status(), await intensityResponse.text()).toBe(200);
      await teacherA.page.reload();
      await selectProjectFromWorkbench(teacherA.page, teacherA.projectId, viewport);
      await expect(teacherA.page.getByRole("button", { name: "选择生成强度" })).toContainText("深度");
      const unchangedB = await readSnapshot(teacherB.context.request, teacherB.projectId);
      expect(unchangedB.project.generationIntensity).toBe("standard");

      expect((await teacherA.context.request.get(`/api/workbench/projects/${teacherB.projectId}/snapshot`)).status()).not.toBe(200);
      expect((await teacherB.context.request.get(`/api/workbench/projects/${teacherA.projectId}/snapshot`)).status()).not.toBe(200);
      expect(await visibleProjectIds(teacherA.context.request)).not.toContain(teacherB.projectId);
      expect(await visibleProjectIds(teacherB.context.request)).not.toContain(teacherA.projectId);

      await Promise.all([teacherA.page.reload(), teacherB.page.reload()]);
      await Promise.all([
        selectProjectFromWorkbench(teacherA.page, teacherA.projectId, viewport),
        selectProjectFromWorkbench(teacherB.page, teacherB.projectId, viewport),
      ]);
      await expect(teacherA.page.getByText("A 侧投篮命中率", { exact: false }).first()).toBeVisible();
      await expect(teacherB.page.getByText("B 侧机械信标故障", { exact: false }).first()).toBeVisible();
      await Promise.all([assertLatestMessageClearsComposer(teacherA.page), assertLatestMessageClearsComposer(teacherB.page)]);
      const visibleText = `${await teacherA.page.locator("main").innerText()}\n${await teacherB.page.locator("main").innerText()}`;
      expect(visibleText).not.toMatch(/\*\*|^##\s|\b(provider|schema|node_id|runtimeKind|local path)\b/im);

      const outputDir = path.resolve(process.cwd(), "output", "playwright");
      fs.mkdirSync(outputDir, { recursive: true });
      await Promise.all([
        teacherA.page.screenshot({ path: path.join(outputDir, `v1-9r-two-user-a-${testInfo.project.name}.png`), fullPage: true }),
        teacherB.page.screenshot({ path: path.join(outputDir, `v1-9r-two-user-b-${testInfo.project.name}.png`), fullPage: true }),
      ]);
    } finally {
      await Promise.all([teacherA.context.close(), teacherB.context.close()]);
    }
  });
});

test.describe("V1-9R offline control-plane contract fixture", () => {
  test("keeps offline task semantics, redirects, and two-user state isolated without claiming real-agent success", async ({ browser }, testInfo) => {
    test.skip(!deterministicFixture, "This contract fixture only runs with the explicitly enabled deterministic E2E runtime.");
    test.setTimeout(180_000);
    const viewport = testInfo.project.name === "chromium-narrow"
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 };
    const teacherA = await createTeacherProject(browser, teacherCredentials, "OFFLINE-A 一句话PPT合同", viewport);
    const teacherB = await createTeacherProject(browser, secondTeacherCredentials, "OFFLINE-B 局部视频脚本合同", viewport);

    try {
      await Promise.all([
        sendTeacherPrompt(teacherA.page, "请做五年级数学百分数公开课PPT，用投篮命中率导入，约10页。"),
        sendTeacherPrompt(teacherB.page, "只做五年级数学百分数的独立创意导入视频脚本，用机械信标故障制造悬念；不做教案、PPT、图片、成片或整包。"),
      ]);
      const [initialA, initialB] = await Promise.all([
        waitForTurnSettlement(teacherA.context.request, teacherA.projectId, 1, "offline-teacher-a"),
        waitForTurnSettlement(teacherB.context.request, teacherB.projectId, 1, "offline-teacher-b"),
      ]);

      expect(latestTeacherMessage(initialA).metadata.taskBrief).toMatchObject({
        requestedOutputs: ["ppt"],
        goal: expect.stringContaining("投篮命中率"),
      });
      expect(latestTeacherMessage(initialB).metadata.taskBrief).toMatchObject({
        requestedOutputs: ["video_script"],
        excludedOutputs: expect.arrayContaining(["lesson_plan", "ppt", "image", "video", "package"]),
        goal: expect.stringContaining("机械信标故障"),
      });
      expect(pendingDecisions(initialB)).toHaveLength(0);
      expectOfflineFixtureOnly(initialA);
      expectOfflineFixtureOnly(initialB);

      const previousIntentEpoch = initialB.project.intentEpoch;
      await sendTeacherPrompt(teacherB.page, "改道：仍然只做局部视频脚本，但独立创意改成无人灯塔的错误信号；不要沿用机械信标方案。");
      const redirectedB = await waitForTurnSettlement(teacherB.context.request, teacherB.projectId, 2, "offline-teacher-b-redirect");
      const redirectedMessage = latestTeacherMessage(redirectedB);
      expect(redirectedB.project.intentEpoch).toBe(previousIntentEpoch + 1);
      expect(redirectedMessage.metadata).toMatchObject({
        taskBrief: {
          intentEpoch: previousIntentEpoch + 1,
          requestedOutputs: ["video_script"],
          goal: expect.stringContaining("无人灯塔"),
        },
        intentGrant: { intentEpoch: previousIntentEpoch + 1 },
        conversationControlImpact: {
          previousIntentEpoch,
          nextIntentEpoch: previousIntentEpoch + 1,
          reasonCode: "teacher_redirected_without_pending_plan",
        },
      });
      expect(pendingDecisions(redirectedB)).toHaveLength(0);
      expectOfflineFixtureOnly(redirectedB);
      const redirectedAssistant = redirectedB.messages.filter((message) => message.role === "assistant").at(-1);
      expect(redirectedAssistant?.content).not.toMatch(/先不急着生成材料|补充年级、学科和课题/);
      expect(redirectedAssistant?.metadata.agentObservations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          status: "succeeded",
          actionKey: "requirement_spec:requirement_spec",
          reasonCodes: expect.arrayContaining(["validation_passed"]),
        }),
      ]));

      expect((await teacherA.context.request.get(`/api/workbench/projects/${teacherB.projectId}/snapshot`)).status()).not.toBe(200);
      expect((await teacherB.context.request.get(`/api/workbench/projects/${teacherA.projectId}/snapshot`)).status()).not.toBe(200);
      expect(await visibleProjectIds(teacherA.context.request)).not.toContain(teacherB.projectId);
      expect(await visibleProjectIds(teacherB.context.request)).not.toContain(teacherA.projectId);
      expect(JSON.stringify(initialA)).not.toContain("无人灯塔");
      expect(JSON.stringify(redirectedB)).not.toContain("投篮命中率");

      await Promise.all([teacherA.page.reload(), teacherB.page.reload()]);
      await Promise.all([
        selectProjectFromWorkbench(teacherA.page, teacherA.projectId, viewport),
        selectProjectFromWorkbench(teacherB.page, teacherB.projectId, viewport),
      ]);
      await expect(teacherA.page.getByText("投篮命中率", { exact: false }).first()).toBeVisible();
      await expect(teacherB.page.getByText("无人灯塔", { exact: false }).first()).toBeVisible();
      await Promise.all([assertLatestMessageClearsComposer(teacherA.page), assertLatestMessageClearsComposer(teacherB.page)]);

      writeSanitizedOfflineEvidence(initialA, redirectedB, testInfo.project.name);
      const outputDir = path.resolve(process.cwd(), "output", "playwright");
      fs.mkdirSync(outputDir, { recursive: true });
      await Promise.all([
        teacherA.page.screenshot({ path: path.join(outputDir, `v1-9r-offline-contract-a-${testInfo.project.name}.png`), fullPage: true }),
        teacherB.page.screenshot({ path: path.join(outputDir, `v1-9r-offline-contract-b-${testInfo.project.name}.png`), fullPage: true }),
      ]);
    } finally {
      await Promise.all([teacherA.context.close(), teacherB.context.close()]);
    }
  });
});

async function createTeacherProject(
  browser: Browser,
  credentials: E2ECredentials,
  title: string,
  viewport: { width: number; height: number },
) {
  const context = await browser.newContext({ viewport });
  const csrfToken = await loginThroughApi(context.request, credentials);
  const response = await context.request.post("/api/workbench/projects", {
    headers: { "x-shanhai-csrf": csrfToken },
    data: { title, grade: "五年级", subject: "数学", lessonTopic: "百分数" },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = await response.json() as { project: { id: string } };
  const page = await context.newPage();
  await page.goto("/");
  try {
    await selectProjectFromWorkbench(page, body.project.id, viewport);
  } catch (error) {
    const outputDir = path.resolve(process.cwd(), "output", "playwright");
    fs.mkdirSync(outputDir, { recursive: true });
    await page.screenshot({ path: path.join(outputDir, `v1-9r-project-entry-${viewport.width}.png`), fullPage: true });
    throw error;
  }
  return { context, page, csrfToken, projectId: body.project.id };
}

async function createProjectForTeacher(api: APIRequestContext, csrfToken: string, title: string) {
  const response = await api.post("/api/workbench/projects", {
    headers: { "x-shanhai-csrf": csrfToken },
    data: { title, grade: "五年级", subject: "数学", lessonTopic: "百分数" },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = await response.json() as { project: { id: string } };
  return body.project.id;
}

async function selectProjectFromWorkbench(page: Page, projectId: string, viewport: { width: number; height: number }) {
  if (viewport.width < 1024) {
    await page.getByRole("button", { name: "项目", exact: true }).click();
  }
  const projectRow = page.locator(`[data-project-id="${projectId}"]:visible`);
  await expect(projectRow).toBeVisible();
  await projectRow.getByRole("button").first().click();
  await expect(page.getByLabel(/输入备课要求|正在生成中，也可以继续输入下一步要求/)).toBeVisible();
}

async function assertLatestMessageClearsComposer(page: Page) {
  await expect.poll(async () => page.evaluate(() => {
    const anchor = document.querySelector<HTMLElement>("[data-chat-scroll-anchor]");
    const composer = document.querySelector<HTMLElement>("[data-composer-surface]");
    if (!composer) return false;
    const composerTop = composer.getBoundingClientRect().top;
    if (anchor) return anchor.getBoundingClientRect().bottom <= composerTop;

    const assistantViewport = document.querySelector<HTMLElement>("[data-assistant-ui-scroll-viewport]");
    const messages = assistantViewport?.querySelectorAll<HTMLElement>("[data-message-role]");
    const latestMessage = messages?.item((messages?.length ?? 0) - 1);
    if (!assistantViewport || !latestMessage) return false;
    const latestBounds = latestMessage.getBoundingClientRect();
    const viewportBounds = assistantViewport.getBoundingClientRect();
    return latestBounds.bottom <= composerTop && latestBounds.bottom >= viewportBounds.top;
  }), { timeout: 8_000, intervals: [100, 250, 500] }).toBe(true);
}

async function sendTeacherPrompt(page: Page, content: string) {
  const composer = page.getByLabel(/输入备课要求|正在生成中，也可以继续输入下一步要求/);
  await composer.fill(content);
  await page.getByRole("button", { name: /发送|加入队列/ }).click();
  await expect(page.getByText(content, { exact: true })).toBeVisible();
}

async function waitForTurnSettlement(api: APIRequestContext, projectId: string, expectedTeacherMessages = 1, evidenceLabel = "project") {
  await expect.poll(async () => {
    const snapshot = await readSnapshot(api, projectId);
    writeSanitizedLiveEvidence(snapshot, evidenceLabel);
    const teacherMessages = snapshot.messages.filter((message) => message.role === "teacher").length;
    const activeJobs = snapshot.turnJobs.filter((job) => activeTurnStatuses.has(job.status)).length;
    return `${teacherMessages >= expectedTeacherMessages}:${snapshot.turnJobs.length >= expectedTeacherMessages}:${activeJobs}`;
  }, { timeout: 1_080_000, intervals: [500, 1000, 2000] }).toBe("true:true:0");
  return readSnapshot(api, projectId);
}

async function readSnapshot(api: APIRequestContext, projectId: string): Promise<WorkbenchSnapshot> {
  const response = await api.get(`/api/workbench/projects/${projectId}/snapshot`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json() as Promise<WorkbenchSnapshot>;
}

async function visibleProjectIds(api: APIRequestContext) {
  const response = await api.get("/api/workbench/projects?view=active");
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json() as { projects: Array<{ id: string }> };
  return body.projects.map((project) => project.id);
}

function latestTeacherMessage(snapshot: WorkbenchSnapshot) {
  const message = [...snapshot.messages].reverse().find((candidate) => candidate.role === "teacher");
  expect(message).toBeDefined();
  return message!;
}

function pendingDecisionReasonCodes(snapshot: WorkbenchSnapshot) {
  return pendingDecisions(snapshot)
    .map((decision) => decision.reasonCode)
    .filter((reasonCode): reasonCode is string => typeof reasonCode === "string");
}

function pendingDecisions(snapshot: WorkbenchSnapshot) {
  return snapshot.messages.flatMap((message) => {
    const plan = isRecord(message.metadata.pendingDeliveryPlan) ? message.metadata.pendingDeliveryPlan : null;
    const decision = plan && isRecord(plan.pendingDecision) ? plan.pendingDecision : null;
    return decision && decision.status === "pending" ? [decision] : [];
  });
}

function artifactKinds(snapshot: WorkbenchSnapshot) {
  return snapshot.artifacts.map((artifact) => artifact.kind);
}

function expectDynamicMainAgentTrajectory(snapshot: WorkbenchSnapshot) {
  const orchestrationModes = snapshot.messages
    .map((message) => message.metadata.orchestrationMode)
    .filter((value): value is string => typeof value === "string");
  const exposureEvents = snapshot.messages.flatMap((message) => Array.isArray(message.metadata.mainAgentToolExposureTrace)
    ? message.metadata.mainAgentToolExposureTrace.filter(isRecord)
    : []);
  const actionKeys = snapshot.messages.flatMap((message) => Array.isArray(message.metadata.agentObservations)
    ? message.metadata.agentObservations
        .filter(isRecord)
        .map((observation) => observation.actionKey)
        .filter((value): value is string => typeof value === "string")
    : []);
  expect(exposureEvents.some((event) => event.event === "tools_exposed")).toBe(true);
  expect(exposureEvents.some((event) => event.event === "tool_selected")).toBe(true);
  expect(new Set(actionKeys).size).toBeGreaterThan(0);
  expect(orchestrationModes).not.toContain("fixed_delivery_plan_fallback");
  expect(JSON.stringify(snapshot.messages.map((message) => message.metadata))).not.toMatch(/externalCodexOrchestration|codexOrchestrationIntervention/i);
}

function expectHonestFailureRecovery(snapshot: WorkbenchSnapshot) {
  if (!snapshot.turnJobs.some((job) => job.status === "failed")) return;
  const checkpoints = snapshot.messages
    .map((message) => message.metadata.agentRunCheckpoint)
    .filter(isRecord);
  expect(checkpoints).toEqual(expect.arrayContaining([
    expect.objectContaining({
      status: "paused",
      reason: expect.stringMatching(/repeated_failure|budget_exhausted/),
      observationRefs: expect.any(Array),
    }),
  ]));
  expect(JSON.stringify(snapshot.artifacts)).not.toMatch(/deterministic_draft|degraded/i);
}

function expectOfflineFixtureOnly(snapshot: WorkbenchSnapshot) {
  const productionArtifactKinds = [
    "pptx_artifact",
    "image_prompts",
    "asset_image_generate",
    "video_segment_generate",
    "concat_only_assemble",
    "final_delivery",
  ];
  expect(snapshot.generationJobs).toHaveLength(0);
  expect(snapshot.artifacts.some((artifact) => productionArtifactKinds.includes(artifact.kind))).toBe(false);
  expect(snapshot.artifacts.every((artifact) => (
    isRecord(artifact.structuredContent)
    && artifact.structuredContent.generationMode === "deterministic_draft"
    && artifact.structuredContent.providerStatus === "deterministic_draft"
  ))).toBe(true);
  const metadata = JSON.stringify(snapshot.messages.map((message) => message.metadata));
  expect(metadata).not.toMatch(/fixed_delivery_plan_fallback|degraded/i);
  expect(metadata).not.toMatch(/externalCodexOrchestration|codexOrchestrationIntervention/i);
}

function writeSanitizedRuntimeEvidence(snapshotA: WorkbenchSnapshot, snapshotB: WorkbenchSnapshot, projectName: string) {
  const evidencePath = path.resolve(evidenceRoot(), "v1-9r-two-user-runtime-evidence.json");
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify({
    capturedAt: new Date().toISOString(),
    projectName,
    teacherA: summarizeRuntimeSnapshot(snapshotA),
    teacherB: summarizeRuntimeSnapshot(snapshotB),
  }, null, 2) + "\n", "utf8");
}

function writeSanitizedOfflineEvidence(snapshotA: WorkbenchSnapshot, snapshotB: WorkbenchSnapshot, projectName: string) {
  const evidencePath = path.resolve(evidenceRoot(), `v1-9r-offline-control-plane-${projectName}.json`);
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify({
    evidenceKind: "offline-deterministic-control-plane-contract-only",
    doesNotProve: ["real-main-agent", "R5-complete", "real-provider", "production-artifact"],
    capturedAt: new Date().toISOString(),
    projectName,
    externalCodexOrchestrationInterventions: 0,
    teacherA: summarizeRuntimeSnapshot(snapshotA),
    teacherB: summarizeRuntimeSnapshot(snapshotB),
  }, null, 2) + "\n", "utf8");
}

function writeSanitizedLiveEvidence(snapshot: WorkbenchSnapshot, label: string) {
  const safeLabel = label.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
  const evidencePath = path.resolve(evidenceRoot(), `v1-9r-live-${safeLabel}.json`);
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify({
    capturedAt: new Date().toISOString(),
    snapshot: summarizeRuntimeSnapshot(snapshot),
  }, null, 2) + "\n", "utf8");
}

function evidenceRoot() {
  return process.env.M67_E2E_EVIDENCE_DIR
    ? path.resolve(process.env.M67_E2E_EVIDENCE_DIR)
    : path.resolve(process.cwd(), "test-results");
}

function summarizeRuntimeSnapshot(snapshot: WorkbenchSnapshot) {
  return {
    externalCodexOrchestrationInterventions: 0,
    artifacts: snapshot.artifacts.map((artifact) => ({
      kind: artifact.kind,
      status: artifact.status,
      qualityState: isRecord(artifact.structuredContent) && isRecord(artifact.structuredContent.artifactQualityState)
        ? artifact.structuredContent.artifactQualityState
        : null,
    })),
    messages: snapshot.messages.map((message) => {
      const pendingPlan = isRecord(message.metadata.pendingDeliveryPlan) ? message.metadata.pendingDeliveryPlan : null;
      const toolPlan = pendingPlan && isRecord(pendingPlan.toolPlan) ? pendingPlan.toolPlan : null;
      return {
        role: message.role,
        content: sanitizeEvidenceText(message.content),
        taskBrief: isRecord(message.metadata.taskBrief) ? {
          schemaVersion: message.metadata.taskBrief.schemaVersion,
          taskId: message.metadata.taskBrief.taskId,
          intentEpoch: message.metadata.taskBrief.intentEpoch,
          goal: typeof message.metadata.taskBrief.goal === "string" ? sanitizeEvidenceText(message.metadata.taskBrief.goal) : null,
          requestedOutputs: message.metadata.taskBrief.requestedOutputs,
          excludedOutputs: message.metadata.taskBrief.excludedOutputs,
          digest: message.metadata.taskBrief.digest,
        } : null,
        intentGrant: isRecord(message.metadata.intentGrant) ? {
          schemaVersion: message.metadata.intentGrant.schemaVersion,
          taskId: message.metadata.intentGrant.taskId,
          intentEpoch: message.metadata.intentGrant.intentEpoch,
          standardWorkAuthorized: message.metadata.intentGrant.standardWorkAuthorized,
          intensity: message.metadata.intentGrant.intensity,
          budgetPolicyVersion: message.metadata.intentGrant.budgetPolicyVersion,
          maxCostCredits: message.metadata.intentGrant.maxCostCredits,
          maxExternalProviderCalls: message.metadata.intentGrant.maxExternalProviderCalls,
        } : null,
        orchestrationMode: typeof message.metadata.orchestrationMode === "string" ? message.metadata.orchestrationMode : null,
        pendingPlan: pendingPlan ? {
          status: typeof pendingPlan.status === "string" ? pendingPlan.status : null,
          runtimeKind: typeof pendingPlan.runtimeKind === "string" ? pendingPlan.runtimeKind : null,
          capabilityId: toolPlan && typeof toolPlan.capabilityId === "string" ? toolPlan.capabilityId : null,
          pendingDecision: isRecord(pendingPlan.pendingDecision) ? {
            kind: pendingPlan.pendingDecision.kind,
            reasonCode: pendingPlan.pendingDecision.reasonCode,
            status: pendingPlan.pendingDecision.status,
          } : null,
        } : null,
        completionContract: isRecord(message.metadata.completionContract) ? message.metadata.completionContract : null,
        mainAgentToolExposureTrace: Array.isArray(message.metadata.mainAgentToolExposureTrace)
          ? message.metadata.mainAgentToolExposureTrace.map((event) => isRecord(event) ? {
              sequence: event.sequence,
              event: event.event,
              intentEpoch: event.intentEpoch,
              allowedToolNames: Array.isArray(event.allowedToolNames)
                ? event.allowedToolNames.filter((value) => typeof value === "string").slice(0, 32)
                : [],
              selectedToolName: typeof event.selectedToolName === "string" ? event.selectedToolName : null,
              rejectionReason: typeof event.rejectionReason === "string" ? event.rejectionReason : null,
            } : null)
          : [],
        mainAgentReActContextTelemetry: Array.isArray(message.metadata.mainAgentReActContextTelemetry)
          ? message.metadata.mainAgentReActContextTelemetry.map((event) => isRecord(event) ? {
              phase: event.phase,
              toolRound: event.toolRound,
              requestCharacters: event.requestCharacters,
              estimatedInputTokens: event.estimatedInputTokens,
              checkpointCharacters: event.checkpointCharacters,
              checkpointObservationCount: event.checkpointObservationCount,
              toolCount: event.toolCount,
              responseDurationMs: event.responseDurationMs,
            } : null)
          : [],
        agentRunCheckpoint: isRecord(message.metadata.agentRunCheckpoint) ? {
          status: message.metadata.agentRunCheckpoint.status,
          reason: message.metadata.agentRunCheckpoint.reason,
          actionKey: message.metadata.agentRunCheckpoint.actionKey,
          observationRefs: Array.isArray(message.metadata.agentRunCheckpoint.observationRefs)
            ? message.metadata.agentRunCheckpoint.observationRefs.slice(0, 32)
            : [],
        } : null,
        agentObservations: Array.isArray(message.metadata.agentObservations)
          ? message.metadata.agentObservations.map((observation) => isRecord(observation) ? {
              status: observation.status,
              actionKey: observation.actionKey,
              reasonCodes: observation.reasonCodes,
              minimalNextAction: observation.minimalNextAction,
            } : null)
          : [],
        agentToolReports: Array.isArray(message.metadata.agentToolReports)
          ? message.metadata.agentToolReports.map((report) => isRecord(report) ? {
              toolId: report.toolId,
              status: report.status,
              assistantSummary: typeof report.assistantSummary === "string" ? sanitizeEvidenceText(report.assistantSummary) : null,
              decision: isRecord(report.structuredOutput) && typeof report.structuredOutput.decision === "string"
                ? report.structuredOutput.decision
                : null,
              nextToolIntents: isRecord(report.structuredOutput) && Array.isArray(report.structuredOutput.nextToolIntents)
                ? report.structuredOutput.nextToolIntents.filter((value) => typeof value === "string").slice(0, 12)
                : [],
            } : null)
          : [],
      };
    }),
    turnJobs: snapshot.turnJobs.map((job) => ({
      status: job.status,
      errorCode: job.errorCode ?? null,
    })),
    generationJobs: snapshot.generationJobs.map((job) => ({ status: job.status })),
  };
}

function sanitizeEvidenceText(value: string) {
  return value
    .replace(/Bearer\s+[^\s,;]+/gi, "[redacted]")
    .replace(/\b(api[_-]?key|credential|token|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/https?:\/\/[^\s,;)]+/gi, "[redacted-url]")
    .slice(0, 600);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type WorkbenchSnapshot = {
  project: { id: string; intentEpoch: number; generationIntensity: string; intensityVersion: number };
  messages: Array<{ role: string; content: string; metadata: Record<string, any> }>;
  artifacts: Array<{ id: string; kind: string; status: string; structuredContent?: unknown }>;
  generationJobs: Array<{ status: string }>;
  turnJobs: Array<{ status: string; errorCode?: string | null }>;
};
