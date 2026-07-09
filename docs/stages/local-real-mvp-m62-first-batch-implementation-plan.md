# M62 第一批：AgentWorldState / CapabilityAvailability / GptProtocolAdapter 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or equivalent task-by-task execution. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M61 的 `ContextPackage` 与门禁基础上，给主控模型补齐可信世界状态、动态能力可用性和 GPT 协议适配骨架。

**Architecture:** 本批次采用“新增独立模块 + 最小集成”的方式，避免继续膨胀 `conversation-turn-service.ts`。`AgentWorldState` 汇总项目事实，`CapabilityAvailability` 判断能力当前能否执行，`GptProtocolAdapter` 收口 OpenAI Responses 请求与脱敏诊断；最后由主控模型请求同时携带三者。

**Tech Stack:** Next.js 16 App Router、TypeScript、Vitest、现有 Workbench Service/Repository、OpenAI-compatible Responses client。

---

## 1. 范围

### 本批次做

- 新增 `src\server\conversation\agent-world-state.ts`。
- 新增 `src\server\capabilities\capability-availability.ts`。
- 新增 `src\server\gpt-protocol\types.ts`。
- 新增 `src\server\gpt-protocol\openai-responses-adapter.ts`。
- 新增 `src\server\gpt-protocol\model-capability-probe.ts`。
- 修改 `src\server\agent-runtime\openai-runtime.ts`，让普通节点生成也走 GPT protocol adapter。
- 修改 `src\server\capabilities\capability-planner.ts`，让 fallback planner 不再把当前不可用能力包装成可立即执行。
- 修改 `MainConversationAgentInput`，允许携带 `agentWorldState`、`capabilityAvailability`。
- 修改 `conversation-turn-service.ts`，构建世界状态与能力可用性后传给 agent。
- 修改 `model-main-conversation-agent.ts`，通过 GPT adapter 调用 Responses，并把世界状态和能力可用性放入模型输入。
- 新增/更新测试。

### 本批次不做

- 不改 Prisma schema。
- 不持久化 `SessionContextSnapshot` / `ContextBuildLog`。
- 不实现 `ToolObservation` 写库。
- 不全量替换所有 OpenAI runtime。
- 不处理旧 `conversation-orchestrator.ts` 的历史调用点；它作为 M62 后续遗留项，不据此宣称 GPT adapter 已全局收口。
- 不引入 OpenAI Agents SDK。

## 2. 并发任务拆解

### 任务 A：AgentWorldState 模块

**Files:**

- Create: `src\server\conversation\agent-world-state.ts`
- Test: `tests\agent-world-state.test.ts`

**验收：**

- approved artifacts 进入 `trustedInputs`。
- needs_review artifacts 进入 `draftArtifacts`，不得被标为完成。
- failed generation jobs / turn jobs 进入 `failedJobs`。
- pending plan 能被提取为 `pendingPlan`。
- 输出不包含教师不可见工程词。

### 任务 B：CapabilityAvailability 模块

**Files:**

- Create: `src\server\capabilities\capability-availability.ts`
- Test: `tests\capability-availability.test.ts`

**验收：**

- 内部 draft-only 能力在上游 approved 输入满足时可计划执行。
- 外部 blocked 能力在 provider 未可用时标记 `providerUnavailable`。
- 缺少 approved 上游 artifact 时标记 `needsApprovedInputs`。
- `asset_image_generate` 默认不作为可立即执行能力暴露。

### 任务 C：GptProtocolAdapter 骨架

**Files:**

- Create: `src\server\gpt-protocol\types.ts`
- Create: `src\server\gpt-protocol\openai-responses-adapter.ts`
- Create: `src\server\gpt-protocol\model-capability-probe.ts`
- Test: `tests\gpt-protocol-adapter.test.ts`

**验收：**

- adapter 能把 Responses `output_text` 规范成 `assistantText`。
- adapter 能保留 typed output items 摘要和 diagnostics。
- diagnostics 不回显 api key、bearer token、credential、baseURL 敏感串。
- `src\server\agent-runtime\openai-runtime.ts` 也通过 adapter 发起 Responses 请求。
- capability probe 能表达 `responses_full`、`responses_text_only`、`chat_completions_only`、`unavailable`。
- capability probe 不在 build/test 自动联网；仅分类显式传入的能力事实。

### 任务 D：主链路集成

**Files:**

- Modify: `src\server\conversation\main-conversation-agent.ts`
- Modify: `src\server\conversation\model-main-conversation-agent.ts`
- Modify: `src\server\conversation\conversation-turn-service.ts`
- Modify: `src\server\capabilities\capability-planner.ts`
- Modify: `src\server\agent-runtime\openai-runtime.ts`
- Modify: `tests\model-main-conversation-agent.test.ts`
- Modify: `tests\conversation-turn-service.test.ts` if needed
- Modify: `tests\agent-runtime\openai-runtime.test.ts` if needed
- Modify: `tests\capability-planner.test.ts` if needed

**验收：**

- 模型请求中包含 `agentWorldState`。
- 模型请求中包含 `capabilityAvailability`。
- `availableCapabilities` 不再只表达“目录存在”，同时包含 availability status。
- fallback planner 遇到当前不可用能力时，不返回 `shouldRunToolNow=true` 的可执行计划；教师可见话术必须是“当前暂不能生成 / 需要先确认前置成果”等自然语言。
- 教师可见文案不得包含 `providerUnavailable`、`capabilityId`、`provider`、`runtimeKind`、`debug`、`schema`、`storage`、`local path`、`token`。
- 原 M61 `ContextPackage` 字段仍在。

## 3. 验证命令

```powershell
npx vitest run tests/agent-world-state.test.ts tests/capability-availability.test.ts tests/gpt-protocol-adapter.test.ts tests/model-main-conversation-agent.test.ts tests/conversation-turn-service.test.ts tests/capability-planner.test.ts tests/agent-runtime/openai-runtime.test.ts --maxWorkers=1
```

```powershell
npx tsc --noEmit
```

```powershell
npm run build
```

## 4. 风险控制

- 并发子智能体只创建独立模块和测试，不同时修改集成文件。
- 集成由主控统一完成，避免并发冲突。
- 不提交、不 push，直到所有测试和复审完成。
