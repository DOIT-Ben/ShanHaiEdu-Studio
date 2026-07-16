# M54-B 后端对话智能体技术实现路线

日期：2026-07-08

状态：正式技术路线。本文只定义实现顺序、文件边界、测试和验收，不替代架构规划。

上游规划：

- `docs/stages/local-real-mvp-m54b-agentic-conversation-architecture-plan.md`

## 1. 目标

用最小可控改造，把当前 `ConversationOrchestrator + messages route` 的固定流程，升级为：

```text
MainConversationAgent
-> CapabilityRegistry
-> CapabilityPlanner
-> HumanGate
-> CapabilityRunner
-> ArtifactStore
-> WorkflowCheckpoint
```

第一阶段不追求全能力一次上线，而是先跑通“自然对话 + 工具计划 + 一个真实业务工具链 + 产物回写”的骨架。

## 2. 当前代码事实

已经存在并可复用：

| 模块 | 文件 | 用途 |
| --- | --- | --- |
| 对话入口 | `src/app/api/workbench/projects/[projectId]/messages/route.ts` | 保存消息、调用编排、生成需求规格 |
| 对话编排 | `src/server/conversation/conversation-orchestrator.ts` | 当前三分类和 JSON schema |
| 文本生成 | `src/server/agent-runtime/*` | requirement、lesson、ppt_outline、intro_video、final_package |
| 项目持久化 | `src/server/workbench/service.ts` | messages、artifacts、agentRuns、generationJobs |
| Coze PPT | `src/server/coze-ppt/coze-ppt-run.ts` | PPTX provider 调用 |
| 图片 | `src/server/image-generation/*` | 图片 artifact/provider |
| 视频 | `src/server/video-generation/*` | 视频 artifact/provider |
| 最终包 | `src/server/package/artifact-package.ts` | artifact package |
| 数据模型 | `prisma/schema.prisma` | Project、ConversationMessage、WorkflowNode、Artifact、AgentRun、GenerationJob |

必须纠偏：

- route 里不再用 `formatRequirementConfirmation(...)` 主导用户可见回复。
- `ConversationOrchestrator` 不再作为唯一大脑。
- 三分类不能继续作为智能体能力上限。
- 工具失败不能落到 deterministic 成功话术。

## 3. 目标文件结构

新增后端目录：

```text
src/server/conversation/
  main-conversation-agent.ts
  conversation-context-builder.ts
  conversation-turn-service.ts
  conversation-schemas.ts
  conversation-fallback.ts
  requirement-slots.ts
  quick-replies.ts

src/server/capabilities/
  types.ts
  capability-registry.ts
  capability-planner.ts
  capability-runner.ts
  adapters/
    requirement-spec-adapter.ts
    lesson-plan-adapter.ts
    ppt-outline-adapter.ts
    coze-ppt-adapter.ts
    image-asset-adapter.ts
    intro-video-adapter.ts
    final-package-adapter.ts

src/server/workflow-checkpoints/
  types.ts
  checkpoint-service.ts

src/server/promptpack/
  promptpack.ts
  prompts/
    main-conversation-agent.v1.md
    requirement-spec.v1.md
```

新增测试：

```text
  tests/main-conversation-agent.test.ts
  tests/capability-registry.test.ts
  tests/capability-planner.test.ts
  tests/conversation-turn-service.test.ts
  tests/capability-runner.test.ts
  tests/conversation-evalset.test.ts
  tests/workflow-checkpoints.test.ts
tests/fixtures/conversation-evalset.json
```

## 4. 核心类型合同

### 4.1 CapabilityDefinition

```ts
type CapabilityDefinition = {
  id: CapabilityId;
  userLabel: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  upstreamCapabilities: CapabilityId[];
  artifactKind: string;
  workflowNodeKey: string;
  requiresConfirmation: boolean;
  providerMode: "internal" | "external" | "package";
  deterministicFallback: "allowed" | "blocked" | "draft_only";
  failureRecovery: {
    retryable: boolean;
    userMessage: string;
  };
};
```

### 4.2 CapabilityToolPlan

```ts
type CapabilityToolPlan = {
  planId: string;
  capabilityId: CapabilityId;
  reasonForUser: string;
  internalReason: string;
  inputDraft: Record<string, unknown>;
  missingInputs: string[];
  upstreamPlan: CapabilityToolPlan[];
  requiresConfirmation: boolean;
  expectedArtifactKind: string;
};
```

### 4.3 MainAgentTurn

```ts
type MainAgentTurn = {
  assistantMessage: {
    title?: string;
    body: string;
  };
  state:
    | "chatting"
    | "exploring"
    | "collecting_inputs"
    | "awaiting_confirmation"
    | "planning_tools"
    | "running_tool"
    | "needs_input"
    | "failed_retryable"
    | "failed_blocked"
    | "succeeded"
    | "continuing_workflow";
  quickReplies: QuickReply[];
  recommendedOptions: RecommendedOption[];
  toolPlan?: CapabilityToolPlan;
  shouldRunToolNow: boolean;
  runtimeKind: "openai" | "deterministic";
};
```

### 4.4 CapabilityRunResult

```ts
type CapabilityRunResult =
  | {
      status: "succeeded";
      artifactDraft: SaveArtifactInput;
      assistantSummary: string;
      providerStatus: "real" | "deterministic_draft";
    }
  | {
      status: "needs_input";
      missingInputs: string[];
      assistantPrompt: string;
    }
  | {
      status: "failed";
      userMessage: string;
      retryable: boolean;
      errorCategory: "provider" | "validation" | "permission" | "timeout" | "unknown";
    };
```

## 5. 阶段拆分

### M54-B0 测试定义和合同锁定

目标：先用测试锁住“模型不被限制、工具不伪成功”的核心行为。

修改：

- 新增 `tests/main-conversation-agent.test.ts`
- 新增 `tests/capability-registry.test.ts`
- 新增 `tests/capability-planner.test.ts`

测试断言：

- “你好”返回自然回复，`toolPlan` 为空。
- “我想聊聊百分数公开课怎么设计”进入 `exploring`，不生成 artifact。
- “帮我做五年级数学百分数 PPT”产生 PPT 相关 tool plan。
- 没有 PPT 大纲时，先计划 `ppt_outline`，不能直接假装 `coze_ppt` 完成。
- 工具失败返回 `failed`，不能落成 succeeded。

验收：

```text
npx vitest run tests/main-conversation-agent.test.ts tests/capability-registry.test.ts tests/capability-planner.test.ts --maxWorkers=1
```

预期：先红后绿。

### M54-B1 CapabilityRegistry 最小实现

目标：让系统有稳定业务能力目录。

新增：

- `src/server/capabilities/types.ts`
- `src/server/capabilities/capability-registry.ts`

能力目录：

- `requirement_spec`
- `lesson_plan`
- `ppt_outline`
- `coze_ppt`
- `image_asset`
- `intro_video`
- `final_package`

验收：

- 每个 capability 有输入、输出、依赖、artifactKind、nodeKey。
- `coze_ppt` 必须声明依赖 `ppt_outline`。
- 外部 provider 能力必须声明 `requiresConfirmation: true`。
- registry 不包含密钥、URL、provider secret。

### M54-B2 MainConversationAgent 最小自然对话

目标：让主 Agent 成为自然对话和业务调度入口。

新增：

- `src/server/conversation/main-conversation-agent.ts`
- `src/server/conversation/conversation-context-builder.ts`
- `src/server/conversation/conversation-fallback.ts`

实现策略：

- 第一版支持 deterministic agent，便于稳定测试。
- OpenAI 分支继续使用 Responses JSON schema，但 schema 扩展为 MainAgentTurn。
- 用户可见回复来自 `assistantMessage.body`，不是 route 模板。

验收：

- 普通聊天不触发工具。
- 探索需求不触发工具。
- 明确 PPT 需求能产生工具计划。
- malformed model output fallback 后标记 `runtimeKind=deterministic`。

### M54-B3 ConversationTurnService 接管 messages route

目标：把 HTTP route 从“业务大脑”降级为入口层。

新增：

- `src/server/conversation/conversation-turn-service.ts`

修改：

- `src/app/api/workbench/projects/[projectId]/messages/route.ts`

服务职责：

```text
保存 teacher message
-> 构造 ConversationContext
-> 调 MainConversationAgent
-> 必要时进入 HumanGate 或 CapabilityRunner
-> 保存 assistant message
-> 保存 artifact/checkpoint
-> 返回 MessageTurnResponse
```

删除或下沉：

- `formatRequirementConfirmation(...)`
- `findPendingTeacherRequest(...)` 的 route 层硬编码逻辑
- route 直接调用 `runtime.run(...)` 的业务分支

验收：

- 旧 API 调用不破。
- 普通消息仍能保存 assistant reply。
- 确认前不会生成 requirement artifact。
- 确认后可以通过 service 生成 requirement artifact。

### M54-B4 RequirementSlotService 和 quick replies

目标：槽位和快捷回复成为主 Agent 的辅助能力，而不是主流程上限。

新增：

- `src/server/conversation/requirement-slots.ts`
- `src/server/conversation/quick-replies.ts`

槽位：

- 年级。
- 学科。
- 课题。
- 教材版本。
- 交付物。
- 时长。
- 教学风格。
- 材料来源。

验收：

- “三年级数学长方形周长公开课”能抽出年级、学科、课题。
- “帮我做课件”给 2-3 个推荐选项，不直接执行。
- quick replies 是建议，不自动替用户确认。

### M54-B5 CapabilityRunner 接文本产物能力

目标：把现有 `AgentRuntime` 包装成可调用业务工具。

新增：

- `src/server/capabilities/capability-runner.ts`
- `src/server/capabilities/adapters/requirement-spec-adapter.ts`
- `src/server/capabilities/adapters/lesson-plan-adapter.ts`
- `src/server/capabilities/adapters/ppt-outline-adapter.ts`

复用：

- `createAgentRuntimeFromEnv`
- `workbenchService.saveArtifact`

验收：

- `requirement_spec` 成功返回 artifactDraft。
- `lesson_plan` 缺少确认需求时返回 `needs_input`。
- `ppt_outline` 缺少教案或需求规格时先计划上游输入。
- deterministic 输出标记为 draft，不冒充真实 provider。

### M54-B6 Coze PPT 真实工具链

目标：证明主 Agent 可以调用真实外部业务工具，而不只是聊天。

新增：

- `src/server/capabilities/adapters/coze-ppt-adapter.ts`

复用：

- `src/server/coze-ppt/coze-ppt-run.ts`
- PPTX artifact 下载路由。

链路：

```text
用户明确 PPT 需求
-> MainConversationAgent 计划 ppt_outline
-> 用户确认
-> CapabilityRunner 生成 ppt_outline
-> HumanGate 确认调用外部 Coze PPT
-> CozePptAdapter 生成 PPTX
-> saveArtifact 保存 PPTX 引用
-> 糖葫芦 PPT 节点更新
```

验收：

- 缺少 PPT 大纲时不会直接调用 Coze。
- Coze 成功后 artifact 有 PPTX 下载信息。
- Coze 失败时返回 retryable 和用户可理解错误。
- provider 未配置时不伪装成功。

### M54-B7 AttachmentPipeline

目标：上传材料进入真实后端上下文。

新增：

- `src/app/api/workbench/projects/[projectId]/attachments/route.ts`
- `src/server/attachments/attachment-service.ts`
- `src/server/attachments/parsers/text-parser.ts`
- `src/server/attachments/parsers/pdf-parser.ts`
- `src/server/attachments/parsers/docx-parser.ts`

依赖策略：

- md/txt：Node 原生处理。
- pdf：优先成熟解析库。
- docx：优先成熟文本抽取库。
- 图片：第一阶段只存储和预览，OCR 后续单独做。

验收：

- md/txt 上传后可提取摘要。
- pdf/docx 上传失败时保存原附件和失败状态。
- 附件摘要能进入 ConversationContextBuilder。
- 前端不会把“仅上传成功”误显示成“已理解材料”。

### M54-B8 WorkflowCheckpoint 和自动交付准备

目标：支撑“一键自动化跑完整交付”的状态恢复。

新增：

- `src/server/workflow-checkpoints/types.ts`
- `src/server/workflow-checkpoints/checkpoint-service.ts`

第一阶段存储策略：

- 优先复用 `AgentRun`、`GenerationJob`、`Artifact.structuredContentJson`。
- 如果不够，再新增 Prisma `WorkflowCheckpoint` 模型。

验收：

- 每个 capability run 记录输入摘要、状态、artifact id、错误。
- 失败后能从最近成功节点继续。
- 人工确认点能保存为 `awaiting_confirmation`。
- 后续自动化脚本可以读取 checkpoint。

### M54-B9 ConversationEvalSet 和 PromptPack

目标：让对话智能体可持续迭代，不靠感觉调 prompt。

新增：

- `tests/fixtures/conversation-evalset.json`
- `tests/conversation-evalset.test.mjs`
- `src/server/promptpack/promptpack.ts`
- `src/server/promptpack/prompts/main-conversation-agent.v1.md`

验收：

- evalset 至少 30 条。
- 普通聊天误触发 tool plan 为 0。
- 未确认调用外部 provider 为 0。
- prompt id/version 写入 agent turn 或 artifact structuredContent。

## 6. API 迁移策略

第一阶段保持兼容：

- 老前端仍可读取 `assistantMessage`。
- 新前端可以读取 `agentTurn`。
- artifact 返回仍使用现有 `ArtifactRecord`。

新增响应字段：

```ts
{
  message,
  assistantMessage,
  agentTurn,
  artifacts,
  checkpoints
}
```

禁止：

- 在用户可见 content 里输出 `toolPlan` JSON。
- 在前端显示 `provider`、`schema`、`node_id`、本地路径。

## 7. 测试计划

基础验证：

```text
npm test
npm run build
git diff --check
```

新增重点：

```text
npx vitest run tests/main-conversation-agent.test.ts tests/capability-registry.test.ts tests/capability-planner.test.ts tests/conversation-turn-service.test.ts tests/capability-runner.test.ts tests/conversation-evalset.test.ts --maxWorkers=1
```

真实 provider 验收只在配置齐全时运行：

```text
npm run preflight:production
node scripts/openai-smoke.mjs
```

Coze PPT 验收必须明确标记：

- provider configured。
- provider success。
- artifact saved。
- download route works。

## 8. Commit 分组

建议分 5 组提交：

1. `规划: M54-B 智能体架构与技术路线 | 2026-07-08 HH:mm`
2. `测试: 锁定主 Agent 与能力目录合同 | 2026-07-08 HH:mm`
3. `开发: 增加 CapabilityRegistry 与 MainConversationAgent | 2026-07-08 HH:mm`
4. `开发: 接管消息回合并回写产物 | 2026-07-08 HH:mm`
5. `验收: 补齐评测集与真实工具链记录 | 2026-07-08 HH:mm`

## 9. 风险和回退

| 风险 | 表现 | 回退 |
| --- | --- | --- |
| 模型输出不稳定 | JSON parse 失败 | deterministic fallback，标记 runtimeKind |
| 工具计划误触发 | 闲聊也生成 tool plan | evalset 阻断，普通聊天误触发为 0 |
| route 迁移破坏旧 UI | 消息无法发送 | 保留兼容字段，先让旧测试通过 |
| Coze provider 失败 | PPTX 生成失败 | 返回 failed，不伪装；保留 ppt_outline artifact |
| checkpoint 太重 | 过早加表拖慢 | 先用 existing models，必要时再 migration |

## 10. 第一轮执行顺序

当前最小可执行切片：

1. 写 B0 测试定义。
2. 实现 `CapabilityRegistry`。
3. 实现 deterministic `MainConversationAgent`。
4. 接入 `ConversationTurnService`，替代 route 中模板主导逻辑。
5. 用 `requirement_spec -> ppt_outline` 跑通内部工具链。
6. 再接 `coze_ppt`，做真实 PPTX artifact 回写。

不先做：

- 全量附件解析。
- 全量 LangGraph 迁移。
- 通用工具平台 UI。
- 多 Agent 并行自治。

## 11. 通过门

Stage: `products-writing-plans`

Gate: `continue`

进入开发前必须满足：

- 架构规划文档已确认。
- 本技术路线文档已确认。
- B0 测试定义先红。
- 没有把 UI 问题混进后端核心改造。

下一步：按 B0 开始写测试定义。
