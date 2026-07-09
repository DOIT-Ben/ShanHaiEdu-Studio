# M62 可信 AgentWorldState 与工具 Observation 闭环规划

日期：2026-07-09

状态：下一阶段待实施计划

## 1. 阶段目标

M62 目标是在 M61 的上下文契约和门禁骨架上，补齐真实运行闭环：

> 每轮模型看到可信 `AgentWorldState`；工具失败会变成结构化 `ToolObservation`；OpenAI SDK 调用收口到 GPT 协议适配层；能力可用性由真实上游、provider 健康和门禁共同决定。

M62 不做以下事项：

- 不全量引入 OpenAI Agents SDK。
- 不重写全部 workflow engine。
- 不同时重做 PPTX、图片、视频、最终包全部 provider。
- 不把 fallback、deterministic draft、placeholder 冒充真实交付。

## 2. 成功标准

1. 主控模型调用读取 `AgentWorldState` / `ContextPackage`，不再只依赖最近消息和 artifact kind 列表。
2. 至少一个工具链失败会生成 `ToolObservation`，并进入下一轮模型上下文。
3. `asset_image_generate` 不可用时，不重复撞同一失败文案；模型能看到重试、fallback、跳过或重规划选项。
4. OpenAI SDK client 创建、Responses 调用、错误分类和脱敏 diagnostics 收口到 server-only adapter。
5. 动态能力可用性区分“能力目录存在”和“当前可执行”。
6. `npm run build`、`npx tsc --noEmit` 和 M62 相关测试通过。

## 3. 任务拆解

### 任务 A：AgentWorldState / ContextCompiler

目标：把 project、nodes、artifacts、generation jobs、turn jobs、pending plan、context package 编译为模型可用的可信世界状态。

涉及文件：

- 新增 `src\server\conversation\agent-world-state.ts`
- 新增 `src\server\conversation\context-compiler.ts`
- 修改 `src\server\conversation\conversation-turn-service.ts`
- 修改 `src\server\conversation\model-main-conversation-agent.ts`
- 新增 `tests\agent-world-state.test.ts`

验收：

- `needs_review` 不被标记为已完成。
- failed generation jobs 进入风险区。
- approved artifacts 才能进入可信输入区。
- 教师可见文本不含工程词。

### 任务 B：SessionContextSnapshot / ContextBuildLog 持久化

目标：每次上下文构建可追踪，摘要可版本化，但不删除原始 Conversation Log。

涉及文件：

- 修改 `prisma\schema.prisma`
- 修改 `scripts\init-sqlite-schema.mjs`
- 修改 `src\server\workbench\repository.ts`
- 修改 `src\server\workbench\service.ts`
- 修改 `src\server\workbench\types.ts`
- 新增 `tests\session-context-snapshot.test.ts`

验收：

- 一个 project 只有一个 active snapshot。
- validator 失败不启用 snapshot。
- build log 记录 token estimate、mode、source message 范围。

### 任务 C：PromptCompiler + NodeContract 接入

目标：将 ContextPackage / AgentWorldState、NodeContract、Capability availability 编译成主控模型输入。

涉及文件：

- 新增 `src\server\contracts\prompt-compiler.ts`
- 修改 `src\server\contracts\node-contract-types.ts`
- 修改 `src\server\conversation\model-main-conversation-agent.ts`
- 新增 `tests\prompt-compiler.test.ts`

验收：

- prompt 包含当前节点 purpose、constraints、quality gates。
- prompt 不包含本地路径、密钥、provider endpoint、storage 细节。
- 未覆盖 contract 的节点明确标记为未契约化，不伪装成已完成治理。

### 任务 D：GptProtocolAdapter 骨架

目标：把 OpenAI SDK 调用收口到 server-only adapter，保留 Responses typed items、function call、capability probe 接口。

涉及文件：

- 新增 `src\server\gpt-protocol\types.ts`
- 新增 `src\server\gpt-protocol\openai-responses-adapter.ts`
- 新增 `src\server\gpt-protocol\model-capability-probe.ts`
- 修改 `src\server\agent-runtime\openai-runtime.ts`
- 修改 `src\server\conversation\model-main-conversation-agent.ts`
- 新增 `tests\gpt-protocol-adapter.test.ts`

验收：

- adapter 返回稳定内部类型：assistant text、structured output、typed output items 摘要、tool calls、diagnostics。
- 不回显 API key、base URL credential、token。
- provider 能力探测能表达 Responses 完整支持、部分支持、Chat Completions-only、不可用。

### 任务 E：ToolObservation 试点

目标：选择 `asset_image_generate` 做最小 observation 闭环，不再只返回一次性失败文案。

涉及文件：

- 新增 `src\server\capabilities\tool-observation.ts`
- 修改 `src\server\conversation\conversation-turn-service.ts`
- 修改 `src\server\capabilities\capability-runner.ts`
- 修改 `src\server\conversation\model-main-conversation-agent.ts`
- 新增 `tests\tool-observation.test.ts`

验收：

- unsupported capability 生成结构化 observation。
- 下一轮“继续下一步 / 生成图片”不会重复撞同一失败工具。
- observation 不保存假 artifact。
- fallback options 教师可读、不暴露工程词。

### 任务 F：CapabilityAvailability 动态能力可用性

目标：区分能力目录、当前可执行、缺上游、provider 不可用、需要确认。

涉及文件：

- 新增 `src\server\capabilities\capability-availability.ts`
- 修改 `src\server\capabilities\capability-planner.ts`
- 修改 `src\server\conversation\model-main-conversation-agent.ts`
- 新增 `tests\capability-availability.test.ts`

验收：

- provider 不可用能力不作为“可立即执行工具”暴露。
- 不可用能力可作为限制状态交给模型。
- final package 不接收未达标 PPTX、图片、视频。

## 4. 推荐并发执行方式

第一批并发：

- A：AgentWorldState / ContextCompiler
- F：CapabilityAvailability
- D：GptProtocolAdapter 骨架

第二批并发：

- B：SessionContextSnapshot / ContextBuildLog
- C：PromptCompiler
- E：ToolObservation 试点

最终收束：

- 集中验收：`npx tsc --noEmit`、M62 tests、现有 M61 regression、`npm run build`。

## 5. 风险

- `conversation-turn-service.ts` 已偏大，M62 不应继续把所有逻辑塞进去。
- schema 变更需要隔离测试数据库。
- GPT 协议适配不得把中转能力默认等同原生 OpenAI。
- ToolObservation 若只放内存，刷新后会丢；建议写入 message metadata 或 ContextBuildLog。
