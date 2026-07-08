# M54-B 后端对话智能体持续升级路线

日期：2026-07-08

状态：正式阶段路线 / 待测试定义与开发切片。

## 1. 终极目标

把 ShanHaiEdu 后端从“能根据关键词进入产物链”升级为“能理解教师意图、补齐需求槽位、组织长任务并可恢复交付”的对话智能体系统。

终局能力：

```text
自然语言输入
-> 意图识别
-> 需求槽位抽取
-> 缺失信息追问
-> 推荐选项生成
-> 需求确认
-> 产物节点生成
-> 人工确认或修改
-> 自动继续后续节点
-> 最终交付包
-> 可追踪、可评测、可恢复
```

后端目标不是堆一个大 prompt，而是形成模块化、可插拔、可评测、可替换 provider 的智能体能力层。

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
- 对话理解、槽位补齐、产物生成、附件解析、工作流推进必须在服务端边界内。
- 先复用现有 `ConversationOrchestrator` 和 `AgentRuntime`，不引入大而全平台。
- 所有模型输出必须结构化校验，失败时 fallback 且记录原因。
- 每个可变能力都要有 deterministic baseline，便于本地演示和回归测试。
- 长期学习 Dify、Open WebUI、Flowise、LangGraph 的设计思想，但不照搬通用平台。

## 4. 目标模块边界

### 4.1 ConversationDecisionV2

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

### 4.2 RequirementSlotService

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

### 4.3 ConversationOrchestratorV2

职责：

- 调用模型或 deterministic fallback。
- 返回 `ConversationDecisionV2`。
- 处理模型 JSON 解析失败、字段缺失、低置信度。
- 保证普通聊天不会生成 artifact。
- 保证确认前不生成需求规格。

候选文件：

- 修改 `src/server/conversation/conversation-orchestrator.ts`
- 可拆 `src/server/conversation/conversation-schema.ts`
- 可拆 `src/server/conversation/conversation-fallback.ts`

### 4.4 PromptPack

职责：

- 把对话智能体、需求规格、教案、PPT、视频、最终交付的提示词版本化。
- 每个 prompt 有 id、version、适用任务、输出 schema、变更说明。
- 支持回滚和审查。

候选文件：

- `src/server/promptpack/promptpack.ts`
- `src/server/promptpack/prompts/conversation-intake.v1.md`
- `src/server/promptpack/prompts/requirement-spec.v1.md`
- `tests/promptpack-contract.test.ts`

### 4.5 ConversationEvalSet

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

### 4.6 AttachmentPipeline

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

### 4.7 WorkflowCheckpoint

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

### M54-B1 ConversationDecisionV2 合同

目标：建立前后端共享的结构化对话决策合同。

范围：

- 定义 intent v2。
- 定义 slots、missingSlots、recommendedOptions、quickReplies。
- 保持旧 API 兼容或提供 mapper。

验收：

- 单元测试验证普通聊天、模糊需求、明确需求、确认信号。
- 前端可用 fixture 渲染。

### M54-B2 需求槽位服务

目标：让系统理解教师需求里的结构化信息。

范围：

- 年级、学科、课题、教材版本、交付物、时长、风格、材料来源。
- 缺失槽位判断。
- 推荐选项生成。

验收：

- “三年级数学长方形周长公开课”能抽出年级、学科、课题。
- “帮我做一个课件”进入 `clarify_slots`。
- “苏教版六年级百分数，教案和PPT”进入确认。

### M54-B3 Orchestrator v2 与 prompt schema

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

### M54-B4 ConversationEvalSet

目标：让对话能力可持续提高，而不是凭感觉调 prompt。

范围：

- 建立 fixture 样例集。
- 建立 eval runner。
- 每次改 prompt 或规则必须跑。

验收：

- evalset 至少覆盖 30 条样例。
- intent 准确率有测试阈值。
- `shouldGenerateArtifact` 误触发为 0。

### M54-B5 PromptPack

目标：让提示词成为可审查资产。

范围：

- 对话 intake prompt 版本化。
- 需求规格 prompt 版本化。
- 输出 schema 绑定 prompt 版本。

验收：

- prompt 文件可独立审查。
- 测试验证 prompt id 和 schema 存在。
- runtime 记录 prompt version。

### M54-B6 AttachmentPipeline

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

### M54-B7 WorkflowCheckpoint 与自动交付准备

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

- `tests/conversation-decision-v2.test.mjs`
- `tests/conversation-slots.test.mjs`
- `tests/conversation-evalset.test.mjs`
- `tests/attachments.test.mjs`
- `tests/workflow-checkpoints.test.mjs`

关键断言：

- 普通聊天不会生成 artifact。
- 模糊需求会追问槽位。
- 明确需求会确认，不直接生成。
- 确认信号才生成需求规格。
- 修改信号进入 revise。
- 继续信号进入 continue_workflow。
- malformed model output 不会污染用户界面。
- fallback 不伪装真实模型。

## 9. 并行协作方式

后端和前端可并行，但必须先完成 B1 合同。

推荐顺序：

1. 后端定义 `ConversationDecisionV2` 类型和 fixture。
2. 前端用 fixture 开发 UI。
3. 后端实现 slot service 和 orchestrator v2。
4. 集成真实 API。
5. 浏览器跑完整对话到需求确认。

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

先进入 M54-B1 + M54-B2：

1. 写 `ConversationDecisionV2` 测试定义。
2. 定义共享类型和 mapper。
3. 实现 deterministic slot extraction baseline。
4. 更新 fake OpenAI schema 测试。
5. 输出 quick replies 和 recommended options 给前端 fixture。
