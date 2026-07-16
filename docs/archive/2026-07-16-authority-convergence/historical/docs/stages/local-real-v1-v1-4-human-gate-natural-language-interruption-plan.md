# ShanHaiEdu V1-4 HumanGate与自然语言打断计划

更新时间：2026-07-13

状态：`done`（见同名closeout）

关联主线：`docs\stages\local-real-v1-mainline-adjustment-plan.md`

## 1. 目标

让教师使用按钮或自然语言都能安全控制当前活动计划：确认、拒绝、暂停、恢复、取消、改道、修改上游内容或请求局部返修。控制动作必须绑定当前ActionOffer与IntentEpoch，不能让隐藏actionId覆盖教师已经修改的真实意图，也不能让旧分支迟到结果污染新分支。

## 2. 当前基线与差距

已有能力：

- `ConversationControlResolver`已能识别直接能力请求、自然语言确认、取消和修订。
- 修订或改道会supersede旧pending plan并推进IntentEpoch。
- GenerationJob、staging和promotion会校验IntentEpoch与fence，迟到结果可quarantine。
- WorkflowRepository在批准新上游Artifact时已有直接下游stale传播。
- PPT领域已有`analyzePptRevisionImpact()`，可以区分页级返修与上游返修。

待关闭差距：

1. 匹配的`confirmedActionId`当前优先于教师文本；点击推荐后实质修改文本仍可能授权旧动作。
2. 暂停和取消被合并成同一种supersede，没有可恢复的暂停Checkpoint和不同生命周期证据。
3. 模糊“继续”与明确高成本确认的语义边界需要形成独立合同，不能只依赖关键词。
4. 通用修订只有笼统`repair_upstream`，尚未持久化结构化影响范围、保留项和失效项。
5. 旧分支Observation/失败仍可能作为活动WorldState输入，需要按IntentEpoch或分支状态隔离，同时保留历史审计。

## 3. 设计

### 3.1 控制决策合同

新增结构化`ConversationControlDecision`字段：

- `lifecycleOutcome`: continue / pause / resume / cancel / supersede / clarify。
- `intentMutation`: none / revise / switch / cancel。
- `requiresNewAction`: 是否必须签发新HumanGate action。
- `impactScope`: whole_offer / upstream / unit / none。

优先级按教师真实意图而不是隐藏字段：

```text
明确取消/暂停/修订/改道
-> 校验并废止旧action
-> 明确绑定确认
-> 唯一安全自然语言继续
-> 消歧或普通对话
```

如果文本与actionId绑定的推荐动作语义一致，允许确认；如果文本被实质修改、改换能力、暂停或取消，旧actionId只能作为来源证据，不能授权旧动作。

### 3.2 暂停与取消分离

- 暂停：pending plan状态改为`paused`，创建`teacher_requested_pause` RunCheckpoint，保留可恢复计划，不签发执行授权。
- 恢复：只有唯一paused plan且IntentEpoch未被其他修订推进时，重新签发新的actionId；旧actionId不复活。
- 取消：状态改为`canceled`，推进IntentEpoch，清除活动Checkpoint；后续必须重新规划。
- 改道/修订：状态改为`superseded`，推进IntentEpoch，创建新的计划或具体消歧问题。

### 3.3 影响分析

通用层只记录可证实的结构化范围，不猜领域细节：

- 改换能力或修改目标：`repair_upstream`，新IntentEpoch。
- 明确页/镜头/字幕等locator且领域Analyzer可解析：`repair_unit`，记录target locator与影响digest。
- PPT修订复用`analyzePptRevisionImpact()`；视频镜头影响分析留给V1-7领域合同。
- 未提供可验证locator时不得伪装成局部返修，转为请求教师补充或上游返修。

影响报告至少包含：source action、previous IntentEpoch、new IntentEpoch、affected stages/locators、preserved artifacts、invalidated approvals、reason和digest。

### 3.4 历史与当前状态隔离

- 历史计划、Observation和失败保留审计。
- AgentWorldState只把当前IntentEpoch有效的控制Observation、Agent Tool Report和Checkpoint作为活动决策输入。
- GenerationJob与staged result继续依靠既有IntentEpoch/fence门禁隔离迟到结果。
- 不删除旧Artifact；只将确定受影响的节点标记stale，未受影响Artifact继续复用。

## 4. 实施切片

1. 新增控制状态、暂停Checkpoint和影响报告合同。
2. 重排Resolver优先级，先识别教师实质修改，再处理actionId确认。
3. 将pause、cancel、revise、switch分别持久化，恢复时签发新action。
4. 在ConversationTurnService中保存控制Observation、Checkpoint与ImpactReport。
5. 过滤旧IntentEpoch活动证据，同时保留历史消息。
6. 覆盖直接输入、按钮原文、编辑按钮文本、多候选消歧、迟到结果和最小失效测试。
7. 专项、全量、构建、SQLite和diff门禁通过后形成closeout。

## 5. 非目标

- 不实现四档生成强度。
- 不调用真实PPT、图片或视频Provider。
- 不完成V1-6 PPT领域全链或V1-7视频镜头领域全链。
- 不用外部Codex替Main Agent决定修改范围。
- 不新增复杂通用DAG引擎或迁移Agent框架。

## 6. 退出标准

- 原样按钮确认与等价自然语言确认可用；实质修改文本时旧action零授权。
- 模糊“继续”不能授权真实Provider或高成本Tool。
- 暂停可恢复但签发新action；取消不可恢复旧计划。
- 改道/修订推进IntentEpoch，旧action和迟到结果稳定失效。
- 影响报告能区分局部与上游返修，并证明未受影响Artifact被保留。
- 多候选无法唯一判断时只提出一个具体消歧问题。
- 教师界面不暴露actionId、IntentEpoch、locator、schema、provider或路径。
- 专项、全量、构建、SQLite连续初始化和`git diff --check`全部通过。
