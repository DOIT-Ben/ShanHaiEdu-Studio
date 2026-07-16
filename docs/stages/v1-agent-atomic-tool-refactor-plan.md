# V1.0 Main Agent唯一编排与原子Tool控制面整改计划

日期：2026-07-17

状态：REMEDIATION IN PROGRESS / CONTRACT RED

整改前基线：`b4ad3849f6ae0953f3dfe856ce000e0def292023`

## 1. 目标与边界

本计划是当前唯一修复主线。目标是让现有实现真正满足`..\architecture\V1.0 重构设计.md`，而不是新增竞争架构。

本轮处理现有审查确认的8项P1和7项P2，按根因从控制与授权、任务语义、事实提交、消息投影到健康恢复依次修复。每阶段先红测试、后最小实现、再真实验证和本地提交。

本轮不运行真实图片、视频、PPTX、ZIP或整包Provider，不进入V1-9、教师签收、部署或390px真实黑盒，不做无关重构。

## 2. 当前统一状态

### 已实现

- assistant-ui、MessagePart和AgentEventEnvelope已有生产接入基础，固定五阶段与legacy会话入口已退出。
- native function-call是生产消息路由，TaskBrief、IntentEpoch、ExecutionEnvelope和原子事实表已有实现基础。
- 单Tool真实需求规格回合成功；模糊改道讨论未误触Tool或IntentEpoch。
- 最终包下载已存在正式package asset反向绑定边界。

### 阶段A已关闭

- RMD-P1-01：native HumanGate已持久化PendingDecision/actionId、blocked invocation、教师事件和恢复checkpoint。
- RMD-P1-02：暂停、取消与明确改道已在入队事务中推进epoch/revision并隔离迟到结果。
- RMD-P1-06：quick reply action已成为正文与上下文绑定的一次性token。
- RMD-P2-05：Tool启动前已复核持久IntentGrant，旧授权不能进入执行路径。

### 尚未满足设计

| ID | 级别 | 已确认问题 | 根因/责任层 |
|---|---|---|---|
| RMD-P1-03 | P1 | Tool Registry仍强制`requirement_spec`旧依赖链 | Tool资格模型 |
| RMD-P1-04 | P1 | TaskBrief输出粒度把局部PPT/视频/图片扩张为完整交付 | 任务语义与完成合同 |
| RMD-P1-05 | P1 | PPT批量资产N次Provider请求只计一次预算且无逐调用事实 | Provider调用原子性 |
| RMD-P1-07 | P1 | 同turn文本与Tool事件被重排为活动在前、合并文本在后 | 消息投影排序 |
| RMD-P1-08 | P1 | 任意旧Tool失败可遮蔽不同原因的最终`run_failed` | 失败身份与去重 |
| RMD-P2-01 | P2 | 客户端仍含固定“正在理解/正在组织...”伪等待文案 | 等待态投影 |
| RMD-P2-02 | P2 | 任意completed projection会隐藏真实等待提示 | 等待态生命周期 |
| RMD-P2-03 | P2 | Dispatcher blocked路径持久化与返回的Observation ID不一致 | Observation身份 |
| RMD-P2-04 | P2 | 失败Tool的ValidationReport digest返回模型但报告未持久化 | 原子失败提交 |
| RMD-P2-06 | P2 | Provider未配置时native intake抛内部错误，绕过教师安全回复 | 入口错误恢复 |
| RMD-P2-07 | P2 | `/api/health`不检查新增列和控制面表 | schema readiness |

### 已废弃方案

- 固定DAG、forced-next-tool、宏节点自动推进和工作流defaults控制任务范围。
- outer `toolPlan`/`deliveryPlan`作为第二编排者。
- 固定五阶段UI、正文关键词推断状态和伪进度文案。
- 用closeout、旧R5、旧测试数字、fixture或health 200替代当前Go/No-Go。

## 3. 唯一修复路线

### 阶段A：控制与授权

阶段状态：**LOCAL GO**（本地阶段提交完成；总整改门仍为RED）。

涉及：RMD-P1-01、P1-02、P1-06、P2-05。

修改范围：消息POST入口、turn queue/control store、HumanGate恢复、ExecutionEnvelope权威校验、quick reply提交合同。

验收：

- HumanGate原子创建PendingDecision/actionId并可由同一task恢复。
- 控制消息先持久化并提升epoch/revision，在途旧结果不能提升。
- 编辑后的quick reply不携带旧action确认。
- invocation开始前复核数据库中的当前IntentGrant；旧授权调用为0。

本阶段实际完成：native HumanGate现在持久化同一task绑定的PendingDecision、actionId、blocked invocation、教师事件和恢复checkpoint；暂停、取消与明确改道在消息入队事务中先提升IntentEpoch和plan revision并失效旧计划，迟到结果不得提升；quick reply action成为一次性正文绑定token；Tool启动前以持久IntentGrant为权威复核。阶段B至E问题均未在本阶段宣称关闭。

### 阶段B：任务语义与Tool边界

涉及：RMD-P1-03、P1-04、P1-05。

修改范围：TaskBrief schema、requested outputs、完成合同、Tool Registry资格、PPT资产批量执行与Provider调用事实。

验收：

- 合法局部任务可直接选择对应原子Tool，不强制需求规格前置。
- PPT大纲、分镜、资产说明等局部输出能成为终态，不扩张为PPTX/成片/真实图片。
- 每个真实Provider子调用独立计预算、持久化submission和结果；部分失败可恢复且不重复扣费。

### 阶段C：Observation与消息投影

涉及：RMD-P1-07、P1-08、P2-01、P2-02、P2-03、P2-04。

修改范围：Dispatcher、失败原子提交、stream projection、message adapter/renderers、等待态与失败去重。

验收：

- 返回给调用方/模型的Observation和ValidationReport均可由同一持久ID解析。
- 同turn文本、Tool、Observation和Artifact按真实发生顺序投影。
- 失败按原因和终态身份去重，不由旧失败遮蔽新`run_failed`。
- 无持久化活动事实时只显示中性等待与真实耗时；completed历史投影不隐藏当前等待。

### 阶段D：健康与恢复

涉及：RMD-P2-06、P2-07。

修改范围：native intake错误边界、provider readiness映射、health schema检查。

验收：

- Provider未配置时返回教师安全、可恢复的结构化失败，不泄露内部错误。
- health检查当前代码依赖的关键表、列和控制面表；缺任一项返回非ready及机器可读原因。

### 阶段E：扩大回归与真实桌面

涉及：全部RMD问题。

修改范围：仅测试、验证记录和当前权威文档，不新增业务范围。

验收：

- Node合同、独立SQLite单worker Vitest、TypeScript、Lint（若项目脚本存在）、生产构建、`git diff --check`全部通过。
- 本地服务从当前HEAD启动，health与核心桌面对话流程通过。
- 至少覆盖普通对话、局部单Tool、HumanGate恢复、在途控制、失败恢复和刷新后顺序；不调用本轮禁止的媒体/整包Provider。
- 活动README、架构、需求、主线、计划、测试和代码口径一致。

## 4. 实施纪律

- 每阶段只解决列出的RMD问题；发现新问题先记入当前plan/test-plan再决定是否阻塞。
- 每个缺陷先保存红测试证据；测试必须使用显式隔离SQLite和受限worker。
- 不使用mock、fallback、假数据、硬编码成功结果，不删除测试或降低校验标准。
- 每阶段同步代码、测试和文档，验证后单独本地提交；不push。
- 不查询或清理审查期间可能写入的默认SQLite，除非用户另行明确授权。

## 5. 完成定义

只有`v1-agent-atomic-tool-refactor-test-plan.md`全部Go门通过，且阶段E真实验证完成，才可把状态改为`REMEDIATION VERIFIED`并形成新的closeout。当前过期closeout不得恢复。

完成本整改仍不自动等于R5、V1-9或release通过；Provider连续多轮稳定性和后续真实产品链路必须分别取证。
