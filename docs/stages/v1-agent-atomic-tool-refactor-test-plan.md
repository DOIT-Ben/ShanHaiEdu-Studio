# V1.0 Main Agent唯一编排与工作流原子Tool化测试计划

日期：2026-07-16
状态：reopened / additional P1-07 red-green evidence required

## 1. 测试原则

- 每个缺陷先写会失败的特征测试，再做实现。
- 断言控制权、事实提交和可观察行为，不断言固定Tool顺序。
- fixture只证明contract或executor，不写成真实模型编排或产品E2E通过。
- 既有通过测试只做回归，不以重复开发冒充进展。
- 真实浏览器只运行桌面；V1前不跑390px。
- 不调用真实图片、视频、PPTX、ZIP或完整材料包Provider。

## 2. 六组P1特征测试

### P1-01：唯一编排者

红态必须证明：

- 原生ReAct与外层`toolPlan`/`deliveryPlan`同时拥有下一步或执行权；
- forced-next-tool、Adapter、Runner或approve路由可以推进业务Tool；
- Director/Critic被机械插入无审查目标的任务。

绿态必须断言：

- 同一turn只有一个Main Agent循环选择和调用业务Tool；
- 兼容层只验证或投影，不选择、不重试、不执行下一Tool；
- Tool轨迹是动态集合和动态顺序。

### P1-02：TaskBrief、首个Tool与局部范围

场景至少包括：

- 一句话PPT；
- 只做视频脚本；
- 完整材料包规划；
- 七年级或开放式年级；
- 问候和纯聊天。

断言：

- 明确交付任务首轮至少暴露一个能创建第一个Artifact的合格Tool；
- 问候可以没有业务Tool；
- “尚未有Artifact”不能导致明确任务Tool集合为空；
- TaskBrief保留真实requested outputs、排除项、强度和局部范围；
- 只做视频脚本不扩张为教案、PPT、图片、成片或整包。

### P1-03：ExecutionEnvelope与原子提交

断言所有执行入口核验：

- actor、project、task；
- TaskBrief digest；
- IntentEpoch和plan revision；
- 强度、授权、预算和副作用；
- action digest和idempotency key。

负向场景必须证明：

- 缺Envelope或字段不匹配时Executor和Provider调用为0；
- ValidationReport失败时Artifact为0；
- ToolInvocation、ValidationReport、Observation、Artifact和事件不会部分成功；
- 跨task、旧epoch和旧plan结果不能提升。

### P1-04：Observation、失败和HumanGate

断言：

- Tool成功或失败后，具体Observation和reasonCode先持久化；
- Main Agent可根据Observation修输入、换Tool、Replan或暂停；
- 同一Tool连续失败不会自动`ask_teacher`；
- 只有缺少真实选择、授权、预算或存在外发/破坏性副作用时进入HumanGate；
- 重试预算耗尽保存恢复入口，不循环，不生成fallback成果。

### P1-05：控制先提交、改道和隔离

场景至少包括：

- 有pending plan暂停；
- 无pending plan自然语言改道；
- 改道后迟到旧结果；
- 两用户并发执行；
- 同项目重复写者；
- submission_unknown恢复。

断言控制意图和IntentEpoch先提交，旧结果不能改变当前Artifact或任务状态，不发生跨用户、跨项目、跨任务、跨预算串线。

### P1-06：assistant-ui与旧路径退出

断言：

- 自然文本delta在终态前可见；
- function-call参数和内部推理不进入教师界面；
- Tool开始、Observation、失败位置、Artifact和恢复状态按序出现；
- 同一turn只形成一条有序轨迹，终态消息只提交一次；
- 刷新后从持久事件恢复；
- UI不从正文关键词推断状态，不显示固定五阶段或大节点终态替代轨迹；
- approve不调用旧M2推进；无正式package asset时下载失败；deterministic、placeholder和degraded结果不能成为成功Artifact。

### P1-07：自主协作暂停与真实步骤投影

断言：

- `request_teacher_decision` 对当前任务可发现，但是否调用只由 Main Agent 基于语义决定，不按固定 Tool 顺序、节点状态、年级或正则触发；
- 标准授权不等于禁止语义校准；边界清晰时 Main Agent 可以连续推进，边界会实质改变结果时可以创建 `DialogueCheckpoint`；
- `DialogueCheckpoint` 与 `HumanGate` 合同分离，不授予费用、外发、权限或破坏性动作；
- checkpoint 创建后当前 ReAct 不再执行下一业务 Tool，教师自然语言回答后从同一 task、TaskBrief、IntentEpoch 和 plan revision 恢复；
- Tool开始事件包含教师安全的目的、输入依据、预期输出和开始时间，运行中显示真实耗时，Observation后显示实际摘要和总耗时；
- 不显示函数参数、provider、schema、思维链或模拟百分比；
- 同一失败只形成一个具体失败步骤和一个恢复入口，用户消息顶部不再重复泛化失败。

## 3. Runtime隔离A/B

Responses Runtime与OpenAI Agents SDK只在相同冻结TaskBrief、Tool Registry、Gateway和Observation合同下比较：

- 首文本延迟；
- function-call参数完整性；
- Tool call/output配对；
- continuation和恢复；
- Prompt Cache证据；
- 取消和预算停止；
- 事件顺序与终态一致性。

每次A/B使用独立进程、独立数据库和独立task。两个Runtime不得在同一turn共同选择Tool，A/B结果不得自动切换生产Runtime。

## 4. 验证层级

| 层级 | 必须证据 |
|---|---|
| contract | 六组P1单元/合同测试、静态控制权搜索、Schema和类型检查 |
| executor | 独立SQLite原子提交、幂等、失败关闭、暂停恢复和隔离 |
| model orchestration | Main Agent动态Tool选择、Observation/Replan和无外层介入的真实文本Tool轨迹 |
| product E2E | 桌面真实对话、步骤流、失败位置、Artifact入口和刷新恢复 |
| release | 本阶段不执行，不得上推 |

## 5. 执行顺序

1. 单个P1红测试，保存失败责任层。
2. 最小实现后重跑该P1。
3. 重跑直接依赖的既有测试。
4. 每完成一个Slice运行控制面扩大回归。
5. 全部Slice完成后运行TypeScript、单worker全量测试、生产构建和diff检查。
6. 仓内全绿后运行一次桌面真实文本交互，不调用真实交付物Provider。

资源约束：Windows本机测试使用单worker或仓库既有低并发配置，不启动重复dev server，不运行390px。

## 6. 最终Go/No-Go

Go必须同时满足：

- P1-01至P1-06全部有红绿证据；
- 静态和运行时仅一个业务编排者；
- 明确交付任务首轮Tool集合不为空；
- ExecutionEnvelope覆盖全部执行入口；
- Observation、Artifact和事件原子提交；
- 暂停、无pending改道、迟到结果和双用户隔离通过；
- 旧推进、现场拼包和fallback成功路径为0；
- TypeScript、全量测试、生产构建和`git diff --check`通过；
- 桌面真实文本与步骤投影通过；外部Codex业务编排介入为0。

任一项缺失均为No-Go。No-Go只记录具体责任层和恢复入口，不恢复旧控制路径，不进入V1-9。

## 7. 最终结果

- P1-01至P1-06及其直接依赖回归通过，不断言固定Tool顺序。
- Node合同全量383/383；Vitest单worker全量1492/1492，194个测试文件。
- TypeScript、生产构建和`git diff --check`通过；构建保留13条既有Turbopack动态文件追踪警告。
- 桌面生产构建只读验收：assistant-ui viewport为1、固定阶段rail为0、历史真实Tool/Artifact/失败恢复轨迹可见、控制台0错误。
- 本轮没有新模型请求，不调用真实图片、视频、PPTX、ZIP或整包Provider，不运行390px。
- 结论只关闭V1.0仓内控制面和桌面投影，不上推为V1-9或release通过。
