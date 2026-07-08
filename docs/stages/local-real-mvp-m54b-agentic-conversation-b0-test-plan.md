# M54-B0 后端主对话 Agent 与能力目录测试定义

日期：2026-07-08

状态：正式测试定义。M54-B 后端开发必须先按本文写红测，再实现。

上游规划：

- `docs/stages/local-real-mvp-m54b-agentic-conversation-architecture-plan.md`
- `docs/stages/local-real-mvp-m54b-agentic-conversation-implementation-roadmap.md`

## 1. 目标

先锁住后端智能体的核心合同：

```text
普通聊天不触发工具
探索需求不生成产物
明确业务需求形成工具计划
工具计划尊重上游依赖
工具失败不能伪装成功
```

M54-B0 不追求真实 provider 全部跑通，重点是把 `MainConversationAgent`、`CapabilityRegistry`、`CapabilityPlanner` 的边界和行为测住。

## 2. 新增测试

### 2.1 CapabilityRegistry

文件：

```text
tests/capability-registry.test.ts
```

断言：

- registry 包含第一批能力：
  - `requirement_spec`
  - `lesson_plan`
  - `ppt_outline`
  - `coze_ppt`
  - `image_asset`
  - `intro_video`
  - `final_package`
- 每个能力都有用户可理解 `userLabel`。
- 每个能力都有 `artifactKind` 和 `workflowNodeKey`。
- `coze_ppt` 依赖 `ppt_outline`。
- 外部 provider 能力默认 `requiresConfirmation: true`。
- registry 不包含 secret、token、key、url 等敏感字段。

### 2.2 CapabilityPlanner

文件：

```text
tests/capability-planner.test.ts
```

断言：

- 明确 PPT 需求在没有 PPT 大纲时，优先计划 `ppt_outline`，并把 `coze_ppt` 放入上游完成后的建议。
- 已有 PPT 大纲时，可以计划 `coze_ppt`，但必须需要确认。
- “帮我做课件”缺少年级/学科/课题时返回 missingInputs。
- 普通聊天不产生 tool plan。

### 2.3 MainConversationAgent

文件：

```text
tests/main-conversation-agent.test.ts
```

断言：

- “你好”返回自然回复，state 为 `chatting`，`toolPlan` 为空。
- “我想聊聊五年级百分数公开课怎么设计”进入 `exploring`，不生成 artifact。
- “帮我做五年级数学百分数 PPT”进入 `awaiting_confirmation` 或 `planning_tools`，产生 PPT 相关 tool plan。
- 缺少必要输入时返回 2-3 个 quick replies 或 recommendedOptions。
- `shouldRunToolNow` 默认 false，除非有明确确认和安全工具。

### 2.4 CapabilityRunner 失败合同

B0 可先写合同测试，B5 再实现完整 runner。

文件：

```text
tests/capability-runner.test.ts
```

断言：

- adapter 返回失败时，runner 返回 `status: "failed"`。
- failed 结果必须包含 `userMessage` 和 `retryable`。
- failed 结果不能包含 artifactDraft。
- deterministic draft 必须标记 `providerStatus: "deterministic_draft"`。

## 3. fixture

新增：

```text
tests/fixtures/conversation-evalset.json
```

B0 最少 10 条：

- 2 条普通聊天。
- 2 条探索公开课想法。
- 2 条模糊备课需求。
- 2 条明确 PPT/教案需求。
- 1 条确认信号。
- 1 条修改需求。

后续 M54-B9 扩展到 30 条以上。

## 4. 阶段验收命令

第一批：

```text
npx vitest run tests/capability-registry.test.ts tests/capability-planner.test.ts tests/main-conversation-agent.test.ts tests/capability-runner.test.ts --maxWorkers=1
```

集中：

```text
npm test
npm run build
git diff --check
```

## 5. 通过门

- 普通聊天误触发 tool plan 数量为 0。
- 未确认前外部 provider 调用数量为 0。
- 工具失败不返回 succeeded。
- 用户可见回复不由 route 模板覆盖主 Agent 回复。
- 所有新增合同都是服务端边界，React 组件不得直接调用模型 SDK。
