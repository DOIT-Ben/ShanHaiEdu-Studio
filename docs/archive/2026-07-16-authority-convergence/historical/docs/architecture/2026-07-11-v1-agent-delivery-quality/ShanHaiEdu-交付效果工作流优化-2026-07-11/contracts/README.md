# Contract 使用边界

本目录是业务逻辑设计资产，不是 ShanHaiEdu 项目代码。

## Contract、Tool 与 Workflow 的关系

- Contract 定义可信输入、最小输出、硬禁止项、质量证据和可返工范围。
- Tool 定义 Agent 能发起的一个高价值动作。
- Workflow Capsule 是 Tool 内部的确定性生产流程。
- Working Plan 是 Main Agent 可修改的临时计划。
- WorkflowNode 是教师可见里程碑。

五者不能一一等同。

## `node-contracts-v2.json` 的解释

`node-contracts-v2.json` 已升级到 schema `2.1`。`recommendedNext` 只表示内容生产中的推荐后继，不是顶层 Agent 的强制转移边；确定性 Capsule 若需要硬转移，必须使用单独的 `capsuleTransitions`。

每条禁止规则都显式标记 `enforcement=must`；每条质量标准都标记 `must`、`should` 或 `may`。执行器只可把 `must` 当硬阻断，`should` 进入评分与返工建议，`may` 保留为创意空间。

禁止直接根据该文件生成一条固定全局 DAG。Main Agent 可以根据 Observation 跳过、回退、并行、替换工具、追问或重规划，只要不违反 MUST Contract 和交付硬门。

## 新增 ReAct 契约

- `agent-decision-envelope.schema.json`：保存可审计决策摘要、可选计划变化和行动意图，不保存原始思维链。
- `tool-observation-v2.schema.json`：统一成功、缺输入、失败、阻断、真实产物和质量结果，供下一轮 Agent 判断。

原生 Tool Call 仍通过模型协议发送。`AgentDecisionEnvelope.actionIntents` 是 Runtime 根据真实 Tool Call 生成的持久化和审计投影，`executionId` 也由服务端注入，不让模型在普通文本中伪造这些权威字段。Schema 已对 `call_tools`、`ask_teacher` 和 `finish` 设置条件约束。
