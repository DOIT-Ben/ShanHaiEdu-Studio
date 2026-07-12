# V1 Stage 2：可执行合同、质量决策与受控 ReAct 计划

更新时间：2026-07-12
状态：Stage 2A/2B/2C completed

## 1. 目标

把现有“Agent 选能力、PlanGuard/HumanGate、ToolRouter 执行、Artifact 保存”提升为可核验循环：

```text
Observe
-> Plan
-> ContractPreValidator + Guard
-> Act through ToolRouter
-> ContractPostValidator
-> ValidationReport
-> optional CriticReport
-> deterministic QualityDecision
-> Observation
-> Replan / Ask / Pause / Finish
```

顶层仍是可改道的 Main Agent，不生成固定全局 DAG。WorkflowNode 只表达教师可见里程碑；Contract 只硬约束事实、安全、授权、血缘与真实交付。

## 2. 当前基线与缺口

已存在：

- `AgentWorldState`、`ContextPackage`、PlanGuard/HumanGate、ToolRouter。
- 失败型 ToolObservation 与 AgentHarnessBudget。
- 5 份旧 Node Contract 配置和只读 registry。
- Provider Artifact Truth / QualityGate 基础证明。
- Stage 1A/1B/1C 的身份、租约、输入快照、恢复、staging 与原子提升。

缺口：

1. Node Contract 未进入 ToolRouter 前后主链。
2. 当前合同数组是无 enforcement 的字符串，系统无法区分 MUST/SHOULD/MAY。
3. 成功结果没有持久化 ValidationReport；文件真值与效果真值混在布尔字段中。
4. Critic 可以被设计为模型工具，但尚无结构化、只读、不可覆盖硬门的边界。
5. 没有确定性 QualityDecisionEngine，模型推荐仍可能被误当权威结论。
6. 成功 observation 没有携带报告和 nextAction，当前 delivery plan 仍偏固定推进。

## 3. 分段实施

### Stage 2A：合同与 ValidationReport

- 新增 runtime contract projection：以 ToolDefinition 为最低合同，published Node Contract 作为增强层。
- 规则显式区分 `must / should / may`；只有 must 可阻断。
- ContractPreValidator 校验 tool、项目、已批准输入、输入种类与当前可执行状态。
- ContractPostValidator 校验 output kind/node、真实文件证明、结构化硬门与证据引用。
- 生成 canonical digest 的不可变 ValidationReport；证据缺失为 `inconclusive`，不得猜测 passed。
- Provider 结果只有 ValidationReport passed 才能进入 Stage 1C 原子提升；失败/不确定结果保持 staging/quarantine。
- 内部 Tool 结果保存 Artifact 与 ValidationReport 时保持同一短事务或同等原子边界。

### Stage 2B：CriticReport 与 QualityDecision

- 定义 TargetLocator：artifact/page/asset/shot/track/time_range/frame_range。
- Delivery Critic 只消费不可变 artifact/render/media/evidence snapshot，输出 advisory CriticReport。
- Critic 不能重判文件、hash、页数、ffprobe、lineage、授权与 Provider 实传。
- EffectiveRubric 在生成前绑定版本与 digest；分数只允许 `95/80/60/30/not_scorable`。
- QualityDecisionEngine 固定按 `block > repair > pass` 计算；同一输入必须得到同一结果。
- 报告缺失、digest 不匹配、Validation failed/inconclusive、必需维度 not_scorable 均 block。

### Stage 2C：Observation 回流与 Replan

- 成功、合同失败、质量返修、证据不足都形成统一 Observation。
- Observation 包含 report refs、reason codes、target locators、responsible stage、minimal next action。
- Main Agent 收到 Observation 后可 continue、repair_unit、repair_upstream、ask_teacher、pause 或 finish。
- 同工具、同 inputHash、同失败 reason 连续两次时禁止原样重试。
- 预算耗尽保存 checkpoint 并暂停，不把 run 判成成功。
- finish 必须引用当前 Artifact + ValidationReport + QualityDecision 证据；模型文字不能单独完成节点。

## 4. 数据边界

首批持久化模型：

```text
ValidationReportRecord
CriticReportRecord
QualityDecisionRecord
```

共同要求：projectId、capabilityId、stage、target kind/id/version/digest、inputHash、contract/rubric/policy ref、canonical digest、状态、结构化 payload、createdAt。Artifact 尚未原子提升时可先绑定 GenerationJob/staging target，提升后在同一事务绑定 result Artifact。

报告只进入服务端可信 WorldState；教师端只显示可理解结论、定位与下一步，不暴露 schema、provider、storage、路径、hash 或内部 ID。

## 5. 合同适配策略

- 不直接把迁入的 `node-contracts-v2.json` 当运行时全局 DAG。
- 当前已执行 Tool 先由 ToolDefinition 生成最低可执行合同，保证 17 个已注册能力都有输入/输出边界。
- 现有 `config\node-contracts\*.json` 升级为显式 enforcement，并覆盖对应关键能力。
- PPT/视频生产阶段新增的 narrative/PageSpec/ShotSpec 等合同随 Stage 3/4 发布；Stage 2 先把执行器、报告与决策机制做对。
- recommendedNext 只进入 Agent 规划提示，不成为系统强制转移。

## 6. 修改范围

预计新增：

```text
src\server\contracts\runtime-contract.ts
src\server\contracts\contract-validator.ts
src\server\quality\quality-types.ts
src\server\quality\validation-report.ts
src\server\quality\critic-report.ts
src\server\quality\quality-decision-engine.ts
src\server\quality\quality-report-repository.ts
tests\contract-validation.test.ts
tests\quality-decision-engine.test.ts
tests\react-observation-replan.test.ts
```

预计修改 ToolRouter、conversation-turn-service、Stage 1C promotion、Prisma schema 与 SQLite 初始化脚本。每个子阶段完成后先跑专项与受影响回归，Stage 2C 后才做完整 closeout。

## 7. 风险与控制

| 风险 | 控制 |
|---|---|
| 合同过度约束创作 | 只有 must 阻断；should 进入 Critic/repair；may 保留自由 |
| 旧产物缺结构化字段被全部阻断 | ToolDefinition 最低合同先落地；增强合同按 capability/version 逐步发布 |
| Critic 覆盖硬门 | authority 固定 advisory；Decision Engine 不读取 Critic 的硬门判断 |
| 报告与 Artifact 版本错配 | target digest/version/inputHash 必须一致；不一致 block |
| ReAct 变无限循环 | 现有预算 + 同输入同失败去重 + checkpoint/pause |
| 把计划做成固定 DAG | Working Plan 可选可改；recommendedNext 仅建议 |

## 8. 完成标准

- 2A/2B/2C 测试计划全部通过。
- 所有生产 ToolRouter 调用有运行时合同投影。
- Provider/内部 Tool 成功均产生可追溯 ValidationReport。
- QualityDecision 相同输入确定性一致，Critic 无法覆盖硬门。
- 至少一个失败结果在同一教师请求中形成 Observation 并触发不同的合法 Replan，而不是固定下一节点。
- 自然语言修改/改道后旧计划和旧质量决定失效。
- 完整测试、生产构建、diff 检查通过后才关闭 RQ-023。
