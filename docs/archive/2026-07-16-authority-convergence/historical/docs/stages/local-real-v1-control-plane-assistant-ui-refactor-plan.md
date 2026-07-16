# V1 控制面与 assistant-ui 定向重构计划

日期：2026-07-14

状态：A10-A23 contract and executor passed / R5 historical pass retained / A23 start-new decision formed / unique V1-9 preflight pending

## 1. 目标与成功标准

本阶段在保留权限、租约、质量、血缘和真实文件内核的前提下，关闭接管审计发现的六个 P1，并把 assistant-ui 作为唯一目标对话 Runtime 接入项目自有消息与事件合同。

成功标准：

1. 暂停、取消和改道先持久化控制状态，再允许 Main Agent 或 Tool 执行；有无 pending plan 都不能改变该顺序。
2. TaskBrief 来自可验证的结构化任务提案，不再由关键词正则单独决定任务范围。
3. 所有可执行 Tool 都必须携带并核验同一任务级 ExecutionEnvelope 事实；只读 Agent Tool 的运输信封也必须等价绑定 actor、project、task、TaskBrief digest、IntentEpoch、plan revision、强度、授权和幂等键。
4. ToolInvocation、ValidationReport、Observation、Artifact 和教师安全事件按同一结果原子提交。
5. 只有一个 OrchestratorRuntime 拥有 Tool 选择、下一步、重试和停止权。
6. 跨轮语义快照持久化目标、约束、排除项、IntentEpoch、计划 revision、未决决定、可信成果和 Observation 引用，不再只截取最近八条消息。
7. assistant-ui 无损展示历史消息和新 MessagePart，承载计划、活动、Tool 状态、Artifact、HumanGate 和错误恢复；旧 UI 只作回退。
8. 五层验收分别记录；本阶段只关闭 `contract` 与 `executor`。`model orchestration` 与 `product E2E` 继续引用既有 R5 真实桌面证据，完整真实包仍只由唯一 V1-9 证明。

## 2. 范围

### 2.1 纳入

- 项目自有九类 MessagePart、AgentEventEnvelope、事件序列与历史正文兼容。
- assistant-ui ExternalStoreRuntime、类型化 Renderer、受控发送与服务端能力开关。
- Turn Intake、TaskAggregate、OrchestratorRuntime、ToolExecutionGateway、ExecutionEventStore、ArtifactCommandService、ContextSnapshotService。
- Responses Runtime 与 OpenAI Agents SDK 的隔离低风险三 Tool A/B。
- A10-A23 仓内关闭所需的回归、类型、构建和静态审计；R5 历史桌面证据保留且不重跑。

### 2.2 不纳入

- 反馈闭环、搜索、完整成果编辑器、互动课件 Runtime、全阶段 QA、多 Critic、50 用户容量扩张。
- 真实图片、视频、PPTX、ZIP 或 V1-9 整包 Provider。
- V1 发布前新的 390px 真实浏览器黑盒。
- 部署、生产写入、教师签收或公网切流。

## 3. 目标边界

| 边界 | 唯一职责 |
|---|---|
| `TurnIntakeControlService` | 无副作用识别暂停、取消、改道和任务提案 |
| `TaskAggregate` | TaskBrief、IntentGrant、WorkingPlan、revision、checkpoint 真源 |
| `OrchestratorRuntime` | 唯一 Tool 选择、Observation、Replan、重试和停止 |
| `ToolExecutionGateway` | identity/fence、Envelope、ActionPolicy、幂等与实际参数对账 |
| `ExecutionEventStore` | ToolInvocation、Observation、运行事件和重放序列 |
| `ArtifactCommandService` | 区分教师输入、系统候选和正式资产；原子提升可信状态 |
| `ContextSnapshotService` | 跨轮语义快照、预算、验证和恢复日志 |
| `assistant-ui Adapter` | MessagePart/事件到 UI Runtime 的单向投影 |

## 4. 实施切片

| 切片 | 工作 | 退出条件 |
|---|---|---|
| A0 | 修订权威状态、ADR、计划和五层验收 | 文档不再写“只剩 Provider” |
| A1 | 冻结 MessagePart、AgentEventEnvelope、TaskProposal 和 Orchestrator 接口 | 合同红绿测试通过 |
| A2 | 加法数据库迁移：消息 Parts、事件、Task、计划 revision、上下文快照与运行血缘 | 旧库可升级、旧消息可读 |
| A3 | 控制先提交与结构化 TaskBrief intake | 有/无 pending plan 的 pause/cancel/redirect 均零 Tool dispatch |
| A4 | 强制 ToolExecutionGateway 与 ExecutionEnvelope | 任一 Tool 无信封、旧 revision、actor/action 不匹配全部失败关闭 |
| A5 | 原子 Tool 结果提交与跨轮语义快照 | 不存在 Artifact 无 Observation 的成功状态 |
| A6 | 收敛单一 Orchestrator，关闭外层递归和 Runtime 嵌套 Tool loop | 兼容层不能选择或执行下一 Tool |
| A7 | 接入 assistant-ui ExternalStoreRuntime 与九类 Renderer | 桌面历史、新消息、错误和恢复可用 |
| A8 | Responses 与 Agents SDK 隔离 A/B | 同一三 Tool fixture 可比较且不触碰真实媒体 |
| A9 | 扩大回归、桌面浏览器和回退演练 | `contract`、`executor` 证据完整 |

### 4.1 2026-07-15 独立审计重开切片

此前 closeout 低估了事件恢复、A/B 控制权和唯一 V1-9 同任务恢复的责任边界。以下切片在关闭前阻断 Provider 恢复；R5 历史桌面证据保留，不重跑。

| 切片 | 工作 | 退出条件 |
|---|---|---|
| A10 | 修复事件游标确认、SSE 断线校正、并发 Snapshot 防倒退、checkpointId 精确绑定和生产事件发送 | 未经 Snapshot 确认不前移游标；断线可校正；旧 checkpoint 按钮失败关闭 |
| A11 | 将 Responses 与 Agents SDK A/B 收敛到共同评估 Orchestrator | Adapter 每轮最多返回一个 Tool 决策；Observation 持久后由共同 Orchestrator 决定继续、Replan 或停止 |
| A12 | 绑定调用摘要与 durable checkpoint，修复 A/B evaluator 和 SDK 全局 tracing 副作用 | 恢复不重放已提交调用；paused/failed 不得 accepted；合法同 Tool 不同参数 repair 不误判 |
| A13 | 修复错误 `succeeded` TurnJob 与未完成 TaskAggregate 的同任务恢复、ActionPolicy 阻断持久化和联合终态 | 同一 manifest Job 可一次受控重排；Invocation/Observation/Event 完整；Job 与 Task 终态一致 |
| A14 | 生成 evidence v2、修正课堂视觉图 TaskBrief 语义并重跑仓内门 | 证据绑定 job/message/task/digest/idempotency/failure signature/修复文件闭包，离线 preflight 通过 |
| A15 | 修复 native checkpoint 旧快照覆盖，并把 V1 图片执行统一到 API 台账 MiniMax 原生 Adapter | checkpoint/Observation不被外层failure覆盖；Skill按Tool懒加载；preflight、availability、执行血缘只接受MiniMax且无其他图片fallback |
| A16 | 关闭完成性复核发现的 TaskBrief 与 Provider 恢复权威缺口 | 生产 TaskBrief 范围来自同一 Main Agent 的结构化提案而非关键词正则；健康证据必须晚于当前恢复停止点；启动恢复只允许命中 manifest 绑定的同一 project/task/IntentEpoch/teacher message/TurnJob；私有台账归档不能进入 Git 候选集 |
| A17 | 强制所有 Tool 经过 ExecutionEnvelope，并收口 image/video/coze-ppt 真实路由的结果提交 | ToolRouter 缺失或携带失效 Envelope 时零执行；三条路由从当前 TaskAggregate 构造并经 Gateway 校验同一 actor/project/task/digest/epoch/revision/intensity/grant/action/idempotency 事实；成功结果在一个事务内终结 Invocation 并提交 ValidationReport、Observation、Artifact、Event 与 GenerationJob，不再调用旧 `commitGenerationResult` |
| A18 | 关闭 assistant-ui 终态、Snapshot 水位、安全链接与回退开关一致性缺口 | blocked TurnJob 不发布完成事件；普通请求与事件刷新共享项目级单调 Snapshot 水位；协议相对外链失败关闭；回退开关在服务端动态请求边界求值且新旧 Runtime 互斥 |
| A19 | 收口业务 Skill Runtime、Provider 语义输入与 MiniMax 资产血缘 | Provider 型业务 Tool 只接收 Tool 专属、去编排权的类型化 Skill slice 及可核验 provenance；投影文件每次读取复验 lock；Skill 加载失败在 Invocation 开始后原子留下失败 Observation/Event 且零 Artifact；绑定对账 consume/produce；图片/视频 Prompt 来自当前 TaskBrief、Tool 参数和可信上游；MiniMax 成果保存原始与规范化文件、双摘要、模型和尺寸 |
| A20 | 统一 Provider 身份摘要与发布 preflight 的台账责任边界 | Agent Brain config digest 纳入不泄密的凭据轮换指纹；同变量名换 key 后旧健康证据立即失效；生产 preflight 只接受有效 ledger channel、MiniMax 图片和台账声明的 TTS 字段，未知通道、普通 OpenAI env、旧 free 图片与未声明别名全部失败关闭 |
| A21 | 修正 Director/Critic Router 的 HumanGate 归因 | 仅真实授权不足进入 `ask_teacher`；未知 Tool、Envelope/参数/输出合同错误向同一 Main Agent 返回 `fix_inputs` 或 `skip_or_replan` Observation，Provider/Executor 暂不可用返回有界 retry，不能把内部缺陷伪装成教师决定 |
| A22 | 建立业务 Skill 标准反馈闭环并修正一致交付合同 | 对照当前产品基线、领域 Skill 与下游 Skill 写跨边界红测；版本化升级 `shanhai-delivery`，统一 30–90 秒与唯一最小课程锚点责任；`create_final_package` 仅在 Main Agent 选择后加载交付语义 slice，Skill 不拥有 Tool 选择、重试、授权或停止权 |
| A23 | 落实正式 Skill Schema 与 Tool 产物 Adapter | 保留旧 Skill 版本并版本化升级图片、视频执行和一致交付合同；投影 Schema 路径经 lock 安全映射且 Schema 合法、版本绑定；六个 `formal_contract` Tool 在成功提交前形成确定性 Skill payload 并通过 Draft 2020-12 Schema，失败原子保存 ValidationReport/Observation且零 Artifact；`guidance_only` 不执行正式 Schema，Skill 不获得编排权 |

## 5. assistant-ui 迁移规则

1. 新消息服务端同时保存 `parts` 与可回退 `content`；旧消息确定性转换为 `text` Part。
2. 前端只从类型化 Part 和服务端事件渲染状态，不从正文关键词推断。
3. `onNew` 继续调用现有受认证、CSRF、幂等和队列保护的消息入口。
4. 编辑、重试、分支和队列只有服务端存在对应安全合同才显示；默认不启用通用重放。
5. Artifact 引用必须绑定真实 artifact/version/digest；HumanGate 必须绑定唯一 PendingDecision。
6. assistant-ui 或事件消费失败不得触发 Tool；刷新先读安全快照，再按 sequence 续接。

## 6. Runtime A/B

固定候选集合为一句话 PPT 的三个低风险文本 Tool：需求规格、教案、PPT 大纲，但不固定调用顺序。两条 Runtime 使用同一 TaskBrief、IntentGrant、ToolRegistry、ExecutionGateway、fixture 和评测器，分别自主形成动态轨迹。

比较：Tool 选择有效率、Observation 后继续、重复调用、暂停响应、恢复、结构化输出成功率、请求数、延迟和可诊断性。SDK 需要直连数据库/密钥、绕过 Gateway、不能使用当前 Provider 或无法从持久化 checkpoint 恢复时停止采用。

## 7. 风险与回退

- 数据库只做加法迁移，先备份独立 SQLite；不得删除旧字段。
- assistant-ui 由服务端功能开关切换；回退只改变 UI Runtime，不回滚消息和业务状态。
- Orchestrator 迁移采用单执行者切换，禁止新旧循环同时执行。
- 每个切片先红后绿，单 worker 运行；两轮无新证据时保存 blocker 和恢复入口。

## 8. 后续门禁

R5 历史真实桌面已经通过且不重跑。A10-A23 已形成新鲜全仓 `contract`、`executor` 证据；活动 A23 候选绑定 `shanhai-imagegen 1.1 / shanhai-imagegen/v2`、`shanhai-video-generation 1.1 / shanhai-video-generation/v2`、`shanhai-delivery 1.3 / shanhai-delivery/v2`，projection digest 为 `4d2158e8c0e01f96bd677c4bf46a3b5d5ac1caff6c17d849f7077f59028855aa`，binding policy digest 为 `3dbabbcef958225c69bb68716230a12dab1bd05e6380bd6105d16663da78d62c`。

历史 V1-9 manifest 仍不可变地绑定旧 projection/policy lock，与活动 A23 投影不同；恢复决定现已明确为旧run只读保留、按当前已验收合同显式`start-new + predecessorRunId`。新run创建前先完成`v1-9-run-state.v2`、全量仓内回归和只读preflight；不得恢复或改写旧manifest。后续恢复仍必须绑定新run自身的SQLite、project、task、IntentEpoch、教师消息和TurnJob；V1-9通过后才进入教师签收和V1-10发布门，部署与生产写入另取当次授权。
