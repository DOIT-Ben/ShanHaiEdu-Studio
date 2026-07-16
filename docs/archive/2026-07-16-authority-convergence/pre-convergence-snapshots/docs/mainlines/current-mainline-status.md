# Local Real MVP 当前主线状态

更新时间：2026-07-15（R5历史通过；A10-A23仓内门通过；A23新唯一V1-9冻结合同实现完成、全量preflight验证中）

## 1. 当前主线

当前唯一开发主线：

```text
V1 交付质量与邀请制上线
```

目标：在现有 Local Real MVP 代码基线上，让两名受邀教师通过可暂停、改道和局部返修的 Main Agent，真实获得可上课的教案、可编辑 PPTX、课堂视觉图、完整导入视频和版本一致的最终材料包；产品内智能体自主完成规划、Tool调用、课程锚点审查、HumanGate、Quality Gate和返修，外部Codex只负责工程实现与阶段末黑盒验收。

当前阶段：`V1 control-plane closeout complete through A23 / new unique V1-9 repository preflight verification`。R5真实桌面历史证据和A10-A23仓内`contract`、`executor`门均已关闭。显式新run、全基线冻结、`v1-9-run-state.v2`、多轮外部审核、返修启动恢复和运行中漂移失败关闭合同已实现并通过定向测试；当前执行全量仓内回归和只读preflight，全部通过后才创建A23新的唯一run并执行真实全链路。V1发布前不运行390px真实黑盒；正式公网切流和教师签收仍等待V1-9通过。

2026-07-14 Git 治理已完成：本地与远端均只保留 `main`，Git 只保留权威 `main\` 工作目录，历史标签和业务数据未移动。治理当时的既有测试门通过只证明分支与工作目录可收敛，不代表当前控制面六个 P1、R5、V1-9 或发布门完成，也不构成暂停当前重构的指令。治理证据见 `docs\stages\2026-07-14-mainline-worktree-consolidation-closeout.md`。

2026-07-15最新仓内结论：`ppt_design`已按ADR分成模型语义合同`ppt-design-semantic-candidate.v1`、服务端权威持久候选`ppt-design-candidate.v2`和V1-9生产设计包。模型只负责完整目标语义、Evidence主张、教学目标、叙事和连续逐页候选；TaskBrief digest、Artifact ID/version/digest与candidate digest由服务端基于有效ExecutionEnvelope、TaskBrief和当前可信`ppt_draft`投影。历史`ppt-design-candidate.v1`只读兼容；缺少正式`PptDesignPackage`时，真实图片、PPTX、样张和整包Tool继续失败关闭。

2026-07-15独立审计纠偏项已关闭：事件游标确认、SSE断线校正、共同A/B Orchestrator、跨恢复幂等、ActionPolicy阻断持久化、Job/Task联合终态和错误Job同任务恢复均有仓内证据。A17-A23进一步关闭强制ExecutionEnvelope、真实路由原子提交、assistant-ui终态与Snapshot水位、业务Skill懒加载与MiniMax血缘、Provider台账身份、Director/Critic失败归因、一致交付标准和正式Skill Schema执行。六个`formal_contract` Tool在成功提交前经明确Adapter验证；失败原子保存ValidationReport/Observation/Event且Artifact为0，`guidance_only`不执行正式Schema。仓内`contract`与`executor`现为通过，但不能据此上推真实模型、V1-9或发布状态。

2026-07-15 A23新运行合同新增收口：不可变manifest与独立`v1-9-run-state.v2`已分离；Task/actor/teacherMessage/TurnJob锁、checkpoint、PendingDecision、Provider恢复、外部审核返修恢复和packageAcceptance均失败关闭。外部报告按不可变round保存，P0 handoff经产品ingress原子写Observation/checkpoint/Snapshot/Event并恢复同一queued TurnJob；返修态不借Provider健康证据，Provider故障态仍要求完全匹配的新健康证据。currentRepair、package版本和最新round不可漂移，ingress响应丢失、历史报告改写、同round冲突、live/dead lock与pointer移动失败均有定向证据。以上仍只属于仓内`contract/executor`，新run尚未创建。

R5最终真实fallback桌面为`test-results\m67-e2e-21008-1784056471438\`，结果`1 passed / 1 skipped`，外部Codex编排介入0、GenerationJob 0、无403且未调用真实媒体。B侧由Main Agent动态完成需求、独立创意和局部视频脚本，改道后IntentEpoch从0递增到1且没有扩张范围；一句话PPT真实完成需求、大纲和`ppt_design_draft`，候选只允许进入`production_design_expansion`。完整材料包的候选语义失败返回具体reasonCode，重复后保存checkpoint并诚实暂停。

R5矩阵R-A01至R-A18、R-U01至R-U06已逐项映射到真实桌面、仓内合同和既有窄屏自动化；本轮按用户门禁未运行390px。完整证据与责任边界见`docs\stages\local-real-v1-v1-9r-agent-autonomy-human-gate-recovery-closeout.md`。该closeout不替代V1-9真实可编辑PPTX、完整MP4、课程锚点、`ClassroomRunSpec`和版本一致ZIP。

当前权威状态：**R5历史桌面与A10-A23仓内门通过；A23新唯一运行尚未创建。** 历史`runId=v1-9-20260714212914-a036beb9`及其project/task/IntentEpoch、TaskAggregate、checkpoint、Provider Observation、SQLite和Artifact只读保留为失败证据，不再恢复、不改写，也不再寻找旧投影。

业务 Skill 权威源仍为集合根既有 `shanhaiedu-技能系统`；未切换到 `ShanHaiEdu-Conversion-Studio`。活动A23投影`runtime-projection-a23-20260715-2040`只是该既有源的冻结运行时投影，不代表创建或切换到一套新技能系统。离线preflight基线为`ready / 8 active Skills / 21 bindings`，projection digest为`4d2158e8c0e01f96bd677c4bf46a3b5d5ac1caff6c17d849f7077f59028855aa`，policy digest为`3dbabbcef958225c69bb68716230a12dab1bd05e6380bd6105d16663da78d62c`。历史manifest哈希继续保持`a7bae74ce472f9826dae9e85ab096b787f77527a153df4defc73bce0d2db698c`。新run创建前必须冻结当前main工作树、需求、Registry/A23/Policy和全部Provider非敏感摘要；运行开始后任一实质升级都终止该run并另建显式后继，不得同run静默换规则。R5与390px不重跑；V1-9通过前不得进入教师签收、部署或V1-10切流。

历史状态纠偏（现已由R5与A10-A23收口）：进入V1-9R前，V1-4只能表述为“底层安全合同完成 / 产品验收失败 / P0 reopen”；V1-3、V1-6、V1-7只保留组件与领域合同，业务Tool连续自主调用当时仍待重新验收；V1-5的强度贯穿和UI同步当时按P1重开。上述控制面缺口现已关闭，完整真实包的模型编排与产物验收仍只由唯一V1-9证明。不能再要求教师多点一次确认来继续旧路线。

当前五层验收状态：

| 证据层 | 当前状态 | 当前可声称内容 |
|---|---|---|
| `contract` | passed through A23 + immutable run-state v2 targeted gates | 单一重试/停止权、PPT repairIssues、稳定checkpoint、Provider/Skill lock、正式Schema、不可变round与返修范围绑定通过 |
| `executor` | passed through A23 + v2 recovery/closeout targeted gates | 强制Envelope、原子Tool结果、Observation、checkpoint、ActionPolicy阻断、同TurnJob启动恢复、审核前滚与锁接管通过；全量回归进行中 |
| `model orchestration` | R5 historical pass / unique product run pending | 既有R5证明动态Tool与Observation/Replan；本轮只新增离线合同证据，真实完整包轨迹仍由唯一V1-9证明 |
| `product E2E` | R5 historical pass / A23 new V1-9 preflight pending | 旧运行只读保留；A23新run尚未创建，尚无本轮PPTX、MP4或整包证据 |
| `release` | not verified | V1-9、教师签收、候选切流与发布后验证均未执行 |

## 2. 最近已完成阶段

| 阶段 | 状态 | 说明 |
|---|---|---|
| M61 | done | Agent 上下文门禁与异步队列 |
| M62/M63 | done | AgentWorldState、ToolObservation、AgentHarnessBudget |
| M64 | done | ToolRegistry、ToolRouter、内部工具/Provider adapter、CTS 接入 |
| M64-R | done | 17/17 工具注册一致性；PPTX、图片、视频统一经 ToolRouter；resolved Artifact 与 Artifact Truth Gate |
| M65 | done | OpenAI Responses native function_call 协议闭环与 OpenAIRuntime 可选接线 |
| M66-R runtime loop | done | OpenAIRuntime native tool loop 已通过显式开关接入生产 Runtime Factory；首批只暴露 internal tools，provider 工具仍后置 |
| M67 feedback center | implementation done / rollout pending | 工程实现、本地E2E及目标服务器重启、回滚和备份恢复均已完成；正式公网反馈写入复核等待V1-9与切流阶段 |
| Agent workflow foundation | control-plane revalidation closed / unique product E2E pending | `asset_image_generate`、`concat_only_assemble`、真实最终包与package resolved Artifact门禁保留；单一Orchestrator与原子Observation已由A10-A23验收，动态模型控制沿用R5历史桌面证据，完整包轨迹留给唯一V1-9 |
| V1-9A至V1-9E | done | 真实时间线、成片审查证据、受控音字轨、版本一致最终包和30-90秒完整导入视频门禁已封板 |
| V1-9F Main Agent runtime recovery | component fix done / product acceptance failed later | Critic Schema兼容问题已修；后续38条真实对话证明19步计划停留不是合法完成，而是任务语义丢失与重复确认的P0证据 |
| V1-9G final package runtime lineage | done / localhost staging verified | 四类语义源必须为真实OpenAI Runtime产物才能进入最终ZIP；精确提交`ea84cd2`、生产预检15/15、重启和数据摘要不变均通过；未调用真实媒体、未切公网流量 |
| V1-10A release topology and recovery | done / target evidence closed by V1-10C至V1-10F | 单实例SQLite预检、脱敏健康检查、离线备份/校验/新目录恢复和runbook完成；目标服务器证据已在后续阶段关闭 |
| V1-10B isolated standalone rehearsal | done / target evidence closed by V1-10C至V1-10F | 隔离SQLite与Artifact根完成schema、管理员、production preflight、build和standalone 200/401/403检查；目标服务器证据已在后续阶段关闭 |
| V1-10C target container runtime | done / localhost staging verified | 精确提交`75bf141`目标服务器镜像构建、非root单容器、共享SQLite/Artifact、重启持久性、200/401/403及既有服务保护均通过；未切公网流量 |
| V1-10D target rollback and recovery | done / localhost rehearsal verified | 代码回滚/前滚、停写backup/verify、全新目录restore、独立恢复容器及WAL错误挂载fail-closed均通过；staging已升级精确提交`c7533ef`，未切公网流量 |
| V1-10E minimal runtime and Provider readiness | done / localhost staging verified | 精确提交`3d6bf0a`最小镜像、生产预检14/14、四类Provider配置、Main Agent Responses 200、重启和数据哈希不变均通过；未调用真实媒体、未切公网流量 |
| V1-10F TTS Provider readiness | done / localhost staging verified | 关闭TTS缺失但预检全绿的P0；精确提交`098e651`、生产预检15/15、TTS配置、重启和数据哈希不变均通过；未调用真实媒体、未切公网流量 |
| V1-10G atomic container switch | done / target isolated rehearsal verified | `flock`互斥、候选预检、安全创建、Docker/HTTP双健康门、成功切换和故障注入回退均通过；正式staging安全参数已恢复，未调用真实媒体、未切公网流量 |
| M69 multi-user management | implementation done / rollout pending | 内测账号分配、登录、管理员用户管理、项目成员共享与隔离已完成；真实用户开放统一等待V1-9产品内E2E和V1-10发布门 |
| M70 frontend workbench polish | done | 首次欢迎态、附件拖放/截图粘贴、文件状态、工具菜单、假入口清理和桌面/390px 响应式验收已完成 |
| M71A project lifecycle and feedback polish | done | 反馈选中态、轻量问候、项目重命名、归档、回收站、恢复、生命周期写入门禁与受控回退已完成；不含永久删除 |
| M72 nonlinear beta readiness | done | 反馈、安全隔离和历史归属已验证；“只做视频脚本”会说明最小缺口，不再进入无解确认循环，桌面与 390px 已验收 |
| M73 artifact capability navigation | done | 最多 6 个能力入口、备课成果抽屉、分组筛选与返回来源通过自动化和真实浏览器验收 |
| M74 branded auth page | done | 1366×768 与 390px 品牌认证入口通过；公网注册关闭仍属于发布门禁 |
| M75 authenticated welcome | done | 登录/刷新先到欢迎页，主动选择或新建后进入项目 |
| M76 interactive list row | done | 三处计划内列表迁移完成，颜色型交互与独立菜单边界通过 |
| M77 select polish | done | 真实 owner 完成成员新增、Select 展开、键盘选择、PATCH 保存和刷新恢复；桌面与 390px 均通过 |
| M78 unified UI system | done | 全局基础组件及常用页面验收完成，继承的 M77 owner 写路径门禁已关闭 |
| V1 Stage 1A | done | actor/session 快照、项目级 SQLite lease、心跳、单调 fencing、后台写守卫和旧 worker quarantine 已完成 |
| V1 Stage 1B | done | IntentEpoch、RunInputSnapshot、inputHash、GenerationJob 幂等、taskId 恢复和 submission_unknown 已完成 |
| V1 Stage 1C | done | Provider 结果 staging、storage refs、身份/fence 隔离、Artifact/Node/Job 原子提升及三入口统一租约已完成 |
| V1 Stage 2A | done | Runtime Contract、Pre/Post Validator、ValidationReport、报告持久化及 ToolRouter enforcement 已完成 |
| V1 Stage 2B | done | CriticReport、固定 Rubric、确定性 QualityDecision、当前 Artifact 绑定及原子持久化已完成 |
| V1 Stage 2C | done | 统一 Observation 回流、精确重复失败阻断、checkpoint 恢复、自然语言改道失效及 finish 三证据门已完成 |
| V1 Stage 3A | done | PPT 结构化设计包、逐页 PageSpec、无障碍语义、页级影响分析、OpenAI 运输及 PostValidator 门已完成 |
| V1 Stage 3B/3C | historical production evidence | 高年级与低年级真实PPT证明工艺可行；不再以前段追加中年级真实任务作为当前主线 |
| V1 Stage 4 | one passed / one concept rework | 高年级视频已有真实链路证据；低年级18秒和60秒视频技术通过但独立创意锚点失败，退回Concept Selection |
| V1 Stage 5 | one passed / one package invalidated | 低年级ZIP文件结构和哈希通过，但因核心视频不合格撤销完整交付资格；尚无真实教师签收 |
| V1 Stage 6 local gates | done / external gates pending | M67 7 通过/1 设计跳过；接管基线Node 259/259、Vitest 659/659、构建、SQLite 双初始化通过；故障合同 90/90 通过 |
| V1-1 orchestration attribution | done | 已证明当前为模型首步选择加固定DeliveryPlan续步，不是Main Agent同轮多Tool ReAct |
| V1-2 Tool/Agent Tool registration | done | Agent Tool专项140/140、全量Node 259/259、Vitest 763/763、构建、SQLite双初始化和diff审查通过；三个Agent Tool仍不接生产Executor |
| V1-3 Main Agent controlled ReAct | historical component gap / superseded by R5 and A10-A23 | 三个只读Agent Tool与Observation合同保留；当时业务Tool未进入连续循环且Tool后被强制停回确认，该缺口已由V1-9R3、R5真实桌面与A10-A23关闭 |
| V1-4 HumanGate and interruption | historical product failure / superseded by R5 and A10-A23 | 防重放、IntentEpoch和影响分析保留；当时逐Tool确认及执行确认与产物批准混用的P0已由V1-9R1/R2、R5与A10-A23关闭 |
| V1-5 generation intensity | historical P1 / superseded by R5 and A10-A23 | 四档与升级边界保留；服务端快照、Runtime贯穿、409权威状态和UI同步已在V1-9R1/R4及A10-A23复验关闭 |
| V1-6 PPT internal orchestration | historical domain contracts / control-plane revalidation closed | PPT Critic与页级返修合同保留；Main Agent动态编排已有R5历史桌面证据，真实完整PPTX仍由唯一V1-9验收 |
| V1-7 video internal orchestration | historical domain contracts / control-plane revalidation closed | 课程锚点与成片Critic合同保留；Main Agent动态编排已有R5历史桌面证据，真实完整MP4仍由唯一V1-9验收 |
| V1-8 two-user concurrency | single-process base retained / R5 isolation passed | 双用户底座保留；含TaskBrief、授权、decision和费用状态的不串线已由R5真实桌面与仓内回归复验，唯一V1-9继续验证完整任务运行 |
| V1-9R autonomy and HumanGate recovery | R0-R5 passed / A10-A23 contract-executor closeout passed | 仓内控制面、assistant-ui与真实桌面自主控制面验收已关闭；旧V1-9只读保留，A23新唯一运行冻结合同实施中 |

## 2.1 v1 与接管基线

- 候选提交：`fffdfb3b050782208bb6e288d3e324ba44a4c659`。
- annotated tag：`v1`，仍指向上述提交，未移动、未重写。
- V1上线前接管提交：`c85c49f65d0fb6a438c06dba76e5e81ad271dbbc`；annotated tag：`v1.1.0-alpha`。该标识表示执行安全、合同质量、PPT链路和规划已形成，产品内Main Agent编排、视频创意门、双用户并发和发布门待完成。
- V1-1至V1-4工作发生在接管标签之后；进入新会话必须重新核对`main`与`origin/main`及工作树，历史`v1`、`v1.1.0-alpha`与`v1.1.0-alpha.1`均不移动、不重写。
- 2026-07-13 V1-2最终封板证据：Agent Tool专项8文件140/140；TypeScript exit 0；Node 259/259；Vitest 103文件763/763；生产构建exit 0并生成13个静态页面；`.tmp`隔离SQLite同库连续初始化2/2；`git diff --check` exit 0。构建保留3条既有动态文件模式性能警告。
- 2026-07-13 V1-3最终封板证据：专项15文件197/197；TypeScript exit 0；Node 259/259；完整Vitest随`npm test` exit 0；生产构建exit 0并生成13个静态页面；`.tmp\v1-3-init.db`同库连续初始化2/2；`git diff --check` exit 0。未调用真实媒体Provider。
- 2026-07-13 V1-4最终封板证据：专项7文件96/96；TypeScript exit 0；Node 259/259；完整Vitest exit 0；生产构建exit 0并生成13个静态页面；`.tmp\v1-4-init.db`同库连续初始化2/2；`git diff --check` exit 0。未调用真实媒体Provider。
- 2026-07-13 V1-5最终封板证据：专项7文件52/52；TypeScript exit 0；Node 259/259；Vitest 110文件799/799；生产构建exit 0并生成13个静态页面；`.tmp\v1-5-generation-intensity.db`同库连续初始化2/2；1366×768和390×844真实浏览器通过；`git diff --check` exit 0。未调用真实媒体Provider。
- 2026-07-13 V1-6最终封板证据：专项7文件71/71；TypeScript exit 0；Node 259/259；完整Vitest通过；生产构建exit 0并生成13个静态页面；`npm test`隔离SQLite初始化与持久化测试通过；`git diff --check` exit 0。无UI改动，浏览器项不适用；未调用真实媒体Provider。
- 2026-07-13 V1-7最终封板证据：专项10文件150/150；TypeScript exit 0；Node 259/259；完整Vitest随`npm test`正常完成；生产构建exit 0并生成13个静态页面；隔离SQLite初始化与视频审查持久化通过；`git diff --check` exit 0。无UI改动，浏览器项不适用；未调用真实媒体Provider。
- 2026-07-13 V1-8最终封板证据：专项7文件43/43、双用户综合1/1；TypeScript exit 0；Node 259/259；完整Vitest随`npm test`正常完成；生产构建exit 0并生成13个静态页面；隔离SQLite与WAL实测通过；`git diff --check` exit 0。目标部署限定单Node进程/单Prisma singleton；未调用真实媒体Provider。
- 2026-07-13 最新产品纠偏证据：真实项目38条消息连续形成8个`requirement_spec`，均未批准且未推进教案/PPT/视频；完整`inputDraft`在内部Tool边界丢失；22个Capability全部逐Tool确认；业务Tool不能进入Main Agent内循环；Tool成功后强制回到确认；8个产物全部为`deterministic_draft`。因此V1-3/V1-4/V1-6/V1-7的历史测试计数只保留为合同证据，不再支持“产品自主编排已完成”的结论。
- 2026-07-13 V1-9G最终封板证据：四类语义源真实Runtime门专项23/23；Node 271/271；Vitest 119文件849/849；生产构建14/14页面；目标服务器精确镜像生产预检15/15、Docker healthy、重启、SQLite integrity、管理员和数据摘要复验通过。未调用真实媒体Provider、未切公网流量。
- 2026-07-12低年级真实包的PPT、文件结构、hash和Provider技术链有证据，但视频独立创意与课程锚点失败，整包完整交付资格已撤销；`teacher_signoff=false`，只能作为工艺和负例证据。
- 提交标题里的“封板完成”仅指工程验证交接与文档封板完成，不代表发布门禁、真实 Provider 或目标服务器上线门禁完成。

## 2.2 浏览器证据索引

证据位于本机 Playwright CLI 运行目录，不纳入产品代码提交：

| 证据 | 路径 | 覆盖 |
|---|---|---|
| 1366×768 认证页与品牌入口截图 | `.playwright-cli\page-2026-07-11T15-26-56-221Z.png` | M74 品牌认证页 |
| 390px 工作台截图 | `.playwright-cli\page-2026-07-11T15-23-07-872Z.png` | M75/M76/M78 窄屏工作台 |
| 390px 账号乙欢迎页截图 | `.playwright-cli\page-2026-07-11T15-26-16-941Z.png` | 双账号隔离后的空项目欢迎页 |
| 备课成果抽屉快照 | `.playwright-cli\page-2026-07-11T15-22-41-188Z.yml` | M73 能力分组与成果抽屉 |
| 反馈提交成功快照 | `.playwright-cli\page-2026-07-11T15-24-05-858Z.yml` | M72/M78 反馈提交返回 201 |
| 双账号隔离 API 证据 | Playwright CLI 控制台输出，时间段 `2026-07-11T15:25-15:27` | 项目、消息、产物、下载、反馈权限、CSRF、会话撤销 |
| 按需视频脚本桌面截图 | `.playwright-cli\page-2026-07-11T17-59-21-969Z.png` | M72 明确最小缺口且不扩张到 PPT/最终视频 |
| 按需视频脚本 390px 截图 | `.playwright-cli\page-2026-07-11T17-59-35-400Z.png` | M72 窄屏换行、无遮挡和无横向溢出 |
| owner 成员权限 390px 截图 | `.playwright-cli\page-2026-07-11T18-01-49-316Z.png` | M77/M78 Select 展开、选中和弹层边界 |

## 3. 当前优先级

当前优先级从高到低：

1. V1-9仓内preflight：复验已实现的显式前序关系、旧manifest不可变、源码/需求/Registry/A23/Policy/Provider全摘要冻结、run-state v2、审核恢复和运行内漂移失败关闭。
2. V1-9：新manifest、输入/授权/强度/预算和Task合同冻结后，只执行一次产品Main Agent自主编排的真实Provider全链路，验证真实可编辑PPTX、完整MP4、最小课程锚点、`ClassroomRunSpec`和版本一致ZIP，失败只返修受影响页面、镜头或版本。
3. V1-9外部验收：外部Codex只读取最终包形成`ExternalAcceptanceReport`；不选择Tool、不批准中间产物、不手工补包。
4. V1-10：真实全链路及外部黑盒审核通过后，进入候选环境、故障恢复、教师签收、原子切流和发布后验证；部署、生产写入和发布按当次授权门执行。

## 4. 下一阶段建议

当前唯一执行点：

```text
A23新V1-9全量仓内回归与只读preflight
```

执行顺序：

1. A10-A23仓内合同与执行器门已新鲜关闭：A23 `9 files / 132 tests`、控制面 `24 files / 247 tests`、Node `302/302`、Vitest `185 files / 1343 tests`、TypeScript、13页生产构建、Skill suite `53/53`和diff check通过；不得重复这些实现切片。
2. 恢复决定已形成：旧manifest/runId/Skill lock只作历史失败证据。先完成全量仓内回归和只读preflight；全绿后才以显式`start-new + predecessorRunId`创建A23新run，并在创建前后核对旧manifest哈希不变。
3. 新run一次冻结当前main工作树、需求基线、原`shanhaiedu-技能系统`活动Registry、其A23 Projection、Binding Policy、全部Provider非敏感摘要及输入；fresh preflight只读验证。后续只有同合同暂时故障可恢复，实质升级必须终止并另建显式后继。
4. 由产品Main Agent自主完成教案、PPT、课堂视觉图、独立创意导入视频、课程锚点、`ClassroomRunSpec`和最终ZIP，外部Codex运行中编排介入0。成包后只做外部黑盒验收；失败按finding locator返修受影响页面、镜头或版本，不整链重跑。V1-9通过后再进入教师签收与V1-10。

仓内六个P1、A10-A23、assistant-ui重构门和R5历史真实桌面已经关闭。390px不属于V1发布前门禁。A23新run冻结合同与preflight通过后执行唯一一次V1-9真实E2E；外部黑盒审核P0=0后才由至少一名真实教师在候选环境签收并进入原子公网切流。目标服务器运行、回滚、恢复、最小镜像和Provider配置底座继续保留，只做受影响回归。

V1 Agent 与交付质量设计、Contracts、Prompts 和实验依据已经迁入项目，统一入口：

```text
docs\architecture\2026-07-11-v1-agent-delivery-quality\README.md
```

2026-07-13 起，V1上线前后续执行以产品内编排和两用户邀请制为中心，不再继续由外部Codex制作更多验收包。实施与测试入口：

```text
docs\stages\local-real-v1-mainline-adjustment-plan.md
docs\stages\local-real-v1-mainline-adjustment-test-plan.md
docs\stages\local-real-v1-v1-9r-agent-autonomy-human-gate-recovery-plan.md
docs\stages\local-real-v1-v1-9r-agent-autonomy-human-gate-recovery-test-plan.md
docs\stages\local-real-v1-v1-2-tool-agent-tool-registration-checkpoint.md
docs\stages\local-real-v1-v1-3-main-agent-controlled-react-closeout.md
docs\stages\local-real-v1-v1-4-human-gate-natural-language-interruption-closeout.md
docs\handoffs\2026-07-13-v1-main-agent-mainline-handoff.md
```

## 5. 不做事项

- 不批量移动旧阶段文档。
- 不删除旧文档、旧分支或旧 worktree。
- 不把 runtime native tool loop 与自然语言确认修复混在同一个提交里。
- 不放松 HumanGate、PlanGuard、Quality Gate。
- 不在本轮实现 MagicSchool / Canva 竞品研究衍生的第二档能力。
