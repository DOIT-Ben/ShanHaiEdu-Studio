# ShanHaiEdu V1-9R Main Agent 自主编排与 HumanGate 恢复计划

更新时间：2026-07-13

状态：`Accepted / R0-R4 complete / R5 in progress / blocks V1-9 real E2E and V1-10 public cutover`

关联测试：`docs\stages\local-real-v1-v1-9r-agent-autonomy-human-gate-recovery-test-plan.md`

## 1. 阶段目标

在不推翻现有 PPT、视频、质量、执行安全和发布底座的前提下，恢复产品 Main Agent 的任务理解、业务 Tool 选择、连续执行、Observation/Replan、失败恢复和自然语言打断能力，并把 HumanGate 从“逐节点许可器”改为“真实决策与风险边界”。

V1-9R 完成后，一名教师给出明确的完整 PPT、视频或整包目标时，产品必须把该请求视为对标准范围内可逆内部工作的任务级授权。Main Agent 应看到全部当前合格的高层业务 Tool，自主选择并连续调用必要能力，读取每次成功或失败的具体 Observation 后决定 continue、repair、换 Tool 或 Replan。Director、Critic、Validator 和 Quality Gate 按任务和领域需要参与，不由服务端固化为机械必经节点；只有不可推断的方向选择、超出授权的费用或强度、外发发布、权限变化、覆盖删除等真实边界才打断教师。

本阶段不以“减少安全约束”为目标，而是把约束放回正确责任层：

```text
模型决定下一项业务动作
-> 确定性 ActionPolicy 判断是否在任务授权内
-> 在授权内自动执行
-> 超出授权才创建 PendingDecision 并进入 HumanGate
```

## 2. 触发原因与状态纠偏

真实项目 `cmrj7iqm8001pboezl97iacic` 已证明既有 V1-3/V1-4/V1-6/V1-7 的自动化结论不能等同于产品验收：

- 38 条消息连续形成 8 个 `requirement_spec`，没有推进到教案、PPT 或视频。
- Main Agent 已理解“五年级、百分数、投篮命中率”，但结构化 `inputDraft` 在内部 Tool 边界丢失，Runtime 最终只收到“确定”等短控制文本。
- 22 个 Capability 全部要求逐 Tool 确认；执行确认与产物批准混用，导致下游长期不可用。
- Main Agent 内循环只开放只读 Director/Critic，业务 Tool 无法进入连续 ReAct；Tool 成功后服务端又强制回到等待确认。
- Runtime 超时和解析异常会被静默降级成 `deterministic_draft`，教师看到的是假成果而不是真实失败。
- 历史成果卡、Markdown、强度显示和窄屏布局还存在产品级回归。

因此状态统一调整为：V1-4 为“底层合同完成 / 产品验收失败 / P0 reopen”；V1-3、V1-6、V1-7 保留已有组件与领域合同，但连续自主编排重新验收；V1-5 的强度 Runtime 贯穿和 UI 状态同步按 P1 重开；V1-8、V1-9A-G、V1-10A-G 的独立底座证据保留，修复后只做必要回归。

## 3. 第一性原则

1. 教师购买的是完成任务，不是批准内部流水线。明确请求“做一个 PPT”已经授权标准预算内完成该 PPT 所需的可逆内部步骤。
2. Main Agent 负责理解、规划、选择 Tool、观察和 Replan；确定性系统负责权限、预算、幂等、版本、质量和副作用边界。
3. HumanGate 只处理教师必须亲自决定的事项，不能成为模型思考、内部审查或正常推进的通行证。
4. 工作流是可中断、可回退、可复用中间成果的动态计划，不是必须从头走完的固定 DAG。
5. Tool 是增强模型能力的业务接口。高层业务 Tool 对 Main Agent 可发现；Provider、数据库、密钥和状态提升继续隐藏在 Guard 与 Adapter 后。
6. 质量通过、下游可用、教师签收是三种不同事实，不能继续由一个 `isApproved` 字段承担。
7. 失败必须诚实。Runtime 超时、解析失败和校验失败必须可追踪、可有限重试，不能用模板草稿冒充成功。

## 4. 目标控制循环

```text
Observe user message + active TaskBrief + WorldState
-> update or create TaskBrief and IntentGrant
-> Plan or Replan a bounded WorkingPlan
-> choose a registered high-level business Tool
-> ActionPolicy evaluates eligibility, scope, cost and side effects
-> execute automatically OR create one typed PendingDecision
-> persist ToolObservation and artifact/runtime lineage
-> Validator / Critic / QualityDecision
-> continue, targeted repair, replan, wait for a real decision, or finish
```

循环必须有 Tool 次数、总时长、重试和费用上限，但这些上限用于防止失控，不用于把正常多步任务压回逐节点确认。

异步图片、视频和组装任务可以挂起当前执行轮并由持久化队列恢复；恢复后仍使用原 `TaskBrief`、`IntentEpoch`、计划 revision、强度快照和任务级授权，不依赖 HTTP 请求持续存活。

## 5. 最小数据与 Tool 合同

| 合同 | 必须保存的核心事实 | 解决的问题 |
|---|---|---|
| `TaskBrief` | 原始目标、交付物、教材/附件、受众、约束、排除项、质量目标、当前变更、`intentEpoch` | “继续/确定”不再覆盖完整任务 |
| `IntentGrant` | 已授权交付范围、可逆内部动作、已向教师披露的费用/积分上限及策略版本、强度、外部副作用、教师要求的检查点、有效期 | 从逐 Tool 确认改为透明的任务级授权 |
| `WorkingPlan` | `planId/revision`、目标、动态步骤、依赖、当前步骤、预算和停止条件 | 允许非线性 Replan，不固定 DAG |
| `ExecutionEnvelope` | actor/project/task、IntentEpoch、plan revision、TaskBrief digest、强度快照、授权范围、幂等键 | Tool 永远收到正确上下文 |
| `ToolObservation` | Tool、输入摘要、结果/错误类别、artifact refs、Runtime 来源、费用、可重试性和 locator | Main Agent 可根据真实结果继续或返修 |
| `PendingDecision` | 类型、问题、候选、默认项、影响、费用、过期条件、绑定的 intent/plan/action | “确定/继续”有唯一上下文语义 |
| `ReplanDecision` | continue、repair、replan、wait、finish 及原因和下一动作 | 取消 Tool 后统一强制等待 |

产物状态至少在语义上分开：

- `validationStatus`：文件、Schema、血缘、版本和确定性事实是否有效。
- `reviewStatus`：独立 Critic 是否通过、要求返修或阻塞。
- `teacherDecision`：教师是否签收、要求修改或尚未表态。

下游可用性由当前版本的确定性验证、领域审查和授权范围决定；教师未签收不应阻止内部草稿继续生成，除非教师明确要求在某个检查点暂停。

## 6. HumanGate 新边界

| 场景 | 默认行为 | 是否阻塞 |
|---|---|---|
| 需求整理、大纲、逐页设计、样张生成、内部审查、局部返修 | Main Agent 自动推进并展示进度 | 否 |
| 教师明确要求“先看样张/大纲再继续” | 创建绑定版本的检查点 | 是 |
| 明确请求完整 PPT/视频，账号已接受当前预算策略且费用处于已展示、版本绑定的标准任务预算内 | 视为任务级授权，不再逐 Tool 确认 | 否 |
| 没有有效预算披露或预算策略版本已变化 | 先说明积分上限与影响，创建一次任务级决定；确认前零付费调用 | 是 |
| 信息可从教材、上下文或可靠默认值推断 | 采用默认值并允许教师随时改道 | 否 |
| 两个方向会实质改变交付且无法可靠推断 | 询问一个具体选择，给出推荐默认项 | 是 |
| 超出任务预算、升级到最高强度、扩大交付范围 | 显示影响和积分趋势后确认 | 是 |
| 外发、公开发布、邀请外部成员、权限变化 | 明确说明目标与影响后确认 | 是 |
| 覆盖、删除、不可逆迁移 | 明确对象和回退能力后确认 | 是 |
| 最终教师签收 | 记录验收结论，不反向冒充内部质量证据 | 只阻塞发布签收，不阻塞生成 |

`PendingDecision` 必须是唯一权威等待态。按钮和自然语言都解析到同一个 decision；没有活动 decision 时，“继续”表示继续当前任务，“确定”不能创建一个新的空需求或覆盖 `TaskBrief`。

## 7. 分阶段实施

| 子阶段 | 目标 | 核心工作 | 退出标准 | 估算 |
|---|---|---|---|---|
| V1-9R0 | 冻结失败基线 | 把 38 条失败对话转成脱敏回归；废止“逐节点继续”作为成功标准；先写红测试 | 一句话 PPT、继续、改道和无假 fallback 用例可稳定复现失败 | 0.5 天 |
| V1-9R1 | 语义与授权贯穿 | 持久化 `TaskBrief/IntentGrant`；修复 `inputDraft`、强度和可信 artifact 透传；控制消息不覆盖任务 | Tool 接收完整目标；IntentEpoch 改道后旧调用失效 | 0.5-1 天 |
| V1-9R2 | ActionPolicy 与 HumanGate 重分级 | 把“全部确认”改为按副作用和授权判断；统一 `PendingDecision`；分离质量、下游可用和教师签收 | 明确的一句话任务在标准范围内零例行确认；真实风险仍稳定阻断 | 1 天 |
| V1-9R3 | 业务 Tool 连续 ReAct | 把白名单高层业务 Tool 注册给 Main Agent；Tool 后自动 Observe/Replan；异步任务持久化恢复；保持 Guard 强制执行 | Main Agent 自主走完 PPT 安全链并能定点返修，不靠固定点击序列 | 1-1.5 天 |
| V1-9R4 | 真实失败与关键体验 | 禁止生产静默 deterministic 成功；分类错误、有限重试和运行记录；修 Markdown、历史卡片、强度同步、窄屏截断和持久处理状态 | 错误可诊断可恢复；四项截图问题和强度错位回归关闭 | 0.5-1 天 |
| V1-9R5 | 自主控制面验收 | 一句话PPT最低可信设计候选、完整材料包规划、动态Tool轨迹、Observation/Replan、失败恢复、暂停/改道/局部任务、桌面、两个用户不同项目并行 | R-A01至R-A18、R-U01至R-U06有证据；外部Codex介入编排次数为0；任务、授权、费用、强度和产物不串线 | 0.5-1 天 |

V1-9R0至R5形成工程恢复候选，估算4-6个集中开发日。随后单独恢复V1-9真实E2E和V1-10发布收口；两人邀请制V1总估算为6-10个自然日。Provider、外部审核或教师签收等待不计入工程工时；真实成片出现新P0时增加1-2天做责任层修复和定点复验。前两天的阶段目标是得到“一句话发起、无需反复确认、自动推进到可信PPT候选”的确定性候选版。

## 8. 顺序与并行边界

```text
V1-9R0 -> V1-9R1 -> V1-9R2 -> V1-9R3 -> V1-9R5
                                      \-> V1-9R4 -/
-> V1-9 real product E2E and external acceptance
-> V1-10 candidate teacher signoff, atomic cutover and post-cutover verification
```

- `TaskBrief/IntentGrant/PendingDecision/ActionPolicy` 和核心 Tool loop 属于同一热点控制面，保持单一集成人。
- Markdown、历史卡片、强度 UI 和窄屏布局可在 V1-9R2 合同冻结后并行，但不能先用 UI 文案掩盖服务端状态错误。
- V1-9R3与V1-9R4可以并行开发，但两者都是V1-9R5关闭前置；R5的历史成果、强度同步和浏览器验收不得在R4未通过时完成。
- PPT、视频和最终包生产 Tool 不重写；只修其对 Main Agent 的注册、输入信封、Observation、授权和可恢复边界。
- V1-9R5 全部确定性与浏览器门通过前，不运行新的真实整包 Provider E2E。V1-9和V1-10各自形成独立closeout，不用V1-9R工程恢复证据替代真实包、教师签收或生产切流证据。
- V1发布前真实浏览器验收只运行桌面视口。390px不作为关闭R5、进入V1-9、V1-10候选验收或发布V1的门禁；既有窄屏自动化与历史证据保留，后续不再新增390px真实黑盒。

### 8.1 V1-9R5责任边界

- R5验收自主控制面，不验证偶然满足全部生产内容Schema的单次Director结果。`ppt_design_draft`只要求真实模型来源、完整任务语义、证据绑定、最低结构有效并可供下游使用。
- R5不验证真实可编辑PPTX、完整图片、MP4、ZIP或整包production gate；这些只在R5关闭后的唯一一次V1-9真实Provider全链路验证。
- Main Agent可发现全部当前合格的高层业务Tool并自主决定调用顺序；测试只断言目标覆盖、合法选择、Observation/Replan和动态轨迹，不断言固定Tool顺序。
- 服务端不得指定固定下一Tool，也不得把Director或Critic设为所有任务的机械前置。确定性Guard继续负责文件真实性、血缘、版本、权限、费用、授权和副作用。
- Tool校验失败时，`ValidationReport.reasonCode`和具体Observation必须返回Main Agent，使其可修输入、换合法路径或Replan；同一Tool连续失败不得自动转成`ask_teacher`。
- 只有缺少真实用户选择、授权、预算，或存在外发、权限变化、覆盖删除等破坏性副作用时才进入HumanGate。重试预算耗尽时诚实暂停、持久化阻塞原因和恢复入口，不循环调用，也不生成fallback成果。
- 当前DeepSeek Director运行只作为诊断证据；若失败来自V1-9生产级内容Schema，不做等价重跑，先修R5最低可信合同与V1-9 production gate的责任边界。

### 8.2 V1-9R5单轮ReAct上下文收敛

真实桌面出现 Main Agent continuation 180 秒超时后，R5增加一个仓内责任切片：保留既有跨轮`ContextPackage`，将同一次原生function-call循环从原始历史累加改为确定性`react-checkpoint.v1`。每次Tool后先持久化Observation，再只向下一轮重放原始压缩上下文、当前检查点和最近一次call/output配对；不得继续携带旧reasoning、旧function call、旧function output或完整Tool structuredOutput。

检查点必须绑定TaskBrief digest、IntentEpoch、plan revision、强度和IntentGrant授权摘要，并保留当前Tool集合、Observation reasonCode、Artifact/Report引用、重复失败聚合与恢复引用。压缩只改变模型可见运输，不删除Conversation Log、Artifact、Observation、Report或RunCheckpoint。当前采用无状态紧凑重放，不把第三方`previous_response_id`作为正确性前置。

同时消除Main Agent初始请求中`contextPackage/agentWorldState/capabilityAvailability`与完整`conversationContext`的重复传输，并记录不含正文的请求字符数、token估算、轮次、检查点大小、Tool数和耗时。详细合同以`docs\architecture\decisions\2026-07-14-adr-main-agent-react-checkpoint-compaction.md`为准。

## 9. 范围边界

V1-9R本阶段必须完成：Main Agent业务Tool自主选择与连续执行、任务级授权、HumanGate风险分级、自然语言上下文决策、失败真实性、关键UI回归和双用户回归。R5的一句话PPT终点是可信的结构化设计候选；完整材料包终点是正确的任务范围、规划、授权和可恢复动态轨迹。真实整包、教师签收和生产切流分别属于后续V1-9与V1-10，不得用本阶段自动化证据替代。

本阶段明确不做：

- 不迁移 LangGraph、Vercel AI SDK 或其他 Agent 框架。
- 不建设通用 Agent 平台、完整事件溯源、多副本 Worker 或微服务体系。
- 不开发 V1.1/V1.2/V1.5 的完整计划活动流、阶段 QA、字体设置或成果工作区。
- 不新增 PPT 模板体系、在线高级编辑器或视频多版本创意工作室。
- 不把两用户范围扩成 5 人、10 人或 50 人容量。
- 不移动既有 `v1`、`v1.1.0-alpha` 或历史标签。

## 10. 验证与完成定义

实现阶段使用项目既有命令：

```text
npx tsc --noEmit
npm test
npm run build
npm run test:e2e -- <V1-9R browser specs>
git diff --check
```

V1-9R0至R5只有同时满足以下条件才可关闭并恢复V1-9真实E2E：

1. 本次 38 条真实失败对话被压缩为稳定回归并通过，不再连续生成 `requirement_spec`。
2. 明确的一句话 PPT 请求不要求教师批准需求稿、大纲、设计稿、样张等默认内部节点。
3. Main Agent 在产品内自主调用高层业务 Tool、读取 Observation、Replan 和定点返修；外部 Codex 不介入运行中编排。
4. “继续、确定、暂停、换个方向、只做某一部分”均基于活动任务和 decision 解释，不丢失原始目标。
5. 任何 Runtime 失败都不会产出可被误认成功的 `deterministic_draft`；错误有 run、输入摘要、分类、重试和恢复证据。
6. 两名教师不同项目同时运行时，TaskBrief、IntentGrant、PendingDecision、IntentEpoch、强度、任务、费用和产物完全隔离。
7. R-A01至R-A18、R-U01至R-U06、全量测试、构建和桌面浏览器通过；外部Codex在产品任务运行中的编排介入次数为0。390px不属于V1发布前退出门。
8. R5轨迹由Main Agent动态选择Tool，不存在服务端forced-next-tool、Director/Critic机械前置或重复失败默认`ask_teacher`；预算耗尽有诚实暂停和持久恢复入口。

V1整体完成还必须按独立阶段补齐：

1. V1-9由产品Main Agent独立生成结构化教案、真实可编辑PPTX、课堂视觉图、30-90秒完整MP4和最终ZIP。
2. `ClassroomRunSpec`对齐视频结束点、PPT页面、教师操作、答案揭示和课堂节奏；ZIP只收录当前`final_eligible`版本，manifest、hash、数据库记录和真实目录一致。
3. 产品内质量门通过，外部黑盒`ExternalAcceptanceReport` P0=0；若返修，只复验受影响版本。
4. 至少一名真实教师在候选环境签收后，V1-10执行原子公网切流；切流后公开注册关闭、生产健康、关键教师路径和回退入口复核通过，并创建新的不可变发布标识。
