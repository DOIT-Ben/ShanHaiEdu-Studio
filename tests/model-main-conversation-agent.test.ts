import { describe, expect, it, vi } from "vitest";
import {
  createMainConversationAgentFromEnv,
  OpenAIMainConversationAgent,
  resolveMainAgentTimeoutMs,
  resolveMainAgentToolControlPlane,
} from "@/server/conversation/model-main-conversation-agent";
import { createDeterministicMainConversationAgent } from "@/server/conversation/main-conversation-agent";
import type { MainConversationAgentInput } from "@/server/conversation/main-conversation-agent";
import type { OpenAIResponsesClient } from "@/server/agent-runtime/openai-runtime";
import { createTaskBrief } from "@/server/conversation/task-contract";

describe("M55-C model-first main conversation agent", () => {
  it("returns a typed recoverable failure when the selected Responses channel is blocked", async () => {
    const client = {
      responses: {
        async create() {
          throw new Error("403 Your request was blocked.");
        },
      },
    } as OpenAIResponsesClient;
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({ userMessage: "请完成百分数PPT", availableArtifactKinds: [] });

    expect(turn).toMatchObject({
      state: "failed_retryable",
      failure: {
        phase: "direct_response",
        reasonCode: "main_agent_provider_policy_blocked",
        category: "provider_policy",
        retryability: "after_provider_health_change",
      },
    });
    expect(JSON.stringify(turn.failure)).not.toMatch(/api[_-]?key|credential|token|secret|https?:\/\//i);
  });

  it("distinguishes a Responses timeout from a policy block", async () => {
    const client = {
      responses: {
        async create() {
          throw new Error("Request timed out after 180000ms");
        },
      },
    } as OpenAIResponsesClient;
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({ userMessage: "请完成百分数PPT", availableArtifactKinds: [] });

    expect(turn.failure).toMatchObject({
      reasonCode: "main_agent_provider_timeout",
      category: "timeout",
      retryability: "retryable",
    });
  });

  it("keeps the Main Agent prompt domain-neutral and delegates delivery specifics to registered Tools", async () => {
    const client = fakeResponsesClient({
      assistantMessage: { body: "我会先根据当前材料判断下一步。" },
      state: "chatting", quickReplies: [], recommendedOptions: [], shouldRunToolNow: false,
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    await agent.respond({ userMessage: "继续", availableArtifactKinds: [] });

    expect(client.lastPayload?.instructions).toContain("高层业务 Tool");
    expect(client.lastPayload?.instructions).toContain("每次 Tool 返回后");
    expect(client.lastPayload?.instructions).not.toMatch(/PPT质量主线|课程锚点|video_segment_generate|classroomRunSpecDraft|final_package/);
  });

  it("passes TaskBrief and IntentGrant while separating routine confirmation from semantic collaboration", async () => {
    const client = fakeResponsesClient({
      assistantMessage: { body: "继续处理任务。" },
      state: "chatting", quickReplies: [], recommendedOptions: [], shouldRunToolNow: false,
      toolPlan: null,
      deliveryPlan: null,
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });
    const taskBrief = createTaskBrief({
      taskId: "task-native-contract",
      projectId: "project-native-contract",
      intentEpoch: 0,
      goal: "请做五年级数学百分数公开课PPT。",
      requestedOutputs: ["ppt"],
      constraints: [],
      excludedOutputs: [],
      generationIntensity: "standard",
      sourceMessageId: "message-native-contract",
    });
    const intentGrant = {
      schemaVersion: "intent-grant.v1" as const,
      taskId: taskBrief.taskId,
      projectId: taskBrief.projectId,
      intentEpoch: 0,
      standardWorkAuthorized: true,
      intensity: "standard" as const,
      budgetPolicyVersion: "v1-standard",
      maxCostCredits: null,
      maxExternalProviderCalls: null,
      requiredCheckpoints: [],
      expiresAt: null,
    };

    await agent.respond({
      userMessage: taskBrief.goal,
      availableArtifactKinds: [],
      taskBrief,
      intentGrant,
      agentToolLoop: {
        tools: [{ type: "function", name: "create_requirement_spec" }],
        allowedToolNames: ["create_requirement_spec"],
        dispatch: async () => ({ status: "succeeded", observation: { status: "succeeded", reasonCodes: ["ok"] } }),
      },
    } as MainConversationAgentInput);

    expect(client.lastPayload?.instructions).toContain("标准授权不等于禁止语义校准");
    expect(client.lastPayload?.instructions).toContain("request_teacher_decision");
    expect(client.lastPayload?.instructions).toContain("边界清晰时不要例行询问");
    expect(client.lastPayload?.instructions).not.toContain("标准范围内不得要求教师再次确认");
    expect(client.lastPayload?.instructions).toContain("不得要求教师回复“继续”");
    expect(client.lastPayload?.instructions).toContain("重试预算耗尽时诚实暂停");
    expect(JSON.parse(client.lastPayload?.input as string)).toMatchObject({
      taskBrief: { digest: taskBrief.digest, requestedOutputs: ["ppt"] },
      intentGrant: { taskId: taskBrief.taskId, standardWorkAuthorized: true },
    });
  });

  it("repairs an incomplete no-Tool response by requiring the product Main Agent to choose an available capability", async () => {
    const outputs = [
      {
        assistantMessage: { body: "当前步骤完成。" },
        state: "chatting",
        quickReplies: [],
        recommendedOptions: [],
        shouldRunToolNow: false,
      },
      {
        assistantMessage: { body: "继续整理教案。" },
        state: "running_tool",
        quickReplies: [],
        recommendedOptions: [],
        shouldRunToolNow: true,
        toolPlan: {
          capabilityId: "lesson_plan",
          reasonForUser: "继续整理教案。",
          missingInputs: [],
          nextSuggestedCapabilities: [],
          requiresConfirmation: false,
          inputDraft: { teacherGoal: null, notes: null, classroomRunSpecDraft: null },
        },
        deliveryPlan: { mode: "none" },
      },
    ];
    const payloads: Array<Record<string, any>> = [];
    const client = {
      responses: {
        async create(payload: Record<string, any>) {
          payloads.push(payload);
          return { output_text: JSON.stringify(outputs.shift()) };
        },
      },
    } as OpenAIResponsesClient;
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({
      userMessage: "请完成百分数公开课教案。",
      availableArtifactKinds: ["requirement_spec"],
      conversationContext: {
        recentMessages: [],
        capabilityAvailability: [
          { capabilityId: "lesson_plan", status: "available", requiresConfirmation: true, missingApprovedInputs: [], reasonForModel: "available", reasonForUser: "可以继续。" },
        ],
      },
      replanDirective: {
        reason: "completion_contract_unsatisfied",
        previousActionKey: "requirement_spec:requirement_spec",
        observationIds: ["observation-1"],
        remainingRequestedOutputs: ["lesson_plan"],
      },
    });

    expect(payloads).toHaveLength(2);
    expect(payloads[1].instructions).toContain("完成合同修复请求");
    expect(payloads[1].text.format.schema.properties.toolPlan).toMatchObject({
      type: "object",
      properties: { capabilityId: { enum: ["lesson_plan"] } },
    });
    expect(turn).toMatchObject({
      state: "running_tool",
      shouldRunToolNow: true,
      toolPlan: { capabilityId: "lesson_plan" },
    });
  });

  it("repairs a validation-failure question with reliable defaults instead of asking for known lesson details again", async () => {
    const outputs = [
      {
        assistantMessage: { body: "请补充教材版本、页码和例题照片。" },
        state: "needs_input",
        quickReplies: [],
        recommendedOptions: [],
        shouldRunToolNow: false,
      },
      {
        assistantMessage: { body: "我会沿用已知年级、课题和约 10 页要求，修正输入后重新生成大纲。" },
        state: "running_tool",
        quickReplies: [],
        recommendedOptions: [],
        shouldRunToolNow: true,
        toolPlan: {
          capabilityId: "ppt_outline",
          reasonForUser: "修正输入后重新生成大纲。",
          missingInputs: [],
          nextSuggestedCapabilities: [],
          requiresConfirmation: false,
          inputDraft: {
            teacherGoal: "五年级数学百分数公开课，约 10 页",
            targetPageCount: 10,
            reliableDefaultPolicy: "use_general_curriculum_context",
          },
        },
        deliveryPlan: { mode: "none" },
      },
    ];
    const payloads: Array<Record<string, any>> = [];
    const client = {
      responses: {
        async create(payload: Record<string, any>) {
          payloads.push(payload);
          return { output_text: JSON.stringify(outputs.shift()) };
        },
      },
    } as OpenAIResponsesClient;
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({
      userMessage: "请做五年级数学百分数公开课完整材料包，包括约 10 页 PPT。",
      availableArtifactKinds: ["requirement_spec", "lesson_plan"],
      projectContext: { grade: "五年级", subject: "数学", topic: "百分数" },
      conversationContext: {
        recentMessages: [],
        capabilityAvailability: [
          { capabilityId: "ppt_outline", status: "available", requiresConfirmation: true, missingApprovedInputs: [], reasonForModel: "available", reasonForUser: "可以继续。" },
        ],
      },
      replanDirective: {
        reason: "tool_failed",
        previousActionKey: "ppt_outline:ppt_draft",
        observationIds: ["observation-ppt-outline"],
        repairAction: "fix_inputs",
        reliableDefaultsAvailable: true,
      },
    });

    expect(payloads).toHaveLength(2);
    expect(payloads[1].instructions).toContain("可靠默认");
    expect(payloads[1].instructions).toContain("不得再次询问教师");
    expect(payloads[1].text.format.schema.properties.toolPlan).toMatchObject({
      type: "object",
      properties: { capabilityId: { enum: ["ppt_outline"] } },
    });
    expect(turn).toMatchObject({
      state: "running_tool",
      shouldRunToolNow: true,
      toolPlan: {
        capabilityId: "ppt_outline",
        inputDraft: expect.objectContaining({ targetPageCount: 10 }),
      },
    });
  });

  it("keeps a greeting short and does not start a delivery plan", async () => {
    const client = fakeResponsesClient({
      assistantMessage: {
        body: "你好，我在。你今天想准备哪一节课？",
      },
      state: "chatting",
      quickReplies: [],
      recommendedOptions: [],
      shouldRunToolNow: false,
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({ userMessage: "你好", availableArtifactKinds: [] });

    expect(client.lastPayload?.instructions).toContain("轻量问候");
    expect(turn.assistantMessage.body).toBe("你好，我在。你今天想准备哪一节课？");
    expect(turn.toolPlan).toBeUndefined();
    expect(turn.deliveryPlan).toBeUndefined();
    expect(turn.shouldRunToolNow).toBe(false);
  });

  it("reports a sanitized direct adapter failure without exposing it to the teacher", async () => {
    const unsafeUrl = ["https:", "", "private.example", "v1", "responses"].join("/");
    const unsafeCredential = ["sk", "test-only-value"].join("-");
    const client = {
      responses: { async create() { throw new Error(`request failed at ${unsafeUrl} Bearer ${unsafeCredential}`); } },
    } as OpenAIResponsesClient;
    const diagnostics: unknown[] = [];
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model", onFailureDiagnostic: (event) => diagnostics.push(event) });
    const turn = await agent.respond({ userMessage: "五年级数学百分数", availableArtifactKinds: [] });
    expect(turn).toMatchObject({ state: "failed_retryable", assistantMessage: { body: expect.stringContaining("智能生成服务暂时不可用") } });
    expect(diagnostics).toEqual([expect.objectContaining({ phase: "direct_response", reason: "adapter_failed", errorName: "MainAgentExecutionError" })]);
    expect(JSON.stringify(diagnostics)).not.toContain(unsafeUrl);
    expect(JSON.stringify(diagnostics)).not.toContain(unsafeCredential);
  });

  it.each([
    ["bad_json", "{not-json"],
    ["missing_field", JSON.stringify({ state: "chatting" })],
    ["validation_failed", JSON.stringify({ assistantMessage: { body: "收到" }, state: "invalid_state" })],
  ] as const)("classifies Main Agent %s output failures without executing a Tool", async (reason, outputText) => {
    const client = { responses: { async create() { return { output_text: outputText }; } } } as OpenAIResponsesClient;
    const diagnostics: unknown[] = [];
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model", onFailureDiagnostic: (event) => diagnostics.push(event) });

    const turn = await agent.respond({ userMessage: "请做五年级数学百分数 PPT", availableArtifactKinds: [] });

    expect(turn).toMatchObject({ state: "failed_retryable", shouldRunToolNow: false, runtimeKind: "openai" });
    expect(turn.toolPlan).toBeUndefined();
    expect(diagnostics).toEqual([expect.objectContaining({ phase: "output_parse", reason })]);
  });

  it("uses the same short greeting in deterministic fallback mode", async () => {
    const turn = await createDeterministicMainConversationAgent().respond({ userMessage: "你好", availableArtifactKinds: [] });

    expect(turn.assistantMessage.body).toBe("你好，我是小酷。你今天想准备哪一节课？告诉我年级和课题就可以开始。");
    expect(turn.quickReplies).toEqual([]);
    expect(turn.toolPlan).toBeUndefined();
    expect(turn.deliveryPlan).toBeUndefined();
    expect(turn.shouldRunToolNow).toBe(false);
  });

  it("passes arbitrary short teacher input to the model instead of blocking it with deterministic gates", async () => {
    const client = fakeResponsesClient({
      assistantMessage: {
        body: "收到：三年级数学。我先和你确认一下课题，你想做哪个知识点？如果你愿意，我也可以推荐几个适合公开课的主题。",
      },
      state: "collecting_inputs",
      quickReplies: [
        { label: "推荐课题", prompt: "你推荐一个三年级数学公开课课题。", recommended: true },
        { label: "周长", prompt: "三年级数学周长，帮我做公开课完整材料包。" },
      ],
      recommendedOptions: [],
      shouldRunToolNow: false,
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({ userMessage: "三年级 数学", availableArtifactKinds: [] });

    expect(client.lastPayload?.input).toContain("三年级 数学");
    expect(turn).toMatchObject({
      state: "collecting_inputs",
      runtimeKind: "openai",
      shouldRunToolNow: false,
      assistantMessage: {
        body: expect.stringContaining("三年级数学"),
      },
    });
    expect(turn.toolPlan).toBeUndefined();
  });

  it("lets structured intake decide an active-task redirect instead of using a server text rule", async () => {
    const payloads: Record<string, any>[] = [];
    const client = {
      responses: {
        async create(payload: Record<string, any>) {
          payloads.push(payload);
          return {
            output_text: "",
            output: [{
              id: "item-revise-active-task",
              type: "function_call",
              call_id: "call-revise-active-task",
              name: "revise_active_task",
              arguments: JSON.stringify({
                goal: "只做独立创意导入视频脚本",
                requestedOutputs: ["video_script"],
                constraints: ["独立创意短片", "只保留最小课程锚点"],
                excludedOutputs: ["lesson_plan", "ppt", "image", "video", "package"],
              }),
            }],
          };
        },
      },
    } as OpenAIResponsesClient;
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const decision = await agent.intakeTask!({
      userMessage: "改成只做独立创意导入视频脚本，不做 PPT 和成片。",
      generationIntensity: "standard",
      projectContext: { grade: "五年级", subject: "数学", topic: "百分数" },
      activeTask: {
        taskId: "task-active",
        digest: "a".repeat(64),
        intentEpoch: 0,
        goal: "制作百分数公开课 PPT",
        requestedOutputs: ["ppt"],
        constraints: [],
        excludedOutputs: [],
      },
      recentMessages: [],
    });

    expect(payloads[0].tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "revise_active_task" }),
      expect.objectContaining({ name: "submit_conversation_control" }),
    ]));
    expect(JSON.parse(payloads[0].input)).toMatchObject({ activeTask: { taskId: "task-active", intentEpoch: 0 } });
    expect(decision).toMatchObject({
      kind: "control",
      control: { kind: "redirect", advanceIntentEpoch: true },
      replacementProposal: { requestedOutputs: ["video_script"] },
    });
  });

  it("lets structured intake preserve a local PPT outline as the requested endpoint", async () => {
    const payloads: Record<string, any>[] = [];
    const client = {
      responses: {
        async create(payload: Record<string, any>) {
          payloads.push(payload);
          return {
            output_text: "",
            output: [{
              id: "item-submit-local-ppt-outline",
              type: "function_call",
              call_id: "call-submit-local-ppt-outline",
              name: "submit_task_brief",
              arguments: JSON.stringify({
                goal: "只做PPT结构候选",
                requestedOutputs: ["ppt_outline"],
                constraints: ["约10页"],
                excludedOutputs: ["ppt_design", "ppt_sample_assets", "ppt_key_samples", "ppt", "image", "video", "package"],
              }),
            }],
          };
        },
      },
    } as OpenAIResponsesClient;
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const decision = await agent.intakeTask!({
      userMessage: "只做PPT结构候选，不要设计、图片或PPTX。",
      generationIntensity: "standard",
      projectContext: { grade: "五年级", subject: "数学", topic: "百分数" },
      recentMessages: [],
    });

    const submitTool = payloads[0].tools.find((tool: { name?: string }) => tool.name === "submit_task_brief");
    expect(submitTool.parameters.properties.requestedOutputs.items.enum).toEqual(expect.arrayContaining([
      "ppt_outline", "ppt_design", "ppt_sample_assets", "ppt_key_samples", "ppt",
      "video_script", "storyboard", "asset_brief",
    ]));
    expect(payloads[0].instructions).toContain("ppt_outline");
    expect(decision).toMatchObject({
      kind: "task",
      proposal: {
        requestedOutputs: ["ppt_outline"],
        excludedOutputs: ["image", "package", "ppt", "ppt_design", "ppt_key_samples", "ppt_sample_assets", "video"],
      },
    });
  });

  it("keeps an ambiguous direction discussion as conversation so the Main Agent can ask", async () => {
    const client = {
      responses: {
        async create() {
          return { output_text: "你是在比较两种方向，还是希望我现在停止 PPT 并改做视频脚本？", output: [] };
        },
      },
    } as OpenAIResponsesClient;
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const decision = await agent.intakeTask!({
      userMessage: "如果改成视频脚本会不会更好？",
      generationIntensity: "standard",
      projectContext: {},
      activeTask: {
        taskId: "task-active",
        digest: "b".repeat(64),
        intentEpoch: 0,
        goal: "制作 PPT",
        requestedOutputs: ["ppt"],
        constraints: [],
        excludedOutputs: [],
      },
      recentMessages: [],
    });

    expect(decision).toMatchObject({
      kind: "conversation",
      turn: { assistantMessage: { body: expect.stringContaining("还是希望我现在") } },
    });
  });

  it("keeps primary school as a product bias without turning it into a capability gate", async () => {
    const client = fakeResponsesClient({
      assistantMessage: {
        title: "可以，先确认 PPT 需求",
        body: "当然可以。你可以直接这样回复：七年级数学，《有理数的加法》，新授课，约20页，简洁课堂风。",
      },
      state: "collecting_inputs",
      quickReplies: [],
      recommendedOptions: [],
      shouldRunToolNow: false,
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({ userMessage: "帮我做小学课件 PPT", availableArtifactKinds: [] });

    expect(client.lastPayload?.instructions).toContain("默认角色语境偏向小学");
    expect(client.lastPayload?.instructions).toContain("不是年级、学科或学段的能力门禁");
    expect(client.lastPayload?.instructions).not.toMatch(/只服务小学|不要生成初中|先限定在小学/);
    expect(turn.state).toBe("collecting_inputs");
    expect(turn.assistantMessage.body).toContain("七年级数学");
    expect(turn.assistantMessage.body).toContain("有理数的加法");
    expect(turn.toolPlan).toBeUndefined();
    expect(turn.shouldRunToolNow).toBe(false);
  });

  it("passes a junior-high delivery request to the model and preserves its selected business Tool", async () => {
    const client = fakeResponsesClient({
      assistantMessage: {
        body: "可以，我来为你整理七年级数学《有理数的加法》PPT。",
      },
      state: "awaiting_confirmation",
      quickReplies: [{ label: "确认开始", prompt: "确认开始。", recommended: true }],
      recommendedOptions: [],
      shouldRunToolNow: false,
      toolPlan: {
        capabilityId: "ppt_outline",
        reasonForUser: "我可以先为你生成 PPT 大纲。",
        missingInputs: [],
        nextSuggestedCapabilities: ["ppt_design"],
        requiresConfirmation: true,
      },
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({ userMessage: "帮我做七年级数学有理数的加法 PPT", availableArtifactKinds: [] });

    expect(client.lastPayload?.input).toContain("七年级数学有理数的加法");
    expect(turn.state).toBe("awaiting_confirmation");
    expect(turn.assistantMessage.body).toContain("七年级数学");
    expect(turn.toolPlan).toMatchObject({ capabilityId: "ppt_outline" });
    expect(turn.shouldRunToolNow).toBe(false);
  });

  it("passes recent conversation and pending plan context to the model", async () => {
    const client = fakeResponsesClient({
      assistantMessage: { body: "收到，我会结合上一轮计划判断。" },
      state: "needs_input",
      quickReplies: [],
      recommendedOptions: [],
      shouldRunToolNow: false,
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    await agent.respond({
      userMessage: "开始。",
      availableArtifactKinds: [],
      conversationContext: {
        latestAssistantContent: "开始整理《观潮》第一课时备课需求",
        recentMessages: [
          { role: "assistant", content: "开始整理《观潮》第一课时备课需求" },
          { role: "teacher", content: "开始。" },
        ],
        pendingDeliveryPlan: {
          teacherRequest: "四年级语文《观潮》第一课时",
          toolPlan: {
            planId: "requirement_spec:test",
            capabilityId: "requirement_spec",
            reasonForUser: "我可以先整理备课需求。",
            internalReason: "test",
            inputDraft: { teacherGoal: "四年级语文《观潮》第一课时" },
            missingInputs: [],
            upstreamPlan: [],
            nextSuggestedCapabilities: ["lesson_plan"],
            requiresConfirmation: true,
            expectedArtifactKind: "requirement_spec",
          },
        },
      },
    });

    expect(client.lastPayload?.input).toContain("pendingDeliveryPlan");
    expect(client.lastPayload?.input).toContain("开始整理《观潮》第一课时备课需求");
  });

  it("passes the full ContextPackage boundary to the model request", async () => {
    const client = fakeResponsesClient({
      assistantMessage: { body: "我会只使用已确认产物继续判断。" },
      state: "needs_input",
      quickReplies: [],
      recommendedOptions: [],
      shouldRunToolNow: false,
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    await agent.respond({
      userMessage: "继续下一步",
      availableArtifactKinds: ["requirement_spec", "ppt_draft"],
      conversationContext: {
        recentMessages: [{ role: "teacher", content: "继续下一步" }],
        agentWorldState: {
          project: {
            id: "project-main-context",
            title: "五年级百分数公开课",
            grade: "五年级",
            subject: "数学",
            textbookVersion: null,
            lessonTopic: "百分数",
            status: "active",
          },
          currentNodeKey: "ppt_draft",
          trustedInputs: [{ id: "artifact-approved", nodeKey: "requirement_spec", kind: "requirement_spec", title: "需求规格", status: "approved", summary: "已由教师确认", isApproved: true, version: 1 }],
          draftArtifacts: [{ id: "artifact-draft", nodeKey: "ppt_draft", kind: "ppt_draft", title: "PPT 大纲", status: "needs_review", summary: "待教师审阅", isApproved: false, version: 1 }],
          blockedItems: [],
          failedJobs: [],
          toolObservations: [],
          agentObservations: [],
          runCheckpoint: null,
          pendingPlan: null,
          nextRisks: [],
        },
        capabilityAvailability: [
          {
            capabilityId: "lesson_plan",
            status: "available",
            requiresConfirmation: true,
            missingApprovedInputs: [],
            reasonForModel: "available",
            reasonForUser: "前置成果已确认，可以继续，执行前仍需教师确认。",
          },
          {
            capabilityId: "asset_image_generate",
            status: "provider_unavailable",
            requiresConfirmation: true,
            missingApprovedInputs: [],
            reasonForModel: "not currently executable",
            reasonForUser: "这项生成能力暂时不可用，可以稍后重试。",
          },
        ],
        contextPackage: {
          mode: "snapshot",
          project: {
            id: "project-main-context",
            title: "五年级百分数公开课",
            grade: "五年级",
            subject: "数学",
            textbookVersion: null,
            lessonTopic: "百分数",
            currentNodeKey: "ppt_draft",
          },
          workflowNodes: [
            { key: "requirement_spec", title: "需求规格", status: "approved", approvedArtifactId: "artifact-approved", staleReason: null },
            { key: "ppt_draft", title: "PPT 大纲", status: "needs_review", approvedArtifactId: null, staleReason: null },
          ],
          sessionSummary: "## Objective\n- 五年级百分数公开课。",
          recentMessages: [
            { id: "message-1", role: "teacher", content: "继续下一步", artifactRefs: [], createdAt: "2026-07-09T00:00:00.000Z" },
          ],
          artifacts: [
            { id: "artifact-approved", nodeKey: "requirement_spec", kind: "requirement_spec", title: "需求规格", status: "approved", summary: "已由教师确认", isApproved: true, version: 1 },
            { id: "artifact-draft", nodeKey: "ppt_draft", kind: "ppt_draft", title: "PPT 大纲", status: "needs_review", summary: "待教师审阅", isApproved: false, version: 1 },
          ],
          guardrails: ["只有 approved artifact 可作为下游可信输入。"],
          summaryValidation: { status: "passed", errors: [] },
          tokenEstimate: 1234,
        },
      },
    });

    const requestInput = JSON.parse(client.lastPayload?.input ?? "{}");
    expect(requestInput.contextPackage).toEqual({
      mode: "snapshot",
      project: {
        id: "project-main-context",
        title: "五年级百分数公开课",
        grade: "五年级",
        subject: "数学",
        textbookVersion: null,
        lessonTopic: "百分数",
        currentNodeKey: "ppt_draft",
      },
      workflowNodes: [
        { key: "requirement_spec", title: "需求规格", status: "approved", approvedArtifactId: "artifact-approved", staleReason: null },
        { key: "ppt_draft", title: "PPT 大纲", status: "needs_review", approvedArtifactId: null, staleReason: null },
      ],
      sessionSummary: "## Objective\n- 五年级百分数公开课。",
      recentMessages: [
        { id: "message-1", role: "teacher", content: "继续下一步", artifactRefs: [], createdAt: "2026-07-09T00:00:00.000Z" },
      ],
      artifacts: [
        { id: "artifact-approved", nodeKey: "requirement_spec", kind: "requirement_spec", title: "需求规格", status: "approved", summary: "已由教师确认", isApproved: true, version: 1 },
        { id: "artifact-draft", nodeKey: "ppt_draft", kind: "ppt_draft", title: "PPT 大纲", status: "needs_review", summary: "待教师审阅", isApproved: false, version: 1 },
      ],
      guardrails: ["只有 approved artifact 可作为下游可信输入。"],
      summaryValidation: { status: "passed", errors: [] },
      tokenEstimate: 1234,
    });
    expect(requestInput.agentWorldState).toMatchObject({
      currentNodeKey: "ppt_draft",
      trustedInputs: [expect.objectContaining({ id: "artifact-approved", isApproved: true })],
      draftArtifacts: [expect.objectContaining({ id: "artifact-draft", status: "needs_review" })],
    });
    expect(requestInput.capabilityAvailability).toEqual([
      expect.objectContaining({ capabilityId: "lesson_plan", status: "available" }),
      expect.objectContaining({ capabilityId: "asset_image_generate", status: "provider_unavailable" }),
    ]);
    expect(requestInput).not.toHaveProperty("conversationContext");
    expect(requestInput.conversationControl).toEqual({ pendingDeliveryPlan: null });
    expect(requestInput.conversationWindow).toBeNull();
    expect(requestInput.availableCapabilities).toContainEqual(expect.objectContaining({ id: "lesson_plan", availability: "available" }));
    expect(requestInput.availableCapabilities).not.toContainEqual(expect.objectContaining({ id: "asset_image_generate" }));
    expect(client.lastPayload?.instructions).toContain("contextPackage");
    expect(client.lastPayload?.instructions).toContain("summaryValidation.status=failed");
    expect(client.lastPayload?.instructions).toContain("agentWorldState");
    expect(client.lastPayload?.instructions).toContain("capabilityAvailability");
  });

  it("does not turn model-selected unavailable capabilities into confirmable plans", async () => {
    const client = fakeResponsesClient({
      assistantMessage: { body: "我可以开始生成 PPTX 文件。" },
      state: "awaiting_confirmation",
      quickReplies: [{ label: "确认开始", prompt: "确认开始。", recommended: true }],
      recommendedOptions: [],
      shouldRunToolNow: false,
      toolPlan: {
        capabilityId: "coze_ppt",
        reasonForUser: "我可以开始生成 PPTX 文件。",
        missingInputs: [],
        nextSuggestedCapabilities: [],
        requiresConfirmation: true,
      },
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({
      userMessage: "根据现有设计稿生成 PPTX 文件",
      availableArtifactKinds: ["ppt_design_draft"],
      conversationContext: {
        recentMessages: [],
        capabilityAvailability: [
          {
            capabilityId: "coze_ppt",
            status: "provider_unavailable",
            requiresConfirmation: true,
            missingApprovedInputs: [],
            reasonForModel: "status=provider_unavailable",
            reasonForUser: "这项生成能力暂时不可用，可以稍后重试或先继续完善已确认内容。",
          },
        ],
      },
    });

    expect(turn).toMatchObject({
      state: "failed_blocked",
      shouldRunToolNow: false,
      toolPlan: {
        capabilityId: "coze_ppt",
        requiresConfirmation: false,
        reasonForUser: "这项生成能力暂时不可用，可以稍后重试或先继续完善已确认内容。",
      },
    });
    expect(turn.assistantMessage.body).toContain("暂时不可用");
  });

  it("does not replace a model-selected unavailable Tool with a server-chosen prerequisite", async () => {
    const client = fakeResponsesClient({
      assistantMessage: { body: "还需要补充年级、课题和导入情境。" },
      state: "collecting_inputs",
      quickReplies: [],
      recommendedOptions: [],
      shouldRunToolNow: false,
      toolPlan: {
        capabilityId: "video_script_generate",
        reasonForUser: "可以只做视频脚本。",
        missingInputs: [],
        nextSuggestedCapabilities: [],
        requiresConfirmation: false,
      },
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });
    const availability = [
      ["requirement_spec", "available", []],
      ["lesson_plan", "needs_approved_inputs", ["requirement_spec"]],
      ["knowledge_anchor_extract", "needs_approved_inputs", ["requirement_spec"]],
      ["creative_theme_generate", "needs_approved_inputs", ["requirement_spec"]],
      ["video_script_generate", "needs_approved_inputs", ["creative_theme_generate"]],
    ].map(([capabilityId, status, missingApprovedInputs]) => ({
      capabilityId,
      status,
      requiresConfirmation: true,
      missingApprovedInputs,
      reasonForModel: String(status),
      reasonForUser: "前置内容尚未完成。",
    })) as NonNullable<MainConversationAgentInput["conversationContext"]>["capabilityAvailability"];

    const turn = await agent.respond({
      userMessage: "只做五年级数学百分数的机械信标独立创意导入视频脚本，不做 PPT、图片、成片或打包。",
      intentGrant: { standardWorkAuthorized: true },
      availableArtifactKinds: [],
      projectContext: { grade: "五年级", subject: "数学", topic: "百分数" },
      conversationContext: { recentMessages: [], capabilityAvailability: availability },
    });

    expect(turn).toMatchObject({
      state: "collecting_inputs",
      shouldRunToolNow: false,
      toolPlan: {
        capabilityId: "video_script_generate",
        missingInputs: [],
        nextSuggestedCapabilities: [],
      },
    });
    expect(turn.assistantMessage.body).toBe("前置内容尚未完成。");
  });

  it("preserves all model quick replies without truncating them", async () => {
    const client = fakeResponsesClient({
      assistantMessage: { body: "我给你几个推进选项。" },
      state: "collecting_inputs",
      quickReplies: [
        { label: "一", prompt: "一" },
        { label: "二", prompt: "二" },
        { label: "三", prompt: "三" },
        { label: "四", prompt: "四" },
        { label: "五", prompt: "五" },
      ],
      recommendedOptions: [],
      shouldRunToolNow: false,
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({ userMessage: "给我几个选择", availableArtifactKinds: [] });

    expect(turn.quickReplies.map((reply) => reply.label)).toEqual(["一", "二", "三", "四", "五"]);
  });

  it("accepts a model-selected full delivery plan without pre-model keyword gates", async () => {
    const client = fakeResponsesClient({
      assistantMessage: {
        title: "我理解你的任务",
        body: "我会先整理需求，再按计划推进教案、PPT、图片、导入视频和最终交付包。",
      },
      state: "awaiting_confirmation",
      quickReplies: [{ label: "确认开始", prompt: "确认开始，按这个计划推进。", recommended: true }],
      recommendedOptions: [],
      shouldRunToolNow: false,
      toolPlan: {
        capabilityId: "requirement_spec",
        reasonForUser: "我可以先为你整理备课需求。",
        missingInputs: [],
        nextSuggestedCapabilities: ["lesson_plan"],
        requiresConfirmation: true,
      },
      deliveryPlan: {
        mode: "full",
      },
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({ userMessage: "我要做一个三年级数学公开课，你自己判断怎么推进", availableArtifactKinds: [] });

    expect(turn.state).toBe("awaiting_confirmation");
    expect(turn.toolPlan).toMatchObject({ capabilityId: "requirement_spec", requiresConfirmation: true });
    expect(turn.deliveryPlan?.steps.map((step) => step.capabilityId)).toEqual([
      "requirement_spec",
      "lesson_plan",
      "ppt_outline",
      "ppt_design",
      "ppt_sample_assets",
      "ppt_key_samples",
      "ppt_full_assets",
      "ppt_full_deck",
      "image_asset",
      "knowledge_anchor_extract",
      "creative_theme_generate",
      "video_script_generate",
      "storyboard_generate",
      "asset_brief_generate",
      "asset_image_generate",
      "video_segment_plan",
      "video_segment_generate",
      "concat_only_assemble",
      "final_package",
    ]);
  });

  it("requires a Main Agent classroom run spec before proposing the final package", async () => {
    const classroomRunSpecDraft = {
      schemaVersion: "classroom-run-spec-draft.v1",
      courseAnchor: "带着这个问题回到课堂",
      sequence: [
        { ordinal: 1, action: "play_intro_video", artifactRole: "video", pptPage: null, instruction: "播放视频。" },
        { ordinal: 2, action: "ask_return_question", artifactRole: null, pptPage: null, instruction: "提出回接问题。" },
        { ordinal: 3, action: "open_ppt", artifactRole: "pptx", pptPage: 1, instruction: "打开课件。" },
        { ordinal: 4, action: "teacher_explain", artifactRole: "pptx", pptPage: 2, instruction: "组织讨论。" },
        { ordinal: 5, action: "reveal_answer", artifactRole: "pptx", pptPage: 6, instruction: "讨论后揭示答案。" },
      ],
    };
    const client = fakeResponsesClient({
      assistantMessage: { body: "课堂运行顺序已形成，等待你确认后打包。" },
      state: "awaiting_confirmation",
      quickReplies: [], recommendedOptions: [], shouldRunToolNow: false,
      toolPlan: {
        capabilityId: "final_package", reasonForUser: "可以打包最终材料。", missingInputs: [], nextSuggestedCapabilities: [], requiresConfirmation: true,
        inputDraft: { teacherGoal: "完成最终包", notes: null, classroomRunSpecDraft },
      },
      deliveryPlan: null,
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });
    const turn = await agent.respond({ userMessage: "生成最终材料包", availableArtifactKinds: [] });

    expect(client.lastPayload?.instructions).not.toContain("inputDraft.classroomRunSpecDraft");
    expect(client.lastPayload?.instructions).not.toContain("courseVersionId和reviewBatchId由服务端计算");
    const inputDraftSchema = (client.lastPayload as any).text.format.schema.properties.toolPlan.properties.inputDraft;
    expect(inputDraftSchema.required).toContain("classroomRunSpecDraft");
    expect(turn.toolPlan?.inputDraft).toMatchObject({ classroomRunSpecDraft });
  });

  it("keeps the model-selected capability in full delivery plans instead of forcing a fixed first step", async () => {
    const client = fakeResponsesClient({
      assistantMessage: {
        body: "我会按完整材料包推进。",
      },
      state: "awaiting_confirmation",
      quickReplies: [{ label: "确认开始", prompt: "确认开始，按这个计划推进。", recommended: true }],
      recommendedOptions: [],
      shouldRunToolNow: false,
      toolPlan: {
        capabilityId: "lesson_plan",
        reasonForUser: "我会按完整材料包推进。",
        missingInputs: [],
        nextSuggestedCapabilities: ["ppt_outline"],
        requiresConfirmation: true,
      },
      deliveryPlan: {
        mode: "full",
      },
    });
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({ userMessage: "帮我做完整材料包", availableArtifactKinds: [] });

    expect(turn.toolPlan?.capabilityId).toBe("lesson_plan");
    expect(turn.deliveryPlan?.currentStepId).toBe("lesson_plan");
    expect(turn.deliveryPlan?.steps[0]).toMatchObject({ capabilityId: "requirement_spec", status: "pending" });
    expect(turn.deliveryPlan?.steps[1]).toMatchObject({ capabilityId: "lesson_plan", status: "awaiting_confirmation" });
  });

  it("does not silently fall back to deterministic routing when model config is missing outside tests", async () => {
    const agent = createMainConversationAgentFromEnv({
      NODE_ENV: "development",
      SHANHAI_PROVIDER_LEDGER_SECRET_SOURCE: "deployment_secret",
    });

    const turn = await agent.respond({ userMessage: "三年级 数学", availableArtifactKinds: [] });

    expect(turn).toMatchObject({
      state: "failed_retryable",
      runtimeKind: "openai",
      shouldRunToolNow: false,
    });
    expect(turn.assistantMessage.body).toContain("智能生成服务暂时不可用");
    expect(turn.assistantMessage.body).not.toMatch(/硬编码|主模型|模型通道|schema|provider|debug|local path/i);
    await expect(agent.intakeTask!({
      userMessage: "三年级数学，帮我做一份课件大纲",
      generationIntensity: "standard",
      projectContext: {},
      recentMessages: [],
    })).resolves.toMatchObject({
      kind: "failed",
      turn: {
        state: "failed_retryable",
        quickReplies: [],
        failure: {
          reasonCode: "main_agent_provider_unavailable",
          retryability: "after_provider_health_change",
        },
      },
    });
  });

  it("allows an explicit deterministic Main Agent fixture only outside production", async () => {
    const fixtureAgent = createMainConversationAgentFromEnv({
      NODE_ENV: "development",
      SHANHAI_E2E_DETERMINISTIC_MAIN_AGENT: "1",
    });
    const fixtureTurn = await fixtureAgent.respond({ userMessage: "你好", availableArtifactKinds: [] });
    expect(fixtureTurn).toMatchObject({ state: "chatting", runtimeKind: "deterministic" });

    const productionAgent = createMainConversationAgentFromEnv({
      NODE_ENV: "production",
      SHANHAI_E2E_DETERMINISTIC_MAIN_AGENT: "1",
      SHANHAI_PROVIDER_LEDGER_SECRET_SOURCE: "deployment_secret",
    });
    const productionTurn = await productionAgent.respond({ userMessage: "你好", availableArtifactKinds: [] });
    expect(productionTurn).toMatchObject({ state: "failed_retryable", runtimeKind: "openai" });
  });

  it("assigns Tool control-plane ownership explicitly for model and deterministic runtimes", () => {
    expect(resolveMainAgentToolControlPlane({ NODE_ENV: "development" })).toBe("native");
    expect(resolveMainAgentToolControlPlane({
      NODE_ENV: "development",
      SHANHAI_E2E_DETERMINISTIC_MAIN_AGENT: "1",
    })).toBe("outer");
    expect(resolveMainAgentToolControlPlane({
      NODE_ENV: "production",
      SHANHAI_E2E_DETERMINISTIC_MAIN_AGENT: "1",
    })).toBe("native");
  });

  it("continues an existing pending delivery plan even when model config is missing", async () => {
    const agent = createMainConversationAgentFromEnv({
      NODE_ENV: "development",
      SHANHAI_PROVIDER_LEDGER_SECRET_SOURCE: "deployment_secret",
    });

    const turn = await agent.respond({
      userMessage: "继续下一步",
      availableArtifactKinds: ["requirement_spec", "lesson_plan", "ppt_draft", "ppt_design_draft"],
      conversationContext: {
        recentMessages: [],
        pendingDeliveryPlan: {
          teacherRequest: "五年级数学《百分数的认识》",
          toolPlan: {
            planId: "coze_ppt:test",
            capabilityId: "coze_ppt",
            reasonForUser: "我会生成真实 PPTX 文件。",
            internalReason: "test",
            inputDraft: { teacherGoal: "五年级数学《百分数的认识》" },
            missingInputs: [],
            upstreamPlan: [],
            nextSuggestedCapabilities: ["image_asset"],
            requiresConfirmation: true,
            expectedArtifactKind: "pptx_artifact",
          },
        },
      },
    });

    expect(turn).toMatchObject({
      state: "running_tool",
      runtimeKind: "openai",
      shouldRunToolNow: true,
      toolPlan: { capabilityId: "coze_ppt" },
    });
  });

  it("uses a longer configurable timeout for model-first planning", () => {
    expect(resolveMainAgentTimeoutMs({})).toBe(180_000);
    expect(resolveMainAgentTimeoutMs({ MAIN_AGENT_TIMEOUT_MS: "45000" })).toBe(45_000);
    expect(resolveMainAgentTimeoutMs({ MAIN_AGENT_TIMEOUT_MS: "1000" })).toBe(180_000);
    expect(resolveMainAgentTimeoutMs({ MAIN_AGENT_TIMEOUT_MS: "not-a-number" })).toBe(180_000);
  });

  it("uses a read-only Agent Tool and replans in the same model turn", async () => {
    const payloads: Record<string, any>[] = [];
    const responses = [
      {
        output_text: "",
        output: [{
          id: "item-1",
          type: "function_call",
          call_id: "call-1",
          name: "ppt_director_plan_or_repair",
          arguments: JSON.stringify({ goal: "规划课件", stage: "sample_plan", targetPageIds: [], focus: null }),
        }],
      },
      { output_text: "课件规划已核对，我会按观察结果继续处理。", output: [] },
    ];
    const client = {
      responses: {
        async create(payload: Record<string, unknown>) {
          payloads.push(payload);
          return responses[payloads.length - 1];
        },
      },
    } as OpenAIResponsesClient;
    const dispatch = vi.fn(async () => ({
      status: "succeeded" as const,
      observation: {
        observationId: "observation-1",
        status: "succeeded" as const,
        reasonCodes: ["agent_tool_succeeded"],
        advisoryNextToolIntents: ["assemble_ppt_key_samples"],
      },
    }));
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({
      userMessage: "继续完善PPT",
      availableArtifactKinds: ["ppt_design_draft"],
      agentToolLoop: {
        tools: [{ type: "function", name: "ppt_director_plan_or_repair" }],
        allowedToolNames: ["ppt_director_plan_or_repair"],
        dispatch,
      },
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(payloads).toHaveLength(2);
    expect(payloads[1].input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function_call_output", call_id: "call-1" }),
    ]));
    expect(turn).toMatchObject({ shouldRunToolNow: false, runtimeKind: "openai" });
    expect(turn.assistantMessage.body).toBe("课件规划已核对，我会按观察结果继续处理。");
    expect(turn.toolPlan).toBeUndefined();
    expect(turn.deliveryPlan).toBeUndefined();
  });

  it("presents tool-round budget exhaustion as a saved pause instead of a Provider outage", async () => {
    const responses = [
      {
        output_text: "",
        output: [{
          id: "item-1",
          type: "function_call",
          call_id: "call-1",
          name: "create_requirement_spec",
          arguments: JSON.stringify({ revision: 1 }),
        }],
      },
      {
        output_text: "",
        output: [{
          id: "item-2",
          type: "function_call",
          call_id: "call-2",
          name: "create_lesson_plan",
          arguments: JSON.stringify({ revision: 2 }),
        }],
      },
    ];
    let responseIndex = 0;
    const client = {
      responses: {
        async create() {
          return responses[Math.min(responseIndex++, responses.length - 1)];
        },
      },
    } as OpenAIResponsesClient;
    const onBudgetExhausted = vi.fn();
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({
      userMessage: "继续完成当前材料包",
      availableArtifactKinds: [],
      agentToolLoop: {
        tools: [{ type: "function", name: "create_requirement_spec" }],
        allowedToolNames: ["create_requirement_spec", "create_lesson_plan"],
        maxToolRounds: 1,
        dispatch: async () => ({
          status: "succeeded",
          observation: { observationId: "observation-1", status: "succeeded", reasonCodes: ["business_tool_succeeded"] },
        }),
        onBudgetExhausted,
      },
    });

    expect(onBudgetExhausted).toHaveBeenCalledOnce();
    expect(turn).toMatchObject({
      state: "failed_blocked",
      shouldRunToolNow: false,
      runtimeKind: "openai",
      assistantMessage: { body: expect.stringContaining("当前进度已保存") },
    });
    expect(turn.assistantMessage.body).not.toContain("服务暂时不可用");
  });

  it("classifies an identical failed Tool retry as a controlled recovery pause", async () => {
    const responses = ["call-1", "call-2"].map((callId, index) => ({
      output_text: "",
      output: [{
        id: `item-${index + 1}`,
        type: "function_call",
        call_id: callId,
        name: "create_ppt_design_draft",
        arguments: JSON.stringify({ repairIssues: ["learning_progression_missing"] }),
      }],
    }));
    let responseIndex = 0;
    let observationOrdinal = 0;
    const onRecoveryCheckpoint = vi.fn();
    const agent = new OpenAIMainConversationAgent({
      client: {
        responses: {
          async create() {
            return responses[Math.min(responseIndex++, responses.length - 1)];
          },
        },
      } as OpenAIResponsesClient,
      model: "test-model",
    });

    const turn = await agent.respond({
      userMessage: "继续修复PPT设计候选",
      availableArtifactKinds: ["ppt_draft"],
      agentToolLoop: {
        tools: [{ type: "function", name: "create_ppt_design_draft" }],
        allowedToolNames: ["create_ppt_design_draft"],
        dispatch: async () => ({
          status: "failed",
          observation: {
            observationId: `observation-${++observationOrdinal}`,
            status: "failed",
            reasonCodes: ["validation", "learning_progression_missing"],
          },
        }),
        onRecoveryCheckpoint,
      },
    });

    expect(onRecoveryCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      reason: "repeated_tool_failure",
      observationIds: ["observation-1", "observation-2"],
    }));
    expect(turn).toMatchObject({
      state: "failed_blocked",
      failure: {
        reasonCode: "main_agent_retry_budget_exhausted",
        category: "control_plane",
        retryability: "not_retryable",
      },
      assistantMessage: { body: expect.stringContaining("当前进度已保存") },
    });
    expect(turn.assistantMessage.body).not.toContain("服务暂时不可用");
  });

  it("presents a HumanGate Tool Observation as a checkpointed teacher pause without another model request", async () => {
    const create = vi.fn(async () => ({
      output_text: "",
      output: [{
        id: "item-human-gate",
        type: "function_call",
        call_id: "call-human-gate",
        name: "generate_ppt_sample_assets",
        arguments: "{}",
      }],
    }));
    const onRecoveryCheckpoint = vi.fn();
    const agent = new OpenAIMainConversationAgent({
      client: { responses: { create } } as OpenAIResponsesClient,
      model: "test-model",
    });

    const turn = await agent.respond({
      userMessage: "继续生成PPT样张",
      availableArtifactKinds: ["ppt_design_draft"],
      agentToolLoop: {
        tools: [{ type: "function", name: "generate_ppt_sample_assets" }],
        allowedToolNames: ["generate_ppt_sample_assets"],
        dispatch: async () => ({
          status: "blocked",
          observation: {
            observationId: "observation-human-gate",
            status: "blocked",
            reasonCodes: ["missing_grant"],
            nextAction: "ask_teacher",
          },
        }),
        onRecoveryCheckpoint,
      },
    });

    expect(create).toHaveBeenCalledOnce();
    expect(onRecoveryCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      reason: "human_gate_required",
      observationIds: ["observation-human-gate"],
      checkpoint: expect.objectContaining({ checkpointDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    }));
    expect(turn).toMatchObject({
      state: "failed_blocked",
      shouldRunToolNow: false,
      runtimeKind: "openai",
      quickReplies: [],
      assistantMessage: { body: expect.stringContaining("等待决定后再继续") },
    });
    expect(turn.failure).toBeUndefined();
    expect(turn.assistantMessage.body).not.toContain("服务暂时不可用");
  });

  it("classifies a Tool invocation lifecycle conflict as a control-plane failure", async () => {
    const client = {
      responses: {
        async create() {
          return {
            output_text: "",
            output: [{
              id: "item-control-plane-conflict",
              type: "function_call",
              call_id: "call-control-plane-conflict",
              name: "create_ppt_design_draft",
              arguments: "{}",
            }],
          };
        },
      },
    } as OpenAIResponsesClient;
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({
      userMessage: "继续完成当前PPT设计",
      availableArtifactKinds: ["ppt_draft"],
      agentToolLoop: {
        tools: [{ type: "function", name: "create_ppt_design_draft" }],
        allowedToolNames: ["create_ppt_design_draft"],
        dispatch: async () => {
          throw new Error("Tool invocation is not active.");
        },
      },
    });

    expect(turn.failure).toMatchObject({
      phase: "agent_tool_loop",
      reasonCode: "control_plane_lifecycle_conflict",
      category: "control_plane",
      retryability: "not_retryable",
    });
    expect(turn.failure?.reasonCode).not.toBe("main_agent_response_invalid");
  });

  it("presents an unsatisfied completion contract as a checkpointed pause instead of an unexpected runtime failure", async () => {
    const responses = [
      {
        output_text: "",
        output: [{
          id: "item-1",
          type: "function_call",
          call_id: "call-1",
          name: "create_requirement_spec",
          arguments: "{}",
        }],
      },
      { output_text: "先到这里。", output: [] },
      { output_text: "仍然先到这里。", output: [] },
    ];
    let responseIndex = 0;
    const client = {
      responses: {
        async create() {
          return responses[Math.min(responseIndex++, responses.length - 1)];
        },
      },
    } as OpenAIResponsesClient;
    const onRecoveryCheckpoint = vi.fn();
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({
      userMessage: "完成当前材料包",
      availableArtifactKinds: [],
      agentToolLoop: {
        tools: [{ type: "function", name: "create_requirement_spec" }],
        allowedToolNames: ["create_requirement_spec"],
        dispatch: async () => ({
          status: "succeeded",
          observation: { observationId: "observation-1", status: "succeeded", reasonCodes: ["business_tool_succeeded"] },
        }),
        validateCompletion: async () => ({ status: "unsatisfied", remainingRequestedOutputs: ["package"] }),
        onRecoveryCheckpoint,
      },
    });

    expect(onRecoveryCheckpoint).toHaveBeenCalledOnce();
    expect(turn).toMatchObject({
      state: "failed_blocked",
      shouldRunToolNow: false,
      runtimeKind: "openai",
      assistantMessage: { body: expect.stringContaining("当前进度已保存") },
    });
    expect(turn.failure).toBeUndefined();
    expect(turn.assistantMessage.body).not.toContain("服务暂时不可用");
  });

  it("exposes every currently qualified high-level Tool without hiding ppt_design behind Director", async () => {
    const payloads: Record<string, any>[] = [];
    const client = {
      responses: {
        async create(payload: Record<string, unknown>) {
          payloads.push(payload);
          return { output_text: "逐页设计已保存，正在根据结果继续准备样张。", output: [] };
        },
      },
    } as OpenAIResponsesClient;
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    await agent.respond({
      userMessage: "继续完成PPT",
      availableArtifactKinds: ["ppt_draft", "video_segment_generate"],
      conversationContext: {
        recentMessages: [],
        capabilityAvailability: [
          { capabilityId: "ppt_outline", status: "available", requiresConfirmation: false, missingApprovedInputs: [], reasonForModel: "available", reasonForUser: "可以继续。" },
          { capabilityId: "ppt_design", status: "available", requiresConfirmation: false, missingApprovedInputs: [], reasonForModel: "available", reasonForUser: "可以继续。" },
          { capabilityId: "ppt_sample_assets", status: "available", requiresConfirmation: false, missingApprovedInputs: [], reasonForModel: "available", reasonForUser: "可以继续。" },
          { capabilityId: "video_segment_generate", status: "available", requiresConfirmation: false, missingApprovedInputs: [], reasonForModel: "available", reasonForUser: "可以继续。" },
        ],
      },
      replanDirective: {
        reason: "tool_succeeded",
        previousActionKey: "ppt_outline:ppt_draft",
        observationIds: ["observation-outline"],
      },
      agentToolLoop: {
        tools: [{ type: "function", name: "create_ppt_design_draft" }],
        allowedToolNames: ["ppt_director_plan_or_repair", "create_ppt_design_draft"],
        dispatch: async () => ({ status: "succeeded", observation: { status: "succeeded", reasonCodes: ["ok"] } }),
      },
    });

    const requestInput = JSON.parse(String(payloads[0].input));
    expect(requestInput.availableCapabilities).toEqual([]);
    expect(payloads[0].tools).toEqual([expect.objectContaining({ name: "create_ppt_design_draft" })]);
    expect(payloads[0]).not.toHaveProperty("text");
  });

  it("keeps native Tool ownership when the currently qualified Tool set is empty", async () => {
    const payloads: Record<string, any>[] = [];
    const client = {
      responses: {
        async create(payload: Record<string, unknown>) {
          payloads.push(payload);
          return {
            output_text: "当前没有可继续执行的业务工具，已保留现有进度。",
            output: [],
          };
        },
      },
    } as OpenAIResponsesClient;
    const dispatch = vi.fn();
    const agent = new OpenAIMainConversationAgent({ client, model: "test-model" });

    const turn = await agent.respond({
      userMessage: "继续当前任务",
      availableArtifactKinds: ["requirement_spec"],
      toolControlPlane: "native",
      agentToolLoop: {
        tools: [],
        allowedToolNames: [],
        dispatch,
      },
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0].tools).toEqual([]);
    expect(payloads[0]).not.toHaveProperty("text");
    expect(dispatch).not.toHaveBeenCalled();
    expect(turn).toMatchObject({ shouldRunToolNow: false, state: "chatting" });
    expect(turn.toolPlan).toBeUndefined();
    expect(turn.deliveryPlan).toBeUndefined();
  });
});

function fakeResponsesClient(output: unknown): OpenAIResponsesClient & { lastPayload?: { input?: string; instructions?: string } } {
  const client = {
    lastPayload: undefined as { input?: string; instructions?: string } | undefined,
    responses: {
      async create(payload: { input?: string; instructions?: string }) {
        client.lastPayload = payload;
        return { output_text: JSON.stringify(output) };
      },
    },
  };
  return client as OpenAIResponsesClient & { lastPayload?: { input?: string; instructions?: string } };
}
