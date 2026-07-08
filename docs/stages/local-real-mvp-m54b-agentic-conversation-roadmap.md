# M54-B 后端对话智能体持续升级路线

日期：2026-07-08

状态：正式阶段路线 / 待测试定义与开发切片。

权威拆分文档：

- 架构深度规划：`docs/stages/local-real-mvp-m54b-agentic-conversation-architecture-plan.md`
- 技术实现路线：`docs/stages/local-real-mvp-m54b-agentic-conversation-implementation-roadmap.md`

本文保留为 M54-B 总览；具体开发顺序、类型合同、测试定义和验收门以后两份文档为准。

## 0. 2026-07-08 架构纠偏结论

本路线原本偏向 `ConversationDecisionV2 + RequirementSlotService`，容易继续把模型做成“分类器 + 表单流程”。本轮讨论确认：这不是最终方向。

新的后端核心是：

```text
不要限制模型能力。
给模型包装 ShanHaiEdu 的业务能力。
模型可以自然对话、发散、追问。
当模型判断用户要真正完成一件事时，调用业务能力工具。
工具执行真实业务逻辑，产物回写项目和糖葫芦轨道。
```

因此，M54-B 的第一优先级调整为：

```text
Main Conversation Agent
-> Capability Registry
-> Capability Adapter
-> Workflow Checkpoint
-> Artifact Store
```

`ConversationDecisionV2`、槽位和 quick replies 仍然需要，但它们是主 Agent 的结构化输出和 UI 辅助，不是主架构中心。

## 1. 终极目标

把 ShanHaiEdu 后端从“能根据关键词进入产物链”升级为“主对话 Agent 能自然理解教师、调度业务能力、组织长任务并可恢复交付”的智能体系统。

终局能力：

```text
自然语言输入
-> 主对话 Agent 持续理解上下文
-> 普通聊天直接自然回复
-> 业务需求时判断可调用能力
-> 缺输入时自然追问或给推荐选项
-> 信息足够时调用业务工具
-> 工具生成真实产物
-> 产物保存到项目、糖葫芦轨道和工作流状态
-> 人工确认、修改或自动继续后续节点
-> 最终交付包
-> 可追踪、可评测、可恢复
```

后端目标不是堆一个大 prompt，也不是把模型压成分类器，而是形成模块化、可插拔、可评测、可替换 provider 的业务调度智能体能力层。

## 2. 现有能力

已有：

- `src/server/conversation/conversation-orchestrator.ts`
  - 已支持 `chat / clarify / start_requirement`。
  - 有 OpenAI-compatible 分支和 deterministic fallback。
  - 已通过结构化 JSON schema 约束模型输出。
- `src/server/agent-runtime/`
  - 有 `AgentRuntime` 边界。
  - 有 `OpenAIRuntime` 和 `DeterministicRuntime`。
  - 支持需求规格、教案、PPT 大纲、导入视频方案、最终交付清单等文本节点。
- `src/server/workbench/`
  - 项目、消息、节点、产物、确认、重做、版本、stale 状态持久化。
- `src/app/api/workbench/projects/[projectId]/messages/route.ts`
  - 保存教师消息。
  - 调用 conversation orchestrator。
  - 决定是否生成需求规格。
- 阶段测试已覆盖 M45/M46/M52/M53 的普通聊天与确认门。

主要短板：

- 意图类型过少，无法表达探索、修改、继续工作流等状态。
- normalizedBrief 太薄，缺少系统化槽位和置信度。
- 推荐选项和 quick replies 主要靠前端规则，后端未成为稳定真源。
- 缺少对话样例集和自动评测，无法稳定提升“听懂需求”的能力。
- 上传材料没有进入真实后端解析和槽位提取。
- 长任务缺少 checkpoint / resume / interrupt 语义。
- prompt 没有形成版本化 PromptPack 管理。

## 3. 架构原则

- React 前端不直接调用模型 SDK。
- 对话理解、能力选择、工具调用、产物生成、附件解析、工作流推进必须在服务端边界内。
- 主模型默认保持自然对话能力，不用模板覆盖模型表达。
- 结构化输出只用于内部决策、工具调用和状态保存，不直接替代用户可见回复。
- 先复用现有 `ConversationOrchestrator`、`AgentRuntime`、Coze PPT、图片、视频等能力，不引入大而全平台。
- 所有工具调用必须有输入合同、输出合同、失败状态和产物回写规则。
- 模型输出必须可校验，但校验失败不能静默冒充成功；fallback 必须标记，并给用户可理解的恢复动作。
- 每个可变能力都要有 deterministic baseline，便于本地演示和回归测试。
- 长期学习 Dify、Open WebUI、Flowise、LangGraph 的设计思想，但不照搬通用平台。

## 4. 目标模块边界

### 4.1 MainConversationAgent

职责：

- 持续接收用户消息和项目上下文。
- 像真实对话模型一样自然回应普通聊天、想法探索和轻量咨询。
- 识别用户是否真的要完成 ShanHaiEdu 业务任务。
- 根据业务能力注册表选择候选工具，而不是自己假装完成产物。
- 缺少工具输入时自然追问或生成 2-3 个推荐选项。
- 工具执行后解释结果、引用产物、建议下一步。

候选文件：

- `src/server/conversation/main-conversation-agent.ts`
- `src/server/conversation/main-agent-schema.ts`
- `src/server/conversation/main-agent-prompts.ts`
- `tests/main-conversation-agent.test.mjs`

主 Agent 输出应包含两层：

```ts
type MainAgentResponse = {
  assistantMessage: {
    title?: string;
    body: string;
  };
  quickReplies: QuickReply[];
  toolPlan?: CapabilityToolPlan;
  requiresUserConfirmation: boolean;
  runtimeKind: "openai" | "deterministic";
};
```

### 4.2 CapabilityRegistry

职责：

- 登记 ShanHaiEdu 已有业务能力。
- 让主 Agent 能知道“我能调用什么”，但不暴露工程细节给教师端。
- 描述每个能力的输入、输出、前置依赖、是否需要人工确认、产物类型和失败恢复方式。

第一批能力：

| 能力 id | 作用 | 输入 | 输出 |
| --- | --- | --- | --- |
| `requirement_spec` | 整理备课需求 | 用户需求、槽位、附件摘要 | Markdown 需求规格 |
| `lesson_plan` | 生成教案 | 已确认需求、教材依据 | Markdown 教案 |
| `ppt_outline` | 生成 PPT 大纲 | 教案或需求规格 | Markdown PPT 大纲 |
| `coze_ppt` | 调用 Coze PPT API 生成 PPTX | PPT 大纲、风格、页数 | PPTX artifact |
| `image_asset` | 调用图片 provider | 图片提示词、场景需求 | 图片 artifact |
| `intro_video` | 调用视频 provider | 视频方案、分镜、图片 | 视频 artifact |
| `final_package` | 打包交付 | 已确认产物集合 | ZIP artifact |

候选文件：

- `src/server/capabilities/capability-registry.ts`
- `src/server/capabilities/types.ts`
- `tests/capability-registry.test.mjs`

### 4.3 CapabilityAdapter

职责：

- 把具体业务能力封装成可调用工具。
- 不让主 Agent 直接拼外部 API。
- 统一返回 `CapabilityRunResult`，包含成功、失败、等待、需要人工确认等状态。
- 成功后写入 artifact store 或返回可保存的 artifact draft。

候选文件：

- `src/server/capabilities/adapters/requirement-spec-adapter.ts`
- `src/server/capabilities/adapters/lesson-plan-adapter.ts`
- `src/server/capabilities/adapters/ppt-outline-adapter.ts`
- `src/server/capabilities/adapters/coze-ppt-adapter.ts`
- `src/server/capabilities/adapters/image-adapter.ts`
- `src/server/capabilities/adapters/video-adapter.ts`
- `tests/capability-adapters.test.mjs`

核心合同：

```ts
type CapabilityToolPlan = {
  capabilityId: string;
  reason: string;
  inputDraft: Record<string, unknown>;
  missingInputs: string[];
  requiresConfirmation: boolean;
};

type CapabilityRunResult =
  | { status: "succeeded"; artifact: SaveArtifactInput; assistantSummary: string }
  | { status: "needs_input"; missingInputs: string[]; assistantPrompt: string }
  | { status: "failed"; userMessage: string; retryable: boolean };
```

### 4.4 ConversationDecisionV2

新增合同：

```ts
type ConversationIntentV2 =
  | "chat"
  | "explore"
  | "clarify_slots"
  | "confirm_requirement"
  | "start_requirement"
  | "revise_requirement"
  | "continue_workflow";

type RequirementSlots = {
  grade?: string;
  subject?: string;
  topic?: string;
  textbookVersion?: string;
  requestedOutputs?: string[];
  durationMinutes?: number;
  teachingStyle?: string;
  materialSource?: string;
};

type RecommendedOption = {
  slot?: keyof RequirementSlots;
  label: string;
  value: string;
  recommended?: boolean;
};

type QuickReply = {
  label: string;
  prompt: string;
  recommended?: boolean;
};

type ConversationDecisionV2 = {
  intent: ConversationIntentV2;
  assistantMessage: {
    title?: string;
    body: string;
  };
  slots: RequirementSlots;
  missingSlots: string[];
  recommendedOptions: RecommendedOption[];
  quickReplies: QuickReply[];
  nextAction: "reply" | "fill_slots" | "confirm" | "generate_requirement" | "revise" | "continue_workflow";
  shouldGenerateArtifact: boolean;
  confidence: number;
  runtimeKind: "openai" | "deterministic";
};
```

定位调整：

- 它不是主 Agent 的全部输出。
- 它用于兼容现有前端 quick replies、槽位确认卡和测试 fixture。
- 后续可由 `MainAgentResponse` 映射生成。
- 用户可见回复应优先来自主 Agent 的自然回复，而不是模板函数。

### 4.5 RequirementSlotService

职责：

- 从用户消息抽取年级、学科、课题、教材版本、交付物、时长、风格、材料来源。
- 合并项目已有信息和最近对话。
- 合并附件摘要。
- 判断缺失槽位。
- 给出推荐选项。

候选文件：

- `src/server/conversation/requirement-slots.ts`
- `src/server/conversation/requirement-options.ts`
- `tests/conversation-slots.test.ts`

### 4.6 ConversationOrchestratorV2

职责：

- 作为旧 `messages` API 到 `MainConversationAgent` 的兼容桥。
- 调用模型或 deterministic fallback。
- 返回 `ConversationDecisionV2`。
- 处理模型 JSON 解析失败、字段缺失、低置信度。
- 保证普通聊天不会生成 artifact。
- 保证确认前不生成需求规格。
- 不再直接用模板覆盖主 Agent 的用户可见回复。

候选文件：

- 修改 `src/server/conversation/conversation-orchestrator.ts`
- 可拆 `src/server/conversation/conversation-schema.ts`
- 可拆 `src/server/conversation/conversation-fallback.ts`

### 4.7 PromptPack

职责：

- 把对话智能体、需求规格、教案、PPT、视频、最终交付的提示词版本化。
- 每个 prompt 有 id、version、适用任务、输出 schema、变更说明。
- 支持回滚和审查。

候选文件：

- `src/server/promptpack/promptpack.ts`
- `src/server/promptpack/prompts/conversation-intake.v1.md`
- `src/server/promptpack/prompts/requirement-spec.v1.md`
- `tests/promptpack-contract.test.ts`

### 4.8 ConversationEvalSet

职责：

- 沉淀对话样例。
- 检查每条输入预期 intent、missingSlots、shouldGenerateArtifact。
- 每次改 prompt 或规则先跑评测。

候选文件：

- `tests/fixtures/conversation-evalset.json`
- `tests/conversation-evalset.test.mjs`
- `scripts/run-conversation-eval.mjs`

样例类别：

- 普通问候。
- 闲聊和陪聊。
- 模糊备课意图。
- 明确备课需求。
- 用户确认。
- 用户修改需求。
- 用户要求继续生成教案/PPT/视频。
- 上传材料后引用。

### 4.9 AttachmentPipeline

职责：

- 接收文件上传。
- 存储附件元数据。
- 解析 md/txt/pdf/docx。
- 生成附件摘要。
- 把摘要送入槽位提取和后续产物生成。

候选文件：

- `src/app/api/workbench/projects/[projectId]/attachments/route.ts`
- `src/server/attachments/attachment-service.ts`
- `src/server/attachments/parsers/text-parser.ts`
- `src/server/attachments/parsers/pdf-parser.ts`
- `src/server/attachments/parsers/docx-parser.ts`
- `tests/attachments.test.mjs`

复用策略：

- md/txt：Node 原生文本读取。
- pdf：优先成熟库，如 `pdf-parse` 或等价维护良好的解析库。
- docx：优先 `mammoth` 或成熟 docx 文本抽取库。
- 图片：第一阶段只存储和预览，OCR 后续阶段再接。

### 4.10 WorkflowCheckpoint

职责：

- 为“自动化跑完整交付”记录每步输入、输出、确认、失败原因、恢复点。
- 支持人工确认 interrupt。
- 支持失败后从最近完成节点继续。

候选文件：

- `src/server/workflow-checkpoints/checkpoint-service.ts`
- `src/server/workflow-checkpoints/types.ts`
- `tests/workflow-checkpoints.test.mjs`

## 5. 利用外部成熟方案

### Dify

可学：

- Workflow 节点输入输出。
- 知识库和 RAG 入口。
- 运行日志和 API 输出。
- 模型 provider 管理。

不照搬：

- 不做通用平台 UI。
- 不把教师端暴露为节点编排器。

### Open WebUI

可学：

- 自托管多模型体验。
- RAG、工具、文件上传的产品组织。
- 本地部署和模型配置体验。

不照搬：

- 不做通用聊天后台。
- 不让用户在教师端管理 provider 细节。

### Flowise

可学：

- 内部 AgentFlow。
- Tracing、Analytics、Evaluations。
- Human in the Loop。

不照搬：

- 不把 canvas 节点图作为教师主界面。

### LangGraph

可学：

- durable execution。
- persistence。
- interrupt / resume。
- human-in-the-loop。

采用策略：

- 第一阶段先实现 TS 轻量 checkpoint 语义。
- 中期再评估是否接 LangGraph 或兼容其状态图思想。

### LibreChat / LobeChat

可学：

- 多模型聊天体验。
- Artifacts。
- 工具和 actions。

不照搬：

- 不做泛聊天产品。
- 产物必须回到 ShanHaiEdu 教学交付链。

## 6. 多阶段拆分

### M54-B0 主 Agent 与能力调度合同纠偏

目标：把后端第一优先级从“意图分类器”纠正为“主对话 Agent 调用业务能力”。

范围：

- 定义 `MainConversationAgent` 合同。
- 定义 `CapabilityRegistry` 合同。
- 定义 `CapabilityToolPlan` 和 `CapabilityRunResult`。
- 明确 `ConversationDecisionV2` 只是兼容层，不覆盖用户可见回复。

验收：

- 普通聊天只返回自然回复，不产生 tool plan。
- 明确 PPT 需求会产生 `ppt_outline` 或 `coze_ppt` 候选 tool plan。
- 缺少必要输入时 tool plan 标记 `missingInputs`，并生成自然追问。
- 工具成功结果必须能映射到 artifact 保存。
- 工具失败不能伪装成功。

### M54-B1 CapabilityRegistry 与第一批业务工具目录

目标：让主 Agent 知道 ShanHaiEdu 有哪些可调用业务能力。

范围：

- 注册 `requirement_spec`、`lesson_plan`、`ppt_outline`、`coze_ppt`、`image_asset`、`intro_video`、`final_package`。
- 给每个能力定义输入、输出、依赖、是否需要确认、产物类型。
- 暂不要求所有 adapter 都真实调用外部服务，但合同必须稳定。

验收：

- 单元测试能列出所有能力。
- 每个能力都有用户可理解名称和内部 id。
- Coze PPT 能力声明依赖 PPT 大纲或教案输入。
- 图片/视频/材料包能力声明产物类型和失败状态。

### M54-B2 MainConversationAgent 最小调度闭环

目标：让真实模型负责自然对话和业务能力选择，而不是只做分类。

范围：

- 主 Agent prompt 强调自然对话优先、工具调用按需。
- 接入 `CapabilityRegistry`。
- 对普通聊天、探索、明确 PPT 需求分别输出自然回复和候选 tool plan。
- 保留 deterministic baseline 做测试兜底。

验收：

- “你好”自然回复，不触发任何能力。
- “我想做一节有意思的百分数课”进入探索和轻量建议。
- “帮我做五年级数学百分数 PPT”选择 PPT 相关能力。
- 缺少教案/PPT 大纲时先建议生成上游输入，而不是直接假装 PPT 完成。

### M54-B3 RequirementSlotService 与 ConversationDecisionV2 兼容层

目标：保留槽位、quick replies 和确认卡能力，但让它服务于主 Agent。

范围：

- 年级、学科、课题、教材版本、交付物、时长、风格、材料来源。
- 缺失槽位判断。
- 推荐选项生成。
- 从 `MainAgentResponse` 映射到 `ConversationDecisionV2`。

验收：

- “三年级数学长方形周长公开课”能抽出年级、学科、课题。
- “帮我做一个课件”给出推荐选项，不直接生成。
- “苏教版六年级百分数，教案和 PPT”进入确认或工具计划准备态。

### M54-B4 Orchestrator v2 与 prompt schema

目标：让真实模型和 fallback 都返回相同合同。

范围：

- 更新 OpenAI JSON schema。
- 更新 deterministic fallback。
- 增加低置信度 fallback。
- 禁止模型把工程词暴露给用户。

验收：

- fake OpenAI 返回 v2 JSON 可解析。
- malformed JSON fallback 到 deterministic。
- “你好”绝不生成 artifact。
- 未确认前不生成需求规格。

### M54-B5 ConversationEvalSet

目标：让对话能力可持续提高，而不是凭感觉调 prompt。

范围：

- 建立 fixture 样例集。
- 建立 eval runner。
- 每次改 prompt 或规则必须跑。

验收：

- evalset 至少覆盖 30 条样例。
- intent 准确率有测试阈值。
- `shouldGenerateArtifact` 误触发为 0。
- tool plan 选择有测试阈值。

### M54-B6 PromptPack

目标：让提示词成为可审查资产。

范围：

- 对话 intake prompt 版本化。
- 需求规格 prompt 版本化。
- 输出 schema 绑定 prompt 版本。

验收：

- prompt 文件可独立审查。
- 测试验证 prompt id 和 schema 存在。
- runtime 记录 prompt version。

### M54-B7 CapabilityAdapter：Coze PPT 最小真实链路

目标：证明“主 Agent 调用业务工具生成真实产物”的核心闭环。

范围：

- 先选 `ppt_outline -> coze_ppt` 或 `lesson_plan -> ppt_outline -> coze_ppt` 的最小链路。
- 封装 `CozePptAdapter`。
- 工具成功后保存 PPTX artifact。
- 工具失败后返回可理解失败信息和可重试状态。

验收：

- 明确 PPT 需求不会只返回文字草稿。
- 缺 PPT 输入时先生成或要求确认 PPT 大纲。
- Coze PPT 成功后 artifact 中有 PPTX 下载信息。
- 糖葫芦 PPT 节点进入可查看或已生成状态。

### M54-B8 AttachmentPipeline

目标：上传材料进入真实后端上下文。

范围：

- 附件上传 API。
- 附件表或持久化记录。
- md/txt/pdf/docx 解析。
- 解析状态和摘要。

验收：

- md/txt 上传后可提取摘要。
- pdf/docx 上传后可进入解析状态。
- 解析失败给可理解错误。
- 附件摘要能进入槽位服务。

### M54-B9 WorkflowCheckpoint 与自动交付准备

目标：为一键跑完整交付提供可恢复后端状态。

范围：

- checkpoint 类型。
- 每个节点记录输入、输出、确认、失败、恢复点。
- 人工确认 interrupt。

验收：

- 从需求规格确认后可继续生成教案。
- 失败后可从最近 checkpoint 继续。
- 自动交付脚本可读取状态并继续。

## 7. 与前端主线的接口

后端提供：

- `ConversationDecisionV2`
- 附件解析状态。
- quick replies。
- 需求确认卡数据。
- 工作流 checkpoint 状态。

前端负责：

- 渲染消息、选项、确认卡。
- 提交用户选择。
- 展示附件状态。
- 展示产物和恢复入口。

第一阶段不要求前端知道模型 provider，也不要求前端自己推断意图。

## 8. 测试与验收矩阵

基础命令：

```text
npm test
npm run build
git diff --check
```

新增测试方向：

- `tests/main-conversation-agent.test.mjs`
- `tests/capability-registry.test.mjs`
- `tests/capability-tool-plan.test.mjs`
- `tests/conversation-decision-v2.test.mjs`
- `tests/conversation-slots.test.mjs`
- `tests/conversation-evalset.test.mjs`
- `tests/coze-ppt-capability.test.mjs`
- `tests/attachments.test.mjs`
- `tests/workflow-checkpoints.test.mjs`

关键断言：

- 普通聊天不会生成 artifact。
- 普通聊天不会产生 tool plan。
- 模糊需求会追问槽位。
- 明确需求会确认，不直接生成。
- 明确 PPT 需求会选择 PPT 相关能力，而不是只走固定模板。
- 缺少 PPT 输入时会先计划上游能力或追问，不假装 PPT 已完成。
- 工具成功必须保存 artifact。
- 工具失败必须给用户可理解恢复动作，不能伪装成功。
- 确认信号才生成需求规格。
- 修改信号进入 revise。
- 继续信号进入 continue_workflow。
- malformed model output 不会污染用户界面。
- fallback 不伪装真实模型。

## 9. 并行协作方式

后端和前端可并行，但必须先完成 B0/B1 合同。

推荐顺序：

1. 后端定义 `MainConversationAgent`、`CapabilityRegistry`、`CapabilityToolPlan`。
2. 后端提供可映射到 `ConversationDecisionV2` 的 fixture。
3. 前端用 fixture 开发 UI。
4. 后端实现主 Agent 最小调度闭环。
5. 集成一个真实能力 adapter，如 Coze PPT。
6. 浏览器跑完整对话到“工具调用 -> artifact 回写 -> 糖葫芦更新”。

## 10. 风险与回退

- 风险：只加 prompt，能力不稳定。
  - 回退：建立 evalset，以测试驱动 prompt 和规则。
- 风险：过早接 LangGraph/Dify/Flowise 导致系统变重。
  - 回退：先实现轻量 TS checkpoint 和模块边界。
- 风险：模型输出不稳定。
  - 回退：严格 JSON schema、parse guard、deterministic fallback。
- 风险：附件解析依赖不稳定。
  - 回退：md/txt 先完整支持，pdf/docx 解析失败也保存原附件和错误状态。
- 风险：槽位规则过窄。
  - 回退：evalset 增加真实教师表达样例，逐步扩充。

## 11. 最近下一步

先进入 M54-B0 + M54-B1：

1. 写 `MainConversationAgent` 与 `CapabilityRegistry` 测试定义。
2. 定义 `CapabilityToolPlan` 和 `CapabilityRunResult`。
3. 注册第一批业务能力，尤其是 `ppt_outline` 与 `coze_ppt`。
4. 明确 `ConversationDecisionV2` 只作为兼容映射，不覆盖主 Agent 自然回复。
5. 输出前端 fixture：自然回复、quick replies、候选工具计划、确认态、工具成功和失败态。
