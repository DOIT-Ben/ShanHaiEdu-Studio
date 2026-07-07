# Agent Runtime Stage 1 Plan

日期：2026-07-07

## 1. 第一性原理：本阶段核心需求

本阶段要先把生成能力从前端和业务状态里拆出来，形成一个可替换的 `AgentRuntime` 合同。Runtime 只负责接收“项目上下文、当前文本节点、用户消息、已确认上游产物”，输出“助手回复、artifact draft、摘要、下一步建议和运行元信息”。项目、节点、产物版本和确认状态由后端主线保存，本阶段不持久化业务状态。

成功标准：

- 无 OpenAI key 时，`DeterministicRuntime` 也能为完整文本链路稳定产出 artifact draft。
- 输出覆盖：需求规格、教材证据、教案、PPT 大纲、导入视频方案、最终交付清单。
- deterministic 输出必须明确标记为结构草稿，不能伪装成真实模型生成。
- 用户可见失败恢复不出现 `provider`、`schema`、`debug`、堆栈、密钥或本地路径。
- OpenAI 接入只预留服务端边界，不进入 React 组件。

关键假设：

- 本阶段不依赖后端数据库完成，输入输出合同先以 TypeScript 类型和 contract tests 固化。
- Artifact 保存和工作流推进由 `Backend Workflow Lite` 主线消费本合同。
- Stage 1 只完成 deterministic 可测闭环和 OpenAI 研究结论；真实 OpenAI 调用放到 Stage 2。

## 2. 可复用方案调研

已核验一手来源：

- OpenAI Node SDK README：官方 TypeScript/JavaScript SDK 提供 OpenAI REST API 访问，主 API 是 Responses API，示例使用 `client.responses.create(...)` 并读取 `response.output_text`。来源：https://github.com/openai/openai-node
- OpenAI Node SDK README：浏览器支持默认关闭，只有显式 `dangerouslyAllowBrowser` 才能启用，因为会暴露 secret credentials。结论：OpenAI SDK 只能在服务端 Runtime Adapter 层使用。来源：https://github.com/openai/openai-node
- OpenAI Agents SDK JS README：Agents SDK 面向多 agent workflow，支持 agents、tools、handoffs、guardrails、sessions、tracing，适合后续复杂编排；但它要求 Node.js 22+，本阶段先不引入，避免把首个 adapter 复杂化。来源：https://github.com/openai/openai-agents-js
- 项目既有架构文档 `docs\mvp-to-production-agent-architecture.md` 已明确：MVP 先做 `DeterministicRuntime` 与 `OpenAIRuntime`，业务状态不由 SDK 承载。

复用结论：

- Stage 1 复用 TypeScript interface + deterministic golden tests 的成熟工程方法。
- Stage 2 再复用 OpenAI Node SDK 的 Responses API。
- Agents SDK 暂不接入代码，只写入边界判断：等出现多 agent handoff、guardrail、trace 需求时再评估。

## 3. 复用、适配与自研组合

复用：

- 复用项目现有 `ArtifactKind` 作为节点种类基础，避免另造一套前端不认识的枚举。
- 复用 Vitest 做合同测试，项目当前没有测试框架，Vitest 与 Next/TypeScript 栈匹配且可局部运行。
- 复用 OpenAI SDK 的 Responses API 作为后续 OpenAIRuntime 接入方向。

适配：

- 新增 `src\server\agent-runtime\`，只放服务端 runtime 合同和实现。
- Runtime 输出的 teacher-facing 文案使用“结构草稿”“正式授课前请核对”等表达，不向教师暴露工程词。
- deterministic runtime 不写随机数、不读时间、不访问网络，确保 E2E 稳定。

必要自研：

- `AgentRuntimeInput` / `AgentRuntimeResult` 合同。
- 节点任务到 artifact draft 的 deterministic 生成规则。
- 面向教师的失败恢复归一化函数。

## 4. 开发方案、风险和验证标准

阶段拆分不超过 20 个阶段，当前主线按 4 阶段推进：

1. Stage 1：主线阶段拆分、OpenAI 调研、`AgentRuntime` 合同、`DeterministicRuntime`、contract/golden tests。
2. Stage 2：`OpenAIRuntime` 服务端边界、Responses API request builder、可注入 client、无 key fallback。
3. Stage 3：节点 prompt/输出结构补强，覆盖教材证据、教案、PPT、视频、最终交付的质量约束。
4. Stage 4：失败恢复、自检清单、收尾审查、敏感信息与工程词扫描、合并结论。

Stage 1 文件计划：

- 新增：`src\server\agent-runtime\types.ts`
- 新增：`src\server\agent-runtime\deterministic-runtime.ts`
- 新增：`src\server\agent-runtime\index.ts`
- 新增：`tests\agent-runtime\deterministic-runtime.test.ts`
- 新增：`tests\agent-runtime\runtime-contract.test.ts`
- 修改：`package.json`

风险：

- 后端主线的 Artifact/AgentRun 字段可能变化。控制方式：合同只定义 runtime 交付最小集，后端可做适配映射。
- deterministic 输出被误用为真实模型产物。控制方式：结果元信息和 artifact notice 双标记。
- Stage 1 过度设计。控制方式：不引入 SDK、不做持久化、不做 prompt 工厂。

集中验收：

- `npm test -- --maxWorkers=2` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- 检查 `src\components` 中没有 OpenAI SDK 引用。
- 检查用户可见恢复文本不含 `provider|schema|debug|stack|OPENAI_API_KEY|local path`。
