# M54-B 后端对话智能体架构深度规划

日期：2026-07-08

状态：正式规划文档。后续后端智能体开发以本文和技术路线文档为准。

配套技术路线：

- `docs/stages/local-real-mvp-m54b-agentic-conversation-implementation-roadmap.md`

## 1. 一句话目标

把 ShanHaiEdu 后端从“模型被代码流程限制的意图分类器”升级为“主对话 Agent 自然理解用户，并按需调用 ShanHaiEdu 业务能力完成真实交付”的可持续智能体系统。

## 2. 本次纠偏的核心结论

当前问题不是模型不够强，而是系统把模型用窄了。

现在的实际链路更像：

```text
用户消息
-> ConversationOrchestrator 做三分类
-> route.ts 用模板格式化可见回复
-> 确认后只启动 requirement_spec
```

这会导致：

- 普通对话不自然，像机器人填表。
- 明确业务需求也只会进入固定模板，不像真实大模型持续理解上下文。
- 模型没有机会自由解释、追问、发散和组织计划。
- 工具能力没有被注册成“模型可调用的业务能力”，只能靠 route 里的硬编码推进。

新的原则：

```text
不要限制模型能力。
给模型包装业务能力。
模型自然对话，业务动作交给工具。
工具结果必须真实回写项目、产物轨和 checkpoint。
```

## 3. 外部已验证方案给我们的依据

### 3.1 Anthropic: workflows 和 agents 要区分

Anthropic 的 agent 架构建议强调：workflow 是预定义路径，agent 是由模型动态决定流程和工具使用。ShanHaiEdu 当前“固定三分类 + 模板回复”更接近 workflow，不适合作为主对话体验。

采用判断：

- 教师端自然对话应是 agent 模式。
- 公开课交付链的每个产物节点应是 workflow/tool 模式。
- 二者不能混成“模型只负责分类，代码替它说话”。

落地到 ShanHaiEdu：

```text
MainConversationAgent = 动态理解和调度
CapabilityAdapter = 稳定工具执行
WorkflowCheckpoint = 可恢复流程状态
```

### 3.2 OpenAI Agents SDK: agent = instructions + tools + handoffs + guardrails

OpenAI Agents 的成熟抽象里，Agent 不只是 prompt，而是说明、工具、交接、会话和 guardrails 的组合。ShanHaiEdu 不必马上引入完整 SDK，但应复用这个结构思想。

采用判断：

- `instructions` 对应 ShanHaiEdu 主 Agent 系统提示词和 PromptPack。
- `tools` 对应 ShanHaiEdu CapabilityRegistry。
- `handoffs` 对应需求整理、PPT、图片、视频、交付包等垂直能力。
- `sessions` 对应项目上下文、最近消息、产物引用和附件摘要。
- `guardrails` 对应不泄露工程词、不伪装 mock、工具失败不假装成功。

### 3.3 LangGraph: 长任务需要 persistence / interrupt / resume

“自动化跑完整交付”不是一轮聊天，而是长任务。成熟方案会把状态、断点、人工确认和恢复作为一等能力。

采用判断：

- 第一阶段不直接把系统迁成 LangGraph。
- 先实现 TypeScript 轻量 checkpoint 语义。
- 状态结构要能兼容后续 LangGraph 风格迁移。

### 3.4 Dify / Flowise: 工具编排和运行日志值得学，教师端不能暴露节点图

Dify 和 Flowise 已验证了 workflow、工具、知识库、运行日志、Human in the Loop、评测等方向。但 ShanHaiEdu 是教师备课产品，不是通用工作流平台。

采用判断：

- 后台架构学习节点输入输出、运行记录、失败恢复。
- 教师端只看到“对话、选项、产物、确认、导出”，不看到节点图和 provider 细节。

### 3.5 Open WebUI / LibreChat / LobeChat: 对话体验和 artifacts 值得学

这些产品验证了多模型、文件、工具、actions、artifacts、移动端对话体验。ShanHaiEdu 可学习交互模式，但业务上必须回到公开课交付链。

采用判断：

- UI 可借鉴聊天质感和 artifacts 展示。
- 后端必须提供干净的消息、quick replies、tool plan、artifact refs。
- 不做泛聊天产品，不把教师带离备课交付目标。

## 4. ShanHaiEdu 业务架构目标

目标链路：

```text
教师自然输入
-> MainConversationAgent 读取项目、最近消息、产物、附件摘要
-> 判断当前是闲聊、探索、需求补齐、确认、执行、修改还是继续
-> 查询 CapabilityRegistry
-> 生成自然回复和可选 tool plan
-> 需要确认时进入 HumanGate
-> 确认后 CapabilityRunner 调用真实工具
-> Adapter 生成或获取真实产物
-> ArtifactStore 保存产物
-> WorkflowCheckpoint 保存输入、输出、状态、错误和恢复点
-> 主 Agent 用自然语言解释结果并给下一步选项
-> 前端消息流和糖葫芦产物轨同步更新
```

这个架构里，模型不直接“自己假装生成 PPTX、图片、视频”。模型负责理解、组织、选择、解释；工具负责真实执行。

## 5. 目标模块拆分

### 5.1 MainConversationAgent

定位：主对话脑。

职责：

- 自然回复普通聊天。
- 陪用户探索公开课想法，不急着启动产物链。
- 识别何时进入 ShanHaiEdu 业务能力。
- 从 CapabilityRegistry 中选择候选能力。
- 缺输入时自然追问，或给 2-3 个推荐选项。
- 工具完成后解释产物、风险和下一步。

不负责：

- 直接调用 Coze、图片、视频等外部 API。
- 直接保存数据库。
- 用模板覆盖模型自然回复。

### 5.2 ConversationContextBuilder

定位：给主 Agent 组装干净上下文。

输入：

- 当前用户消息。
- 项目年级、学科、课题、教材版本。
- 最近 N 条对话。
- 已确认 artifact 摘要。
- 附件解析摘要。
- 当前 workflow/checkpoint 状态。

输出：

- 面向模型的短上下文。
- 面向工具的结构化上下文。

关键约束：

- 不把密钥、本地路径、provider 细节放入上下文。
- 只传必要摘要，不把全部历史原样塞给模型。

### 5.3 CapabilityRegistry

定位：业务能力目录。

它告诉主 Agent “ShanHaiEdu 能做什么”，但不暴露底层实现。

第一批能力：

| capabilityId | 用户可理解能力 | 上游依赖 | 输出 |
| --- | --- | --- | --- |
| `requirement_spec` | 整理备课需求 | 用户需求、槽位、附件摘要 | 需求规格 Markdown |
| `lesson_plan` | 生成公开课教案 | 已确认需求、教材依据 | 教案 Markdown |
| `ppt_outline` | 生成 PPT 大纲和逐页脚本 | 教案或需求规格 | PPT 大纲 Markdown |
| `coze_ppt` | 生成 PPTX 文件 | PPT 大纲、页数、风格 | PPTX artifact |
| `image_asset` | 生成课堂图片素材 | 图片提示词、场景 | 图片 artifact |
| `intro_video` | 生成导入视频素材 | 视频方案、分镜、图片 | 视频 artifact |
| `final_package` | 打包最终交付 | 已确认产物集合 | ZIP 或 Markdown 交付包 |

每个能力必须声明：

- 输入 schema。
- 输出 schema。
- 依赖能力。
- 是否需要用户确认。
- 是否真实 provider。
- deterministic fallback 是否允许。
- 失败时用户可理解的恢复动作。

### 5.4 CapabilityPlanner

定位：把用户目标翻译成工具计划。

职责：

- 根据主 Agent 判断和能力目录生成 `CapabilityToolPlan`。
- 判断缺失输入。
- 判断是否需要先跑上游能力。
- 不把计划直接当完成结果。

示例：

```text
用户：帮我做五年级数学百分数 PPT

计划不是直接 coze_ppt。
应该先判断是否已有 PPT 大纲。
如果没有：
1. requirement_spec 或 lesson_plan
2. ppt_outline
3. coze_ppt
```

### 5.5 HumanGate

定位：人工确认点。

职责：

- 在高影响动作前暂停。
- 把需求、工具计划、将生成的交付物讲清楚。
- 用户确认后再执行。

第一阶段触发条件：

- 生成需求规格前。
- 调用真实外部 provider 前。
- 消耗额度或长耗时任务前。
- 打包最终交付前。

### 5.6 CapabilityRunner 和 Adapter

定位：真实工具执行层。

职责：

- 根据 tool plan 调用对应 adapter。
- 统一处理成功、失败、需要输入、等待中。
- 不把 fallback 伪装成真实产物。
- 成功后返回可保存 artifact draft 或已保存 artifact id。

Adapter 初始复用：

- 文本产物复用 `src/server/agent-runtime/`。
- Coze PPT 复用 `src/server/coze-ppt/coze-ppt-run.ts`。
- 图片复用 `src/server/image-generation/`。
- 视频复用 `src/server/video-generation/`。
- 最终包复用 `src/server/package/artifact-package.ts`。

### 5.7 ArtifactStore

定位：产物保存边界。

第一阶段复用 `workbenchService.saveArtifact`，但在合同上明确：

- 保存何种 artifact kind。
- 对应哪个 nodeKey。
- 是否 needs_review。
- structuredContent 里记录 generationMode、capabilityId、promptVersion、providerStatus。

### 5.8 WorkflowCheckpoint

定位：自动化完整交付的状态账本。

每个 checkpoint 至少记录：

- capabilityId。
- input snapshot。
- output artifact id。
- status。
- error category。
- retryable。
- requiresHumanConfirmation。
- previousCheckpointId。
- nextSuggestedCapabilities。

MVP 第一版可以先落在结构化 artifact / generation job / agent run 中；如果需要更强恢复，再新增 Prisma 模型。

### 5.9 ConversationEvalSet

定位：防止 prompt 和规则改坏。

必须覆盖：

- 普通寒暄。
- 陪聊和发散。
- 模糊备课想法。
- 明确备课需求。
- 确认信号。
- 修改已生成内容。
- 继续生成教案/PPT/视频。
- 工具失败恢复。

硬门槛：

- 普通聊天误触发 tool plan 数量为 0。
- 未确认前真实外部 provider 调用数量为 0。
- 工具失败不得返回 succeeded。

## 6. 状态机，不是模板机

后端应承认这些对话状态：

| 状态 | 含义 | 是否生成产物 |
| --- | --- | --- |
| `chatting` | 普通聊天 | 否 |
| `exploring` | 教师在聊想法，还没明确交付 | 否 |
| `collecting_inputs` | 已有业务意图，但缺槽位 | 否 |
| `awaiting_confirmation` | 已形成计划，等待确认 | 否 |
| `planning_tools` | 生成工具计划 | 否 |
| `running_tool` | 执行业务能力 | 是 |
| `needs_input` | 工具缺少必要输入 | 否 |
| `failed_retryable` | 工具失败，可重试 | 否 |
| `failed_blocked` | 工具失败，需用户或配置介入 | 否 |
| `succeeded` | 产物完成并保存 | 是 |
| `continuing_workflow` | 从一个产物继续到下游 | 视工具而定 |

用户可见回复来自主 Agent 的自然表达；状态只用于后端和 UI 渲染辅助。

## 7. API 合同方向

`POST /api/workbench/projects/:projectId/messages` 后续不应只返回 `message / assistantMessage / artifact`。

目标返回：

```ts
type MessageTurnResponse = {
  message: ConversationMessageRecord;
  assistantMessage: ConversationMessageRecord;
  agentTurn: {
    intent: string;
    state: string;
    quickReplies: QuickReply[];
    recommendedOptions: RecommendedOption[];
    toolPlan?: CapabilityToolPlan;
    checkpoint?: WorkflowCheckpointView;
    artifactRefs: string[];
    runtimeKind: "openai" | "deterministic";
  };
  artifacts?: ArtifactRecord[];
};
```

前端只渲染教师能看懂的字段；工程字段只作为内部合同和测试断言。

## 8. 现有代码映射

当前要保留并复用：

- `src/server/agent-runtime/`
- `src/server/workbench/service.ts`
- `src/server/workbench/repository.ts`
- `src/server/coze-ppt/coze-ppt-run.ts`
- `src/server/image-generation/`
- `src/server/video-generation/`
- `src/server/package/artifact-package.ts`
- `src/app/api/workbench/projects/[projectId]/messages/route.ts`

当前要拆分和纠偏：

- `src/server/conversation/conversation-orchestrator.ts`
  - 从三分类器升级为兼容桥。
  - 新增 MainConversationAgent 后，它不再主导用户可见回复。
- `messages/route.ts`
  - 移除或下沉 `formatRequirementConfirmation(...)` 这类强模板覆盖。
  - 改为调用 AgentTurnService。
  - route 只负责 HTTP、权限、事务边界和响应映射。

建议新增：

- `src/server/conversation/main-conversation-agent.ts`
- `src/server/conversation/conversation-context-builder.ts`
- `src/server/capabilities/types.ts`
- `src/server/capabilities/capability-registry.ts`
- `src/server/capabilities/capability-planner.ts`
- `src/server/capabilities/capability-runner.ts`
- `src/server/capabilities/adapters/*`
- `src/server/workflow-checkpoints/*`
- `src/server/promptpack/*`
- `tests/fixtures/conversation-evalset.json`

## 9. 关键产品边界

必须做：

- 普通聊天像真实模型，而不是每句话都推工作流。
- 业务需求出现时，模型能调用 ShanHaiEdu 工具。
- 工具执行后产物真实保存。
- 失败时说失败，不伪装成功。
- 每步可测试、可回归、可恢复。

不能做：

- 不把前端做成 provider 配置平台。
- 不把 Dify/Flowise 节点图暴露给教师。
- 不把 deterministic draft 说成真实大模型或真实 PPTX。
- 不在 React 里直接调用模型 SDK。
- 不靠堆 prompt 解决所有问题。

## 10. 成功标准

本规划被实现后，最小可验证场景应是：

```text
用户：你好
系统：自然聊天，无 tool plan。

用户：我想聊聊五年级百分数公开课怎么设计
系统：陪聊和建议，无 artifact。

用户：帮我做五年级数学百分数 PPT
系统：理解为业务需求，说明需要先形成 PPT 大纲，给确认选项。

用户：确认开始
系统：生成或复用需求规格和 PPT 大纲，然后调用 Coze PPT 能力。

系统：PPTX artifact 保存到项目，糖葫芦 PPT 节点更新，并告诉用户下一步可修改或导出。
```

这个场景不要求每个 provider 都完美，但要求架构路径正确、状态真实、失败诚实。

## 11. Go / No-Go

Stage: `products-plan-eng-review`

Recommendation: `go`

理由：

- 架构边界清楚：对话、能力目录、工具执行、产物保存、checkpoint 分层明确。
- 数据流清楚：消息进入 Agent，tool plan 进入 runner，结果进入 artifact/checkpoint。
- 依赖策略保守：优先复用现有 runtime 和 provider adapter，不立即引入大平台。
- 风险可测：普通聊天误触发、工具失败伪成功、未确认调用 provider 都能写测试拦住。

Gate: `continue`

下一步：进入技术实现路线的 M54-B0/B1，先写测试定义和合同，再改业务代码。
