# ShanHaiEdu 当前主线状态

更新时间：2026-07-17

## 1. 当前结论

- 当前唯一任务主线为 **V1.0 Main Agent唯一编排与工作流原子Tool化重构的教师协作与步骤投影修正**；状态为 **IMPLEMENTATION VERIFIED / PRODUCT E2E PARTIAL**。
- 唯一代码主线为 `main`，当前HEAD为 `fd2521f1b558`；工作区包含大量未提交在途改动，本次权威切换不回滚、覆盖、commit或push这些改动。
- `docs\architecture\V1.0 重构设计.md`和新ADR已经成为当前架构基线；旧Streaming阶段和重构前V1-9计划已退出活动目录并按SHA-256归档。
- 六组P1对应的仓内合同、统一执行网关、原子提交、控制先提交、跨轮语义、隔离恢复和无fallback边界已经通过单worker全量回归。
- assistant-ui已经成为唯一生产会话Runtime；固定五阶段、legacy会话切换、阶段编号推导和无消费者的M2 deterministic自动推进实现已经退出生产源码。Main Agent现可按语义选择DialogueCheckpoint或自然追问，任务范围、Tool、Observation、Artifact、失败和恢复按真实事件逐步投影。
- 桌面生产构建在`http://127.0.0.1:3187`完成真实增补验收：等待态显示真实计时，TaskBrief提交后立即展示交付范围与排除项，单Tool需求规格完整成功；同一环境中的双Tool回合在两个Artifact提交后发生一次Main Agent续轮`502`，因此Provider连续多轮稳定性仍未关闭。
- R5只保留历史证据，不重跑。本轮未创建V1-9 manifest/runId，未调用真实图片、视频、PPTX、ZIP或整包Provider，未运行390px，未进入教师签收或V1-10。
- 业务Skill权威源仍为集合根既有 `shanhaiedu-技能系统`；Skill只能增强Main Agent已选择的当前Tool，不能接管任务编排。

## 2. 五层状态

| 证据层 | 当前状态 | 可以声称 | 不能声称 |
|---|---|---|---|
| `contract` | passed for current slice | P1-01至P1-06既有证据保留；P1-07 DialogueCheckpoint、语义改道、真实步骤详情和失败去重合同通过 | Provider连续多轮稳定或R5整体通过 |
| `executor` | passed in isolated SQLite | 原子提交、幂等、暂停恢复、无pending改道、迟到结果和双用户隔离通过 | 生产数据库迁移或发布通过 |
| `model orchestration` | real desktop partial | Main Agent按语义讨论未决定的改道且不提升IntentEpoch；明确范围任务自主调用合格Tool；生产路由固定为native唯一控制面 | Provider可稳定完成任意连续多轮Responses |
| `product E2E` | desktop semantic slice passed | 新项目可显示真实等待、任务范围、Tool、Observation和Artifact；局部需求规格从零完成且未扩张范围 | 双Tool及以上连续回合稳定通过或V1-9通过 |
| `release` | not started | 无 | V1-9、教师签收、部署或发布完成 |

## 3. 既有关闭事实与新缺口

- 自然文本真流式、function-call隔离、Prompt Cache遥测和终态单次提交已有仓内与真实文本通道证据。
- ToolInvocation、ValidationReport、Observation、Artifact和事件的原子提交边界已有实现与测试基础。
- IntentEpoch、SemanticSnapshot、迟到结果隔离、暂停恢复和双用户隔离已有历史仓内证据。
- assistant-ui已经接入项目MessagePart和AgentEventEnvelope，可作为步骤级投影基础。
- 明确交付任务首轮可以发现`create_requirement_spec`；问候可保持无业务Tool，Director/Critic只在存在可信审查目标时暴露。
- 生产消息路由固定使用native function-call控制面；外层`toolPlan`/`deliveryPlan`只保留兼容数据合同，不能在native turn执行下一Tool。
- 所有业务Tool通过`ExecutionEnvelope`和统一Gateway，Tool结果先原子提交Observation、事件和允许的Artifact，再回到同一Main Agent。
- 重复失败不会默认转为`ask_teacher`；只有真实选择、授权、预算或副作用门进入HumanGate，预算耗尽保存暂停checkpoint。
- 最终包下载只读取与成功`create_final_package`调用、Observation和正式`packageAsset`反向绑定的持久文件，不现场拼包。
- assistant-ui是唯一生产会话Runtime；固定阶段、大节点终态替代轨迹和legacy UI开关已关闭。
- “需要教师确定”是Main Agent按语义选择的协作模式，不是正则规则：未决定的PPT转视频讨论只产生比较和追问，`IntentEpoch`保持0，未创建视频Artifact。
- TaskBrief提交后新增教师可见的“本轮目标已明确”小节点，展示真实目标、交付范围和排除项；普通等待只显示“小酷正在回复”和真实计时，不伪造步骤或百分比。

## 4. 验证证据

- Node合同全量：383/383。
- Vitest单worker全量：1492/1492，194个测试文件。
- TypeScript：`npx tsc --noEmit`通过。
- 生产构建：`npm run build`通过；保留13条既有Turbopack动态文件追踪警告。
- `git diff --check`通过；仅有现有LF/CRLF提示。
- 桌面只读验收：assistant-ui viewport 1、固定阶段rail 0、assistant消息8、composer 1、favicon命中现有品牌资产、浏览器控制台0错误。
- 详细关闭记录：`..\stages\v1-agent-atomic-tool-refactor-closeout.md`。
- 当前切片定向回归：Vitest单worker134/134、assistant-ui/交互Node合同19/19、TaskBrief范围投影4/4；生产构建再次通过。
- 真实桌面：模糊改道自然追问通过；单Tool需求规格成功；双Tool PPT结构候选已提交两个真实文本Artifact，但最终Main Agent续轮出现`main_agent_provider_unavailable`/`502`并保存恢复入口。

## 5. 下一动作

1. 由用户在`http://127.0.0.1:3187`验收当前真实对话、范围节点和步骤级投影。
2. 不把单Tool成功等同于Provider稳定；只有出现新的通道健康证据后，才执行一次连续多轮桌面恢复验证。
3. Provider连续多轮恢复前不进入V1-9，不运行390px，不调用图片、视频、PPTX、ZIP或整包Provider。

当前仓内切片通过，但产品E2E仍受Main Agent Provider连续多轮稳定性约束；不得把当前局部成功写成R5或V1-9整体通过。

## 6. 恢复入口

- 设计基线：`..\architecture\V1.0 重构设计.md`
- 架构决策：`..\architecture\decisions\2026-07-16-adr-main-agent唯一编排与工作流原子Tool化.md`
- 当前阶段：`..\stages\v1-agent-atomic-tool-refactor-plan.md`
- 测试门：`..\stages\v1-agent-atomic-tool-refactor-test-plan.md`
- 关闭记录：`..\stages\v1-agent-atomic-tool-refactor-closeout.md`
- 权威切换快照：`..\archive\2026-07-16-v1-agent-refactor-authority-switch\archive-manifest.json`
