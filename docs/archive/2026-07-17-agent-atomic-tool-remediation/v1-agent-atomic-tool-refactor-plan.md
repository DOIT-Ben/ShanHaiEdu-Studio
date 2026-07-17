# V1.0 Main Agent唯一编排与原子Tool控制面整改计划

日期：2026-07-17

状态：REMEDIATION VERIFIED / CONTRACT GO

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

### 阶段B已关闭

- RMD-P1-03：Registry固定`requirement_spec`依赖已移除，Tool资格只由完整TaskBrief、可信输入和共享范围策略决定。
- RMD-P1-04：requestedOutputs使用canonical细粒度枚举；TaskBrief冻结课程上下文、初始可信输入引用和质量目标；局部PPT、视频及纯图片范围不再被扩张。
- RMD-P1-05：PPT批次逐Provider submission计预算并持久化，部分失败停止且恢复不重复扣费。
- 暂停状态合同补充收敛：教师可见plan为`paused`，TaskAggregate为`paused_recovery`；恢复保持task/digest/epoch并原子清除普通恢复点，ReAct checkpoint保留到模型续轮读取。

### 阶段C已关闭

- RMD-P1-07：实时与刷新共用sequence timeline reducer；同Tool状态合并并保留sequence首尾，文本、Tool、Observation、Artifact和终态不再按类型重排。
- RMD-P1-08：终态失败只在reasonCode和完整evidenceRefs相同时去重，不同原因不得被旧Tool失败遮蔽。
- RMD-P2-01/P2-02：删除客户端伪等待阶段；只有当前pending turn的持久活动能隐藏中性等待，历史completed不再误判live。
- RMD-P2-03：Dispatcher blocked返回、事件、Invocation和存储复用同一Observation ID。
- RMD-P2-04：失败ValidationReport先校验并重签为invocation-bound报告，与Observation/Event原子持久化后才返回模型引用。

### 阶段D已关闭

- RMD-P2-06：Provider未配置时，native intake和普通respond均返回教师安全的结构化`failed_retryable`，不再回退deterministic或泄露内部错误；消息只投影一个真实`retry`恢复入口。
- RMD-P2-07：health与production preflight共用显式SQLite schema合同，检查控制面表、消息parts、Artifact任务绑定、TurnJob失败恢复字段和GenerationJob提交/结果字段；缺表或缺列返回机器可读原因且不泄露路径。

### 整改外尚未完成

- R5连续多轮Provider稳定性、V1-9、教师签收和release不属于本整改关闭范围，仍按当前主线和backlog管理。

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

本阶段实际完成：native HumanGate现在持久化同一task绑定的PendingDecision、actionId、blocked invocation、教师事件和恢复checkpoint；暂停原子保存恢复点并保持task/digest/IntentEpoch，取消与明确改道才提升IntentEpoch和plan revision并失效旧计划，迟到结果不得提升；quick reply action成为一次性正文绑定token；Tool启动前以持久IntentGrant为权威复核。阶段B至E问题均未在本阶段宣称关闭。

### 阶段B：任务语义与Tool边界

阶段状态：**LOCAL GO**（总整改门仍为RED）。

涉及：RMD-P1-03、P1-04、P1-05。

修改范围：TaskBrief schema、requested outputs、完成合同、Tool Registry资格、PPT资产批量执行与Provider调用事实。

验收：

- 合法局部任务可直接选择对应原子Tool，不强制需求规格前置。
- PPT大纲、分镜、资产说明等局部输出能成为终态，不扩张为PPTX/成片/真实图片。
- 每个真实Provider子调用独立计预算、持久化submission和结果；部分失败可恢复且不重复扣费。

本阶段实际完成：建立canonical `TaskRequestedOutput`、课程上下文/输入/质量绑定和局部完成合同；CapabilityAvailability、Main Agent Tool暴露和ToolRouter共用requested/excluded scope；移除教案、PPT大纲和课程锚点固定需求规格前置；outer Tool补齐完整TaskBrief/IntentGrant并绑定Artifact任务身份；PPT批次逐submission计费、失败停止和幂等恢复；自然语言确认复用统一控制解析，replacement不再误伤当前唯一pending plan；暂停/恢复状态身份完成补充修复。纯图片任务不再扩张为PPT，当前图片Provider仍要求可信图片语义源，不伪造前置Artifact。

### 阶段C：Observation与消息投影

阶段状态：**LOCAL GO**（总整改门仍为RED）。

涉及：RMD-P1-07、P1-08、P2-01、P2-02、P2-03、P2-04。

修改范围：Dispatcher、失败原子提交、stream projection、message adapter/renderers、等待态与失败去重。

验收：

- 返回给调用方/模型的Observation和ValidationReport均可由同一持久ID解析。
- 同turn文本、Tool、Observation和Artifact按真实发生顺序投影。
- 失败按原因和终态身份去重，不由旧失败遮蔽新`run_failed`。
- 无持久化活动事实时只显示中性等待与真实耗时；completed历史投影不隐藏当前等待。

本阶段实际完成：blocked Observation ID和失败ValidationReport由同一原子提交事实驱动；`agentTimeline`统一实时与刷新投影并在queue终态后回写assistant message；相邻文本合并、同Tool状态合并且保留事件sequence范围；最终正文与流式正文不一致时仍完整保留；失败按reason/evidence身份去重；客户端不再注入“正在理解/组织/保存”等未持久动作，当前等待只由当前pending turn活动控制。

### 阶段D：健康与恢复

阶段状态：**LOCAL GO**（总整改门仍为RED）。

涉及：RMD-P2-06、P2-07。

修改范围：native intake错误边界、provider readiness映射、health schema检查。

验收：

- Provider未配置时返回教师安全、可恢复的结构化失败，不泄露内部错误。
- health检查当前代码依赖的关键表、列和控制面表；缺任一项返回非ready及机器可读原因。

本阶段实际完成：未配置Main Agent Provider的intake与respond共用结构化失败合同，保持`failed_retryable`与`after_provider_health_change`语义，不回退deterministic、不生成业务Tool或quick reply；无真实checkpoint时使用唯一`retry`消息部件，不伪造resume。health和production preflight共用只读SQLite schema readiness，显式覆盖控制面事实表、ConversationMessage parts/metadata、Artifact任务绑定、ConversationTurnJob失败恢复字段及GenerationJob Provider提交/结果字段；缺表、缺列、不可读和不可用均fail closed并输出稳定reason code。

### 阶段E：扩大回归与真实桌面

阶段状态：**LOCAL GO**。

涉及：全部RMD问题。

修改范围：仅测试、验证记录和当前权威文档，不新增业务范围。

验收：

- Node合同、独立SQLite单worker Vitest、TypeScript、Lint（若项目脚本存在）、生产构建、`git diff --check`全部通过。
- 本地服务从当前HEAD启动，health与核心桌面对话流程通过。
- 至少覆盖普通对话、局部单Tool、HumanGate恢复、在途控制、失败恢复和刷新后顺序；不调用本轮禁止的媒体/整包Provider。
- 活动README、架构、需求、主线、计划、测试和代码口径一致。

本阶段实际完成：修复Node/Vitest共库污染并为两套测试分别初始化隔离SQLite；清理固定`requirement_spec`与非canonical TaskBrief旧fixture；补齐image、video、coze-ppt Artifact route向ToolRouter透传当前TaskBrief的真实缺口；建立Next 16 ESLint 9门并修复生产Lint错误。最终Node `387/387`、Vitest `1557/1557`、TypeScript、Lint（0 error）、生产构建、desktop smoke、health和`git diff --check`通过。1440x900真实浏览器验证登录、新建项目、模糊讨论无Tool/Artifact/epoch提升、单`create_requirement_spec`仅生成需求规格、刷新后终态稳定和控制台无错误；未运行390px或真实媒体/整包Provider。

## 4. 实施纪律

- 每阶段只解决列出的RMD问题；发现新问题先记入当前plan/test-plan再决定是否阻塞。
- 每个缺陷先保存红测试证据；测试必须使用显式隔离SQLite和受限worker。
- 不使用mock、fallback、假数据、硬编码成功结果，不删除测试或降低校验标准。
- 每阶段同步代码、测试和文档，验证后单独本地提交；不push。
- 不查询或清理审查期间可能写入的默认SQLite，除非用户另行明确授权。

## 5. 完成定义

`v1-agent-atomic-tool-refactor-test-plan.md`全部Go门和阶段E真实验证已于2026-07-17完成，本整改状态为`REMEDIATION VERIFIED`。本计划与测试计划归档后只作完成证据，不成为后续活动权威；当前过期closeout不得恢复。

完成本整改仍不自动等于R5、V1-9或release通过；Provider连续多轮稳定性和后续真实产品链路必须分别取证。
