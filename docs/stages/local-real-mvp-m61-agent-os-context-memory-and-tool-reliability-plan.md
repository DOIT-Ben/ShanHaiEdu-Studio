# M61 Agent OS：上下文记忆、动态节点与工具可靠性规划

日期：2026-07-09

状态：探讨阶段 / 待确认阶段计划；当前只记录方向，不进入具体开发实施

关联文档：

- `docs\product\2026-07-09-agent-os-first-principles-analysis.md`
- `docs\product\2026-07-09-agent-os-requirements-integration.md`
- `docs\product\2026-07-09-mainline-stage-archive-and-open-items.md`
- `docs\product\2026-07-09-conversation-failure-derived-requirements.md`
- `docs\product\2026-07-09-openai-sdk-and-gpt-protocol-adaptation.md`

## 1. 阶段目标

M61 的目标不是继续修单个 PPTX 报错，而是补齐 ShanHaiEdu 作为 Agent 工作台的底层能力：

1. 让模型每轮都有完整、结构化、可信的项目上下文。
2. 让节点状态表达真实业务变化，而不是简单静态开关。
3. 让工具失败变成可观察结果，允许模型重试、降级、换路或询问。
4. 让关键交付能力，尤其 PPTX，具备 fallback 路径。
5. 将门禁从“前置锁死”调整为“真实交付和安全硬门禁 + 过程软约束”。
6. 将 OpenAI SDK 从散落调用收口为 GPT 协议适配层，补齐 Responses API typed items、工具调用、状态链和中转能力探测。

## 2. 范围

### 包含

- `AgentWorldState` 数据结构设计。
- `ContextCompiler` 服务层设计。
- 节点动态状态字段设计。
- 工具健康状态和 fallback 描述设计。
- 工具 observation loop 设计。
- PPTX fallback 策略设计。
- 最新对话卡点中的 pending plan 死锁、假上游记忆、工具不可用暴露和重复失败检测。
- OpenAI SDK / GPT 协议适配核查：Responses API、Chat Completions fallback、Structured Outputs、function calling、`previous_response_id`、OpenAI-compatible 中转能力探测。
- 新旧阶段文档口径整合。

### 不包含

- 本阶段初稿不直接重写所有节点。
- 不立即删除旧阶段实现。
- 不立即替换全部 PPTX 生成链路。
- 不做部署、提交或生产发布。

## 3. 核心设计

### 3.1 AgentWorldState

每轮主控模型调用前构建统一状态：

```ts
type AgentWorldState = {
  goal: string;
  currentStage: string;
  lastUserAction: string;
  completedSteps: AgentStepState[];
  activeNode?: AgentNodeState;
  artifacts: AgentArtifactState[];
  pendingDecisions: AgentPendingDecision[];
  toolHealth: Record<string, AgentToolHealth>;
  fallbackOptions: AgentFallbackOption[];
  risks: string[];
};
```

### 3.2 ContextCompiler

新增上下文编译器，统一从数据库读取：

- project
- messages
- artifacts
- workflow nodes
- generation jobs
- conversation turn jobs
- pending delivery plan
- tool health cache

输出给模型的不是原始数据库表，而是压缩后的工作记忆。

### 3.3 动态节点状态

节点应增加或派生以下语义：

- `usableAsInput`
- `requiresManualReview`
- `confirmationMode`
- `lastProducedArtifactId`
- `version`
- `lastErrorType`
- `retryable`
- `rollbackTarget`
- `downstreamAffected`

### 3.4 工具 observation loop

工具执行结果不直接结束对话，而形成 observation：

```ts
type ToolObservation = {
  toolId: string;
  status: "succeeded" | "failed" | "blocked";
  errorType?: string;
  teacherMessage: string;
  internalDiagnostic?: string;
  retryable: boolean;
  fallbackOptions: string[];
  outputArtifactId?: string;
};
```

随后模型基于 observation 决定下一步。

### 3.5 PPTX fallback

至少规划三条路径：

1. 外部高质量 PPTX：Coze。
2. 本地基础 PPTX：`pptxgenjs`，基于逐页四层设计稿。
3. HTML/SVG 到 PPTX：视觉还原优先。

任何 fallback 产物必须真实保存、真实校验，不得冒充外部高质量生成。

### 3.6 GPT 协议适配层

当前项目已接入 `openai` JavaScript SDK，并使用 `client.responses.create(...)`，但还主要把 Responses API 当作 JSON 文本生成器使用。M61 需要新增或收口服务端 GPT 协议适配层：

```ts
type GptProtocolAdapter = {
  probeCapabilities(): Promise<GptCapabilityProbeResult>;
  runTurn(input: GptTurnInput): Promise<GptTurnResult>;
};
```

该层负责：

- 统一 OpenAI client 创建、超时、错误分类和脱敏日志。
- 探测当前原生 OpenAI 或 OpenAI-compatible 中转是否支持 Responses API、Chat Completions、Structured Outputs、function calling 和 `previous_response_id`。
- 优先使用 Responses API；当中转不完整时，显式降级到 Chat Completions adapter，而不是静默失败。
- 处理 `response.output` typed items，不只读取 `output_text`。
- 将 GPT function call / function_call_output 与 ShanHaiEdu 的 `ToolObservation` 对齐。

本阶段不直接强制引入 OpenAI Agents SDK。Agents SDK 可作为中期 POC，用于评估 tracing、guardrails、handoff、resumable approvals，但 M61 首选保留 ShanHaiEdu 自有业务状态机，并用 Responses API 自建工具闭环。

## 4. 风险

- 过度释放模型可能带来短期不稳定，需要日志和观察能力兜底。
- 过度结构化上下文可能增加 token 成本，需要摘要和裁剪策略。
- fallback 产物质量可能低于外部工具，需要明确标注生成方式和质量等级。
- 旧测试可能假设固定节点顺序，需要分批迁移。
- OpenAI-compatible 中转可能只支持部分协议能力，必须通过 capability probe 实测，不能默认等同原生 OpenAI。
- 只读 `response.output_text` 会丢失 function_call、reasoning、tool output 等 Responses typed items，需要分阶段迁移。

## 5. 验收标准

### 5.1 上下文验收

- 模型能准确说出当前做到哪一步。
- 模型能知道最新产物状态和是否可用作下游输入。
- 模型能区分工具失败、缺输入、质量未达标和用户未确认。

### 5.2 节点验收

- 用户点击“继续下一步”能被解释为继续、确认、重试或需要追问。
- 节点可以回退到指定版本。
- 回退后下游节点被标记为受影响。

### 5.3 工具验收

- Coze PPTX 失败时，模型收到失败 observation。
- 系统能给出至少一个真实 fallback 选项。
- fallback 文件不能冒充外部高质量 PPTX。

### 5.4 门禁验收

- 真实交付失败不显示成功。
- 教师界面不暴露工程词和敏感信息。
- 过程节点不因非关键状态字段卡死模型规划。

### 5.5 卡点复盘验收

- `asset_image_generate` 不可用时，后续“生成图片”“先生成图片”“继续下一步”不能重复撞同一失败文案。
- `upstreamAvailable` 不得包含未真实生成成功的 `pptx_artifact` 或 `image_prompts`。
- 同一工具连续失败应触发 stuck detector，并给出重试、fallback、跳过或重规划选项。

### 5.6 GPT 协议验收

- OpenAI SDK 调用收口到服务端 GPT 协议适配层，React/UI 不直接接触 SDK。
- 当前 provider 能力探测结果可脱敏记录，并能区分 Responses 完整支持、Responses 部分支持、Chat Completions-only 和不可用。
- 至少一个工具链能把工具失败转成 observation 交回模型，而不是直接卡死用户。
- 如果 provider 不支持 function calling，系统有明确降级路径，且不冒充完整 Agent loop。

## 6. 推荐实施顺序

1. 写 `AgentWorldState` 类型和只读编译器。
2. 新增 `GptProtocolAdapter` 规划与能力探测，不改变现有业务行为。
3. 在主控模型请求中替换粗糙的 `availableArtifactKinds`。
4. 增加工具 observation 数据结构，但先不改所有工具。
5. 先接 PPTX 或图片工具 observation 和 fallback 描述。
6. 再扩展到图片、视频和最终包。
7. 最后整理旧节点门禁，迁移硬门禁为软约束或交付门禁。

## 7. 暂停项

在 M61 方案确认前，暂停继续增加以下内容：

- 新的关键词硬拦截。
- 更多节点级 if-else 补丁。
- 只靠外部 PPTX 工具的单路径交付承诺。
- 没有 observation 的工具失败处理。
