# ADR：Main Agent 单轮 ReAct 使用确定性检查点压缩

日期：2026-07-14
状态：accepted

## 背景

V1-9R5 真实桌面已证明跨轮 `ContextPackage`、最近消息窗口和 `AgentWorldState` 可以控制普通对话输入，但同一次原生 function-call 循环仍把每轮 Responses 原始 `outputItems`、reasoning、function call 和完整 Tool 输出持续追加到 `continuationHistory`。最多 8 轮时，请求体随轮次增长，Provider 180 秒 continuation timeout 不能再被单独归因为模型或通道。

本决策只关闭 Main Agent 单轮上下文膨胀，不重做 R0-R4，不替换现有 `ContextPackage`、Conversation Log、Artifact、Observation、Guard、ToolRouter 或 Provider Adapter，也不提前进入 V1-9 真实媒体链路。

## 决策

### 1. 单一事实源

- 完整 Conversation Log、Artifact、AgentObservation、ValidationReport、AgentToolReport 和 RunCheckpoint 继续持久化，是审计与恢复事实源。
- 模型生成的自然语言摘要、reasoning 和历史 function call 不是业务事实，不进入长期 ReAct 状态。
- 现有跨轮 `ContextPackage` 继续负责项目、消息、产物和世界状态压缩；单轮新增 `react-checkpoint.v1`，不建立第二套会话记忆。

### 2. `react-checkpoint.v1` 合同

检查点由服务端确定性生成，至少包含：

```text
baseContextDigest
taskId / projectId / TaskBrief digest / IntentEpoch
planRevision / generationIntensity
IntentGrant 的授权与预算摘要
当前合格 Tool 名称
已完成轮次的 Tool、状态、Observation id、reasonCode
Artifact / Report / locator 引用
重复失败聚合、压缩轮数和恢复所需引用
```

所有自由文本、数组和历史条目都有固定上限。超出软预算时先把最旧轮次折叠为 digest 和状态计数，保留最近轮次、Observation 引用和失败事实；不得调用模型总结检查点，也不得将压缩失败改写成成功产物。

### 3. continuation 运输

首轮请求保持原 Responses 结构。每次 Tool 执行并持久化 Observation 后，下一次请求只发送：

```text
原始已压缩 Main Agent 输入
+ react-checkpoint.v1
+ 最近一次合成的 function_call
+ 最近一次 function_call_output 引用
```

`function_call_output` 只包含状态、Observation id 和 checkpoint digest；具体事实读取检查点。旧 reasoning、旧 function call、旧 function output 和完整 Tool structuredOutput 不再重放。当前阶段使用无状态紧凑重放，不依赖第三方 Responses 的 `previous_response_id`。

### 4. 初始请求去重

Main Agent 请求不得同时发送顶层 `contextPackage`、`agentWorldState`、`capabilityAvailability`，又把包含相同对象的完整 `conversationContext` 再发送一次。只保留：

- 顶层权威上下文对象；
- 没有 `ContextPackage` 时的最近消息兼容窗口。

### 5. 脱敏遥测

每次首轮和 continuation 记录：阶段、轮次、请求字符数、估算 token、checkpoint 字符数、检查点 Observation 数、暴露 Tool 数和响应耗时。遥测不记录输入正文、reasoning、Tool 输出、密钥、URL 或本机路径，并随触发消息 metadata 有界保存。

### 6. 预算耗尽必须形成可恢复暂停

当模型在 `maxToolRounds` 已耗尽后仍返回新的 function call 时，该待调用 Tool 不得执行。Harness 必须先发出确定性的预算暂停事件，再结束本轮；事件只携带停止原因、已用/上限轮数、待调用 Tool 名称和本轮已持久化 Observation 引用，不携带用户正文或 Tool 输出。

持久化边界收到事件后必须原子追加：

- 一条 `source=budget`、`reasonCodes=[tool_round_limit_reached, retry_budget_exhausted]`、`minimalNextAction=pause` 的 Observation；
- 一个 `reason=budget_exhausted`、绑定当前 plan revision、待调用 Tool、输入摘要和全部相关 Observation 引用的 `RunCheckpoint`；
- 一条 `run_paused` Tool 暴露轨迹，证明待调用 Tool 没有被执行且恢复入口已经保存。

预算暂停不是 Provider 失败，也不是 HumanGate。教师可见回复必须说明本轮安全预算已耗尽、当前进度已保存并可继续；不得显示通道不可用，不得自动询问教师批准某个内部 Tool，也不得生成 fallback 成果。Checkpoint 持久化属于正确性边界，写入失败时不能吞错或声称已保存。

## 模块边界

```text
main-agent-request-context.ts
  只负责初始模型输入投影和重复字段消除。

main-agent-react-checkpoint.ts
  定义、规范化、预算压缩、digest 和 continuation inputItems。

main-agent-controlled-react-loop.ts
  只负责循环、调用次序、重复/失败熔断、预算暂停事件和遥测回调，不保存原始历史。

main-agent-run-pause.ts
  确定性构造预算 Observation、RunCheckpoint、输入摘要和教师安全暂停文案，不访问数据库。

main-agent-tool-loop-config.ts
  只组合唯一 Tool 资格入口、checkpoint callbacks 和唯一 dispatch，不承载具体 Tool 终态。

main-agent-tool-loop-dispatch.ts
  只协调 epoch/lease、ExecutionEnvelope、HumanGate、Invocation/Skill/Provider准备、既有 dispatcher 和结果处理器的固定调用边界，不选择下一 Tool 或决定重试/停止。

main-agent-tool-loop-checkpoints.ts / main-agent-tool-loop-metadata.ts
  持久化脱敏遥测、预算 Observation、RunCheckpoint 和停止轨迹。

main-agent-tool-loop-*-result.ts / main-agent-tool-loop-observations.ts
  先提交正式 Tool 终态，再提供受限 continuation Observation；不得反向取得循环控制权。
```

Harness 不新增 PPT、视频或整包业务分支；Tool 选择权仍只属于同一个 Main Agent。

## 不采用的方案

- 不依赖 1M 上下文上限继续追加完整历史：容量上限不能解决请求体、延迟和第三方兼容性问题。
- 不用模型自然语言摘要作为唯一检查点：会引入完成状态、授权、版本和血缘漂移。
- 不默认使用 `previous_response_id`：当前兼容 Provider 的跨轮状态和 retention 行为没有形成稳定证据。
- 不只提高 180 秒 timeout：这会掩盖输入膨胀，不能区分仓内责任与 Provider 责任。
- 不压缩或删除数据库原始记录：审计、恢复和旧结果隔离仍依赖完整事实。

## 风险

- 检查点过度裁剪可能让 Main Agent 忘记早期失败。通过 Observation id、reasonCode、状态计数、digest 和最近轮次保留降低风险。
- 某些 Responses 兼容实现可能要求 function call/output 严格配对。每次 continuation 保留最近一次合成 call 与 output，并用合同测试验证顺序。
- 初始请求去重可能影响依赖旧嵌套字段的 Prompt。通过请求投影测试和模型 Agent 回归确认。

## 验证方式

1. 红测试证明第 3 次 continuation 不再含第 1 次 raw reasoning、旧 function call 或旧 Tool output。
2. 大型 raw reasoning 和大型 structured output 不导致 continuation 随轮次无界增长。
3. 检查点保留 TaskBrief digest、IntentEpoch、plan revision、授权、强度、Observation reasonCode、Artifact/Report 引用和当前 Tool 集合。
4. Tool 成功、失败、换 Tool 和 Replan 仍由模型动态选择，不断言固定顺序。
5. 遥测只包含计数、大小和耗时，不包含正文或敏感字段。
6. 运行受影响 Vitest、控制面扩大回归、TypeScript、生产构建和 `git diff --check`。
7. 仓内通过只说明控制面压缩合同成立；真实桌面仍是 R5 关闭证据，且不调用真实媒体 Provider。V1发布前不新增390px真实黑盒，既有窄屏合同与历史证据继续保留。

## 回退方式

回退只撤销 `react-checkpoint.v1` 的请求组装和遥测接线，恢复既有单轮循环；不回滚数据库事实、Artifact、Observation、TaskBrief、IntentGrant 或用户在途改动。若兼容 Provider 拒绝紧凑 call/output 配对，保留确定性检查点与去重设计，单独修 Adapter 运输，不恢复完整 reasoning 历史。
