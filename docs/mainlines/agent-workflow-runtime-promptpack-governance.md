# Agent Workflow Runtime & PromptPack Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 ShanHaiEdu-Studio 的可调优智能体运行时主线，让节点流、提示词、skills、审查门、人工确认和产物状态可版本化、可追溯、可迁移。

**Architecture:** 代码只负责稳定运行机制，业务策略进入 `NodeSpec`、`PromptPack`、`SkillBinding`、`ReviewGate` 和 `HumanGate`。MVP 阶段先做文档合同和 deterministic runtime 样例，不接真实 provider；等四条 MVP 主线完成集成后再进入实现分支。

**Tech Stack:** Next.js 16、React 19、TypeScript、后端 API 路由、后续 Prisma/SQLite 或 PostgreSQL、OpenAI SDK / OpenAI Agents SDK 仅限服务端 Runtime Adapter 层。

---

## 1. 第一性原理

教师要的是稳定产物链路，不是 agent 内部画布。系统必须做到：

- 每个节点知道自己使用了哪些上游 approved 产物。
- 每个节点产物可以被复制、查看、复用、重审和重做。
- 提示词、skills、审查规则可以人工调优，但不能散落在 UI 事件和后端 if 分支里。
- 真实 provider 接入必须晚于 deterministic 链路和状态合同。
- 普通教师界面只看自然语言结果，不看工程词。

因此本主线不是“多加几个智能体”，而是建立一套运行时控制面：

```text
WorkflowEngine
-> NodeSpec Registry
-> PromptPack Registry
-> SkillBinding Registry
-> AgentRuntime
-> ReviewGate
-> HumanGate
-> ArtifactStore
-> RuntimeTrace
```

## 2. 已验证参考与复用策略

参考来源：

- Claude Code settings 文档：配置存在 user/project/local/managed 等层级，项目配置适合团队共享，local 配置适合个人实验。参考链接：`https://code.claude.com/docs/en/settings`
- Claude Code subagents 文档：专项 agent 可以独立上下文、独立工具权限和独立系统提示词。参考链接：`https://code.claude.com/docs/en/sub-agents`
- Claude Code hooks 文档：生命周期事件可用于自动检查、审查和拦截。参考链接：`https://code.claude.com/docs/en/hooks`
- OpenAI Agents SDK：提供 agents、tools、handoffs、guardrails、tracing 等模式。参考链接：`https://openai.github.io/openai-agents-python/`
- OpenAI conversation state：长期对话状态不应只靠前端记忆，需要服务端状态管理和可恢复上下文。参考链接：`https://developers.openai.com/api/docs/guides/conversation-state`
- 初代 ShanHaiEdu 复盘：`SHANHAIEDU_LEGACY_RETROSPECTIVE.md`

复用方式：

- 复用 Claude Code 的“分层配置、子智能体隔离、hooks 生命周期”思想，不照搬目录结构。
- 复用 OpenAI Agents SDK 的 handoffs、guardrails、tracing 概念，不把 SDK 直接塞进前端组件。
- 复用初代 ShanHaiEdu 的 workflow schema、skills catalog、runtime policies、PPT/视频经验，但只吸收合同和机制，不搬旧业务代码。

## 3. 主线边界

本主线负责：

- 定义节点运行合同。
- 定义 PromptPack 和 SkillBinding 版本规则。
- 定义 ReviewGate / HumanGate / RuntimeTrace。
- 定义 deterministic runtime 样例。
- 定义后续真实 provider adapter 的接缝。

本主线不负责：

- 直接生成真实 PPTX。
- 直接生成真实图片或视频。
- 建设后台可视化调参 UI。
- 替代 Backend / Frontend / Runtime / E2E 四条 MVP 主线。

## 4. 文件结构

计划创建：

- `docs\agent-runtime\node-spec-contract.md`：节点输入、输出、状态、上游依赖和重审规则。
- `docs\agent-runtime\promptpack-contract.md`：提示词包结构、版本、适用节点、变更审查。
- `docs\agent-runtime\skillbinding-contract.md`：skills 绑定、工具权限、输入输出边界。
- `docs\agent-runtime\review-gate-contract.md`：审查维度、阈值、重试上限、失败回退。
- `docs\agent-runtime\human-gate-contract.md`：人工确认、跳过、重做、继续生成的状态转移。
- `docs\agent-runtime\runtime-trace-contract.md`：面向开发者的 trace 与面向教师的 summary 分离。
- `docs\agent-runtime\deterministic-runtime-sample.md`：不接真实 provider 的最小可测运行样例。

计划后续实现时创建：

- `src\server\agent-runtime\node-spec.ts`
- `src\server\agent-runtime\promptpack.ts`
- `src\server\agent-runtime\skillbinding.ts`
- `src\server\agent-runtime\review-gate.ts`
- `src\server\agent-runtime\human-gate.ts`
- `src\server\agent-runtime\runtime-trace.ts`
- `src\server\agent-runtime\deterministic-runtime.ts`
- `src\server\agent-runtime\__tests__\runtime-contract.test.ts`

## 5. 阶段拆分

### Stage 1: 文档合同冻结

目标：完成 `docs\agent-runtime\` 合同文档，不写运行时代码。

- [ ] **Step 1: 创建 `docs\agent-runtime\node-spec-contract.md`**

写入必须字段：

```text
node_key
title
teacher_title
agent_role
input_artifact_kinds
output_artifact_kind
required_approved_inputs
prompt_pack_ref
skill_binding_refs
review_gate_refs
human_gate
retry_policy
stale_downstream_policy
public_projection
```

- [ ] **Step 2: 创建 `docs\agent-runtime\promptpack-contract.md`**

写入版本规则：

```text
promptpack_id
version
owner
target_node_keys
system_brief
developer_brief
teacher_visible_style
forbidden_terms
examples
change_reason
review_required
```

- [ ] **Step 3: 创建 `docs\agent-runtime\skillbinding-contract.md`**

写入绑定规则：

```text
skill_id
version
allowed_node_keys
allowed_tools
input_contract
output_contract
teacher_visible
failure_mode
security_notes
```

- [ ] **Step 4: 创建 `docs\agent-runtime\review-gate-contract.md`**

写入评分门：

```text
review_gate_id
dimensions
min_score
max_attempts
block_conditions
fallback_policy
teacher_recovery_message
developer_trace_fields
```

- [ ] **Step 5: 创建 `docs\agent-runtime\human-gate-contract.md`**

写入人工状态：

```text
needs_user
approved
revise_requested
continue_with_warning
skip_with_reason
```

- [ ] **Step 6: 创建 `docs\agent-runtime\runtime-trace-contract.md`**

写入两层输出：

```text
teacher_summary: 面向教师，不出现工程词
developer_trace: 面向开发者，可记录节点、provider、错误分类，但不得记录密钥或敏感值
```

- [ ] **Step 7: 创建 `docs\agent-runtime\deterministic-runtime-sample.md`**

写入最小链路：

```text
用户一句话需求
-> 需求澄清
-> 需求规格 artifact
-> 人工确认
-> 教材证据 artifact
-> 教案 artifact
```

验收：

```powershell
git diff --check
npm run build
```

### Stage 2: Deterministic Runtime 合同测试

目标：在代码中只实现可测 deterministic runtime，不接真实 provider。

- [ ] **Step 1: 写 `src\server\agent-runtime\__tests__\runtime-contract.test.ts`**

测试必须覆盖：

```text
1. 缺少 approved 上游产物时，节点进入 needs_user 或 blocked。
2. 产物生成后保存 artifact version。
3. 人工确认后，下一节点可以读取 approved artifact。
4. 上游产物变更后，下游节点标记 needs_review，但旧内容保留。
5. teacher_summary 不包含工程词。
```

- [ ] **Step 2: 实现最小类型和 deterministic runtime**

只实现内存或现有 repository 接口适配，不引入真实 provider。

- [ ] **Step 3: 运行阶段测试**

```powershell
npm run build
npm test
```

如果 `npm test` 尚未定义，则阶段内必须补充明确 test script 或记录替代命令。

### Stage 3: PromptPack / SkillBinding Registry

目标：把节点提示词和 skills 绑定从代码中移出，进入可版本化 registry。

- [ ] **Step 1: 写 registry 类型测试**
- [ ] **Step 2: 实现读取和校验**
- [ ] **Step 3: 增加禁止工程词扫描**
- [ ] **Step 4: 运行阶段验收**

验收：

```powershell
npm run build
npm test
```

### Stage 4: ReviewGate / HumanGate

目标：将质量审查和人工确认变成状态机合同，不依赖单个 agent 自觉。

- [ ] **Step 1: 写 ReviewGate 阈值测试**
- [ ] **Step 2: 写 HumanGate 状态转移测试**
- [ ] **Step 3: 实现最小状态转移**
- [ ] **Step 4: 运行阶段验收**

验收：

```powershell
npm run build
npm test
```

### Stage 5: OpenAI / Provider Adapter 接缝

目标：只定义 adapter 接口和配置边界，不在本阶段调用真实 provider。

- [ ] **Step 1: 写 adapter 接口文档**
- [ ] **Step 2: 写安全边界测试**
- [ ] **Step 3: 实现 noop adapter 与 deterministic adapter**
- [ ] **Step 4: 确认私有 API 台账只通过 `docs\private-api-ledger.md` 引用**

验收：

```powershell
git check-ignore -v -- ShanHaiEdu-API-Ledger-Standalone-PRIVATE.zip ShanHaiEdu-API-Ledger-Standalone/
npm run build
npm test
```

## 6. 风险与回退

- 风险：过早把真实 provider 放进 runtime，导致基础状态链路不可测。回退：只保留 deterministic adapter。
- 风险：PromptPack 变成散乱 markdown。回退：先冻结字段合同，再允许新增包。
- 风险：ReviewGate 只写分数，不阻断产物。回退：低于阈值必须进入 failed 或 needs_user。
- 风险：教师侧看到工程词。回退：所有 teacher projection 都走 forbidden terms 扫描。
- 风险：新主线与四条 MVP 主线抢合同。回退：Stage 1 只产出文档，等 MVP Integration 后再实现。

## 7. 启动条件

同时满足以下条件后再新开实现分支：

- Backend Workflow Lite Stage 1 已提交并通过。
- Agent Runtime Adapter Stage 1 已提交并通过。
- Frontend API-backed Workbench 已能读取真实节点和 artifact。
- E2E Verification 已跑通最小链路或明确阻塞。
- `main` 已合并四条主线第一轮稳定产物。

推荐分支名：

```text
feature/agent-workflow-runtime-promptpack-governance
```

## 8. 当前裁决

Decision：先登记为后续独立主线，当前不新开实现分支。

Reasoning：

- 四条 MVP 主线正在并行，马上再开实现分支会扩大协调面。
- 该主线依赖 Backend 的状态真源和 Runtime 的最小 adapter。
- 当前最有价值的是冻结合同和验收口径，避免后续 PPT/视频能力继续堆到 prompt 或 UI。

Gate：continue。

Next：四条 MVP 主线 Stage 1 收尾后，按本文 Stage 1 创建 `docs\agent-runtime\` 合同文档。
