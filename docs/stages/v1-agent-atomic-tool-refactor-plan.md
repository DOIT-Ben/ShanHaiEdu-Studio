# V1.0 Main Agent唯一编排与工作流原子Tool化重构计划

日期：2026-07-16
状态：reopened / dialogue checkpoint and truthful progress projection in progress

## 1. 目标

按照 `..\architecture\V1.0 重构设计.md` 和当前ADR，把现有多套控制设计收敛为：

- Main Agent唯一决定业务Tool、下一步、重试、Replan和停止；
- 旧工作流能力拆为原子Tool、Tool级Skill和质量规则；
- 服务端只负责硬合同、安全、真实性、原子提交和恢复；
- assistant-ui实时投影真实文本、Tool、Observation、失败、Artifact和恢复状态。

本阶段关闭仓内控制面一致性和桌面文本交互，不运行真实图片、视频、PPTX、ZIP或完整材料包Provider。

## 2. 权威合同

- 需求基线：`..\product\current-requirements-baseline.md`
- 设计：`..\architecture\V1.0 重构设计.md`
- ADR：`..\architecture\decisions\2026-07-16-adr-main-agent唯一编排与工作流原子Tool化.md`
- 测试门：`v1-agent-atomic-tool-refactor-test-plan.md`

旧Streaming和旧V1-9 plan/test-plan已归档，不参与实现判断。

## 3. 实施切片

### Slice 0：控制权清单与红测试

- 定位所有Tool选择、下一步、重试、停止、HumanGate和Artifact提升入口。
- 为六组P1编写会失败的特征测试。
- 建立静态与运行时单一编排者断言。
- 删除固定Tool顺序和“逐节点确认即成功”的旧测试预期。

完成条件：每个已知旧控制路径都有失败测试和明确责任层。

### Slice 1：TaskBrief与跨轮语义

- 开放式识别年级、学科、教材和局部任务，不限制1至6年级。
- 贯通requested outputs、排除项、强度、预算和结构化输入。
- 删除所有Tool统一硬编码的“逐页PPT设计稿”输出。
- 无pending plan改道也更新IntentEpoch或等价revision。
- 迟到旧TaskBrief、旧epoch和旧plan结果禁止提升。

完成条件：一句话PPT、局部视频脚本、改道和旧结果隔离的离线合同通过。

### Slice 2：原子Tool合同与资格

- 盘点需求、教案、PPT和视频前段全部高层业务能力。
- 为每个Tool定义单一动作、输入、输出、风险、费用、副作用、幂等和最低真实性合同。
- 明确交付任务首轮暴露能够创建第一个Artifact的合格Tool。
- Director/Critic只在存在可信审查目标时暴露。
- Skill仅在Main Agent选定Tool后按绑定策略加载。

完成条件：Tool资格只判断当前事实和可信输入，不用“尚未有产物”禁止创建首个产物。

### Slice 3：单一编排者

- 以原生function-call + Observation + ReAct作为唯一生产循环。
- 移除外层`toolPlan`/`deliveryPlan`的选择、执行、重试和停止权。
- Capability Planner和兼容层只可提供候选描述、校验或展示。
- Tool成功或失败后先提交Observation，再由同一Main Agent决定continue、repair、换Tool、Replan或暂停。
- 对现有Responses Runtime与OpenAI Agents SDK做隔离A/B；A/B只比较运输、恢复和遥测，不允许两者同时编排同一turn。

完成条件：静态依赖和运行轨迹都证明只有一个业务编排者。

### Slice 4：统一执行网关与原子提交

- 所有执行型Tool强制经过ToolExecutionGateway。
- ExecutionEnvelope核验actor、project、task、TaskBrief digest、IntentEpoch、plan revision、强度、授权、预算、action digest和幂等键。
- ToolInvocation、ValidationReport、Observation、Artifact和事件在同一结果边界提交。
- 失败先保存reasonCode、finding和恢复入口，Artifact为0。
- 重试预算耗尽时可信暂停，不循环、不fallback、不默认`ask_teacher`。

完成条件：不存在绕过Envelope、先提升Artifact后补Observation或失败被吞掉的生产入口。

### Slice 5：控制先提交与隔离恢复

- 暂停、取消、改道先持久化，再允许任何Tool继续。
- 有无pending plan使用同一控制顺序。
- Provider submission、submission_unknown、retry和checkpoint均可恢复且不重复扣费。
- 同一项目一个有效写者；用户、项目、任务、预算、epoch和Artifact完全隔离。

完成条件：暂停、无pending改道、迟到结果和双用户并发测试通过。

### Slice 6：assistant-ui真实步骤投影

- 普通回复使用真实文本流。
- Tool、Observation、Artifact和HumanGate使用结构化MessagePart。
- 同一turn形成有序活动轨迹，Artifact达到最低真实性门后立即可见。
- 失败显示具体Tool、步骤、原因和恢复动作。
- 刷新通过事件游标和有界回放恢复，终态消息只提交一次。
- 删除固定五阶段、大节点终态和正文关键词推断状态的UI路径。

完成条件：桌面真实文本交互能看到及时回复、步骤进度、失败位置、Artifact入口和恢复状态。

### Slice 7：旧生产路径退出

- 删除forced-next-tool。
- 删除重复失败默认`ask_teacher`。
- 删除approve后的`advanceM2AfterApproval`和DeterministicRuntime自动推进。
- 删除工作流defaults对任务范围和下一步的控制。
- 删除无正式package asset时的现场拼包。
- 删除deterministic、placeholder、Markdown fallback和degraded成功路径。
- 只有消费者、测试和运行时引用均为0后才删除旧代码。

完成条件：旧路径搜索、特征测试和运行轨迹均为0命中。

### Slice 8：扩大验证与关闭

- 运行全部六组P1、控制面扩大回归和已有无fallback/隔离合同。
- 运行TypeScript和生产构建。
- 检查Git diff、隐私、密钥、残留进程和活动文档引用。
- 启动真实桌面环境，只验收Main Agent文本和标准内部Tool轨迹；不调用真实交付物Provider。
- 更新主线状态，形成closeout；随后停止，等待用户制定V1-9新运行。

## 4. 实施纪律

- 每个缺陷先红后绿；只运行受影响测试，再扩大回归。
- 不为通过旧测试放宽生产合同；过时断言应删除或改为行为特征。
- 同一责任层连续两轮没有新证据时，记录事实、失败点和恢复入口，转向其他不依赖项。
- 不做无关重构、依赖升级、批量格式化、commit、push、部署或标签移动。
- 保留全部用户在途改动，不触碰真实SQLite、WAL/SHM、Artifact、旧run、Skill projection或凭据。

## 5. 完成标准

1. 明确交付任务首轮合格Tool集合不为空。
2. 只有Main Agent拥有业务Tool编排权。
3. TaskBrief、ExecutionEnvelope、Observation和跨轮语义完整贯通。
4. Tool结果先原子提交，再由同一Main Agent继续判断。
5. 暂停、改道、迟到结果和双用户隔离通过。
6. 旧M2推进、现场拼包、forced-next-tool和fallback成功路径关闭。
7. assistant-ui桌面步骤级体验通过，V1前不跑390px。
8. contract、executor、model orchestration、product E2E和release证据分层准确。

完成本阶段不等于V1-9或发布通过。V1-9必须在本阶段关闭后重新制定计划，并由用户运行唯一真实全链路。

## 6. 关闭结果

- Slice 0至Slice 8的仓内责任已经关闭，详细证据见`v1-agent-atomic-tool-refactor-closeout.md`。
- assistant-ui成为唯一生产会话Runtime；固定阶段、legacy会话切换和无消费者M2自动推进实现已删除。
- Node合同383/383、Vitest 1492/1492、TypeScript、生产构建和`git diff --check`通过。
- 桌面只读验收通过；本轮未调用新的模型请求或真实交付物Provider，未运行390px。
- 后继V1-9未启动，等待用户验收后重新制定计划。

## 7. 重新打开的原子修正

真实桌面新任务证明原关闭结论遗漏了教师协作与步骤可见性：标准授权提示词禁止 Main Agent 在语义边界主动校准；步骤只显示短标签，无输入依据和真实耗时；一次失败会重复投影。

本修正按以下顺序执行：

1. 先写 `DialogueCheckpoint`、自然语言恢复、真实步骤详情和失败去重红测试。
2. 注册 `request_teacher_decision` 控制 Tool，由同一 Main Agent 自主选择；服务端只校验、持久化和暂停。
3. 扩展 MessagePart 与 AgentEventEnvelope 投影目的、输入依据、预期输出、真实耗时、Observation 和唯一恢复入口。
4. 定向回归后运行控制面扩大回归、TypeScript、生产构建和桌面复验。

修正期间不运行390px，不调用真实图片、视频、PPTX、ZIP或整包Provider，不进入V1-9。
