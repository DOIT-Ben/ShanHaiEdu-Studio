# M62 第一批 AgentWorldState / CapabilityAvailability / GptProtocolAdapter 收尾记录

日期：2026-07-09

状态：已完成第一批实现与本地验证；仍有 M62 后续项

## 1. 阶段目标

M62 第一批目标是在 M61 `ContextPackage`、`PlanGuard`、`HumanGate` 基础上补齐三类运行时事实：

- `AgentWorldState`：把已确认输入、待审草稿、失败 job、pending plan 编译为可信世界状态。
- `CapabilityAvailability`：按已确认上游产物和 provider 可用性判断能力是否能执行。
- `GptProtocolAdapter`：把 OpenAI-compatible Responses 请求收口到统一 adapter，并提供脱敏 diagnostics 与模型能力分类骨架。

本批次坚持“不扩 schema、不持久化快照、不引入 OpenAI Agents SDK、不伪装真实交付”的边界。

## 2. 已完成内容

### 2.1 AgentWorldState

- 新增 `src\server\conversation\agent-world-state.ts`。
- 已把 `approved + isApproved` artifact 编入 `trustedInputs`。
- 已把未确认 artifact 编入 `draftArtifacts`，不作为已完成事实。
- 已把 failed generation jobs / conversation turn jobs 编入 `failedJobs`。
- 已把 pending delivery plan 编入 `pendingPlan`。
- 已通过 `conversation-turn-service.ts` 进入主控模型上下文。

### 2.2 CapabilityAvailability

- 新增 `src\server\capabilities\capability-availability.ts`。
- 能力状态包括：`available`、`needs_approved_inputs`、`provider_unavailable`、`blocked`。
- 上游 artifact 必须同时满足 `status=approved` 与 `isApproved=true` 才能作为已确认输入。
- 外部且 blocked fallback 的能力在 provider 未显式可用时不会被标记为可立即执行。
- fallback planner 已接入 `capabilityAvailability`，当前不可用能力不会被包装成可确认执行计划。
- `conversation-turn-service.ts` 执行前已增加二次门禁：即使模型返回 `shouldRunToolNow=true`，只要能力不可用，也不会创建 artifact 或 generation job。

### 2.3 GptProtocolAdapter

- 新增 `src\server\gpt-protocol\types.ts`。
- 新增 `src\server\gpt-protocol\openai-responses-adapter.ts`。
- 新增 `src\server\gpt-protocol\model-capability-probe.ts`。
- `model-main-conversation-agent.ts` 已通过 adapter 调用 Responses。
- `agent-runtime\openai-runtime.ts` 已通过 adapter 调用 Responses。
- diagnostics 已覆盖 key、token、credential、baseURL 等敏感字段脱敏测试。

### 2.4 主链路集成

- `MainConversationAgentInput` 已允许携带 `agentWorldState` 与 `capabilityAvailability`。
- `conversation-context-builder.ts` 已把 M62 状态与 M61 `ContextPackage` 一起编译进主控模型上下文。
- `model-main-conversation-agent.ts` 的模型输入已包含：
  - `contextPackage`
  - `agentWorldState`
  - `capabilityAvailability`
  - `availableCapabilities[].availability`
- 教师可见文案测试覆盖工程词屏蔽边界。

## 3. 验证记录

已通过以下验证：

```powershell
npx vitest run tests/agent-world-state.test.ts tests/capability-availability.test.ts tests/gpt-protocol-adapter.test.ts tests/model-main-conversation-agent.test.ts tests/main-conversation-agent.test.ts tests/capability-planner.test.ts tests/conversation-context-builder.test.ts tests/agent-runtime/openai-runtime.test.ts tests/conversation-turn-service.test.ts tests/route-level-generation-gate.test.ts src/server/workbench/__tests__/stage60-conversation-turn-queue.test.ts tests/context-budget.test.ts tests/summary-validator.test.ts tests/session-compactor.test.ts tests/node-contract-registry.test.ts tests/plan-guard.test.ts tests/human-gate.test.ts tests/capability-registry.test.ts tests/capability-runner.test.ts --maxWorkers=1
```

结果：19 files passed，153 tests passed，0 failed。

```powershell
npx tsc --noEmit
```

结果：exit 0。

```powershell
node --test tests/workbench-api.test.mjs tests/m47-composer-api-wiring.test.mjs tests/m60-video-workflow-contract.test.mjs
```

结果：28 tests passed，0 failed。

```powershell
npm run build
```

结果：Next.js build、TypeScript、静态页面生成均通过，exit 0。

## 4. 行为变化

- 完整交付链路不再把 `needs_review` draft 当作下一步可用输入；教师需先确认上一步产物。
- 外部真实生成能力默认不会因目录存在而被当成可立即执行。
- 模型输出若尝试绕过能力可用性，服务端执行前会被 `CapabilityAvailability` 门禁拦截。
- GPT adapter 已覆盖主控模型与普通节点 runtime，但未宣称全局所有历史调用点已收口。

## 5. 残余风险与后续项

- `conversation-orchestrator.ts` 仍是历史 GPT 调用遗留点，本批次未处理。
- `SessionContextSnapshot` / `ContextBuildLog` 尚未持久化。
- `ToolObservation` 写库尚未实现。
- provider 可用性当前未接真实健康检查，仍是显式输入/默认不可用策略。
- `NodeContractRegistry` 尚未成为所有 artifact save / quality gate 的硬约束。
- 已吸收二阶段 ReAct 与工业级 Agent Harness 思想，但统一口径不是裸 ReAct 循环：不确定任务可两阶段判断，确定流程必须交给工作流、契约和 runner；上下文只是模型可见状态，不是系统真实状态源。下一阶段按 `docs\stages\local-real-mvp-m63-agent-harness-observation-budget-plan.md` 补 `ToolObservation`、预算熔断和上下文构建持久化。

## 6. 提交边界建议

纳入：M62 第一批代码、测试、计划和本收尾记录。

排除：

- `.env*`
- `.playwright-cli\**`
- `*.bak`
- `API台账系统\**`
- `docs\qa-audits\**\*.mp4`

提交前必须再次确认 staged diff 不含密钥、token、账号、个人敏感信息。
