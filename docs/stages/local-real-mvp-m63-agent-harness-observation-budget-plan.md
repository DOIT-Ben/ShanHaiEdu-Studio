# M63 Agent Harness / ToolObservation / 预算熔断规划

日期：2026-07-09

状态：下一阶段规划；等待 M62 第一批提交后实施

## 1. 阶段背景

M61 已建立 `ContextPackage`、`PlanGuard`、`HumanGate` 与异步队列基础。M62 第一批已补齐 `AgentWorldState`、`CapabilityAvailability` 和 `GptProtocolAdapter` 骨架，让主控模型能看到更可信的世界状态和能力可用性。

M63 吸收二阶段 ReAct 与工业级 Agent Harness 思想，但采用山海智教自己的统一口径：

```text
不确定任务，两阶段；确定流程，工作流。
模型负责判断；门禁负责安全；工具负责执行；数据库负责记忆；上下文负责呈现状态。
上下文是模型可见状态，不是系统真实状态源。
```

因此 M63 不追求“模型无限循环”，而是建立一个受控的执行闭环：模型可以判断和计划，系统必须用契约、门禁、预算、observation 和真实状态源约束执行。

## 2. 阶段目标

M63 的目标是补齐 M62 之后的最小工业级闭环：

1. `ToolObservation`：工具失败、provider 不可用、质量门禁失败能结构化记录，并进入下一轮上下文。
2. `SessionContextSnapshot` / `ContextBuildLog`：上下文构建和摘要可追踪、可审计、可恢复，但不删除原始 Conversation Log。
3. `AgentHarnessBudget`：用耗时、重试、重复动作、连续失败和上下文预算控制 Agent 循环。
4. `Workflow/Runner` 边界收窄：确定流程由契约和 runner 推进，不继续把业务分支塞进 `conversation-turn-service.ts`。

## 3. 明确不做项

本阶段不做：

- 不引入 OpenAI Agents SDK 作为主运行框架。
- 不做无限 ReAct 循环。
- 不全量重写 workflow engine。
- 不一次性接所有 provider 健康检查。
- 不做复杂 Admin 可视化。
- 不把 observation 写成教师可见工程日志。
- 不把上下文摘要当作真实状态源。

## 4. 任务拆解

### 任务 A：ToolObservation 数据结构与最小写入

目标：让工具调用失败、provider 不可用、质量门禁失败拥有结构化 observation，并可在下一轮上下文中被模型读取。

建议落点：

- 新增 `src\server\capabilities\tool-observation.ts`
- 修改 `src\server\capabilities\capability-runner.ts`
- 修改 `src\server\conversation\agent-world-state.ts`
- 修改 `src\server\conversation\conversation-turn-service.ts`
- 新增 `tests\tool-observation.test.ts`

最小字段：

```text
observationId
projectId
turnId / jobId
capabilityId
kind: provider_unavailable | tool_failed | quality_gate_failed | blocked_by_policy | retry_exhausted
status: active | resolved | superseded
teacherSafeSummary
internalReasonSanitized
retryPolicy
createdAt
```

验收：

- unsupported / provider unavailable 不创建假 artifact。
- 下一轮模型能看到“上一轮为什么没执行成功”。
- 教师可见文本不暴露 provider、runtimeKind、本地路径、token、schema。
- 同一失败不会无限重复撞工具。

### 任务 B：ContextBuildLog / SessionContextSnapshot 持久化

目标：把上下文构建记录和摘要版本化落到真实状态源，而不是只存在内存或模型上下文里。

建议落点：

- 修改 `prisma\schema.prisma`
- 修改 `scripts\init-sqlite-schema.mjs`
- 修改 `src\server\workbench\repository.ts`
- 修改 `src\server\workbench\service.ts`
- 新增 `tests\session-context-snapshot.test.ts`
- 新增 `tests\context-build-log.test.ts`

验收：

- 原始 Conversation Log 保留，不因摘要删除。
- 同一 project 只有一个 active snapshot。
- SummaryValidator 失败时不启用 snapshot。
- ContextBuildLog 记录上下文来源、预算、摘要版本、截断策略和 validation 结果。
- 日志不保存密钥、本地路径、provider endpoint。

### 任务 C：AgentHarnessBudget 与循环熔断

目标：不采用玩具式 `max_turns=10` 截断，但要用预算和熔断控制真实任务。

建议落点：

- 新增 `src\server\conversation\agent-harness-budget.ts`
- 修改 `src\server\conversation\conversation-turn-service.ts`
- 修改 `src\server\guards\plan-guard.ts`
- 新增 `tests\agent-harness-budget.test.ts`

预算维度：

```text
maxWallTimeMs
maxToolCallsPerTurn
maxRetryPerCapability
maxSameActionRepeat
maxConsecutiveFailures
maxContextBudgetTokens
requiresHumanGateForSideEffects
```

验收：

- 相同不可用能力不会在同一项目里连续自动重试超过阈值。
- 高副作用动作仍必须经过 HumanGate。
- 预算耗尽时生成可恢复失败状态和教师可读下一步建议。
- 不影响普通确定流程一次性执行。

### 任务 D：确定流程从模型判断中剥离

目标：把“已确认上游 + 能力可用 + 契约明确”的路径交给 runner/workflow 推进，减少模型反复判断。

建议落点：

- 新增或扩展 `src\server\workflow\workflow-runner.ts`
- 修改 `src\server\conversation\conversation-turn-service.ts`
- 修改 `src\server\capabilities\capability-planner.ts`
- 新增 `tests\workflow-runner.test.ts`

验收：

- 已确认教案进入 PPT 设计稿、已确认设计稿进入 PPTX、已确认分镜进入视频等确定流程，有明确 runner 判断。
- runner 仍服从 `NodeContract`、`CapabilityAvailability`、`PlanGuard`、`HumanGate`、`Quality Gate`。
- `conversation-turn-service.ts` 不新增大段业务分支。

## 5. 推荐实施顺序

```text
先提交 M62 第一批
-> A ToolObservation 最小闭环
-> C AgentHarnessBudget 熔断
-> B ContextBuildLog / Snapshot 持久化
-> D WorkflowRunner 边界收窄
-> 集中验收与复审
```

原因：Observation 和预算熔断先建立“不会无限撞工具”的安全底线；Snapshot / BuildLog 涉及 schema，放在安全底线后单独处理；WorkflowRunner 再承接确定流程剥离。

## 6. 风险与回退

- `prisma\schema.prisma` 修改属于数据结构变更，必须单独验证 SQLite 初始化和既有 API 测试。
- `conversation-turn-service.ts` 已偏大，M63 每个新增逻辑都应优先拆文件。
- Observation 若先用 message metadata 过渡，必须明确后续迁移到独立表的删除条件。
- 预算熔断过严会让长任务提前停止；过松会重复扣费或卡死。初版应保守，优先保护真实 provider 和教师体验。
- 若 M63 引发回归，可回退到 M62 的能力门禁和 pending plan 行为，不删除原始 Conversation Log 和 artifact。

## 7. 集中验收命令

实施完成后至少执行：

```powershell
npx vitest run tests/tool-observation.test.ts tests/agent-harness-budget.test.ts tests/session-context-snapshot.test.ts tests/context-build-log.test.ts tests/workflow-runner.test.ts tests/conversation-turn-service.test.ts tests/model-main-conversation-agent.test.ts tests/main-conversation-agent.test.ts tests/capability-planner.test.ts --maxWorkers=1
```

```powershell
npx tsc --noEmit
```

```powershell
node --test tests/workbench-api.test.mjs tests/m47-composer-api-wiring.test.mjs tests/m60-video-workflow-contract.test.mjs
```

```powershell
npm run build
```

验收结论必须记录：测试文件数、测试数、失败数、构建 exit code、是否有教师可见工程词泄露、是否有假 artifact 或假完成状态。
