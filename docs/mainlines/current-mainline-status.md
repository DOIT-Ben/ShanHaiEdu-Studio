# Local Real MVP 当前主线状态

更新时间：2026-07-13（V1-9R Main Agent自主编排与HumanGate恢复）

## 1. 当前主线

当前唯一开发主线：

```text
V1 交付质量与邀请制上线
```

目标：在现有 Local Real MVP 代码基线上，让两名受邀教师通过可暂停、改道和局部返修的 Main Agent，真实获得可上课的教案、可编辑 PPTX、课堂视觉图、完整导入视频和版本一致的最终材料包；产品内智能体自主完成规划、Tool调用、课程锚点审查、HumanGate、Quality Gate和返修，外部Codex只负责工程实现与阶段末黑盒验收。

当前阶段：`V1-9R0 next`。V1-9A至V1-9G的媒体/Runtime/最终包前置硬化和V1-10A至V1-10G的部署/恢复底座继续保留；但最新真实对话证明Main Agent自主编排与HumanGate产品体验不通过，V1-9真实Provider E2E、正式公网切流和教师签收全部暂停，必须先关闭V1-9R0至V1-9R5。

最新状态纠偏：V1-4只可表述为“底层安全合同完成 / 产品验收失败 / P0 reopen”；V1-3、V1-6、V1-7的组件与领域合同保留，但业务Tool连续自主调用重新验收；V1-5的强度贯穿和UI同步按P1重开。不能再要求教师多点一次确认来继续旧路线。

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
| Agent workflow closure | implementation done / V1-9 real E2E pending | `asset_image_generate`、`concat_only_assemble`、真实最终包与package resolved Artifact门禁已完成；不在前段追加真实Provider smoke |
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
| V1-3 Main Agent controlled ReAct | component contracts done / product revalidation open | 三个只读Agent Tool与Observation合同保留；业务Tool未进入连续循环，Tool后又被强制停回确认，转V1-9R3重验 |
| V1-4 HumanGate and interruption | contract tests done / product failed / P0 reopen | 防重放、IntentEpoch和影响分析保留；22个Capability逐Tool确认、执行确认与产物批准混用，转V1-9R1/R2纠偏 |
| V1-5 generation intensity | contract done / P1 reopen | 四档与升级边界保留；服务端快照、Runtime贯穿、409回权威状态和UI同步转V1-9R1/R4复验 |
| V1-6 PPT internal orchestration | domain contracts done / integration revalidation open | PPT Critic与页级返修合同保留；Main Agent自主连续编排转V1-9R3/R5重验 |
| V1-7 video internal orchestration | domain contracts done / integration revalidation open | 课程锚点与成片Critic合同保留；Main Agent自主连续编排转V1-9R3/R5重验 |
| V1-8 two-user concurrency | done for single-process V1 topology / regression required | 双用户底座保留；V1-9R新增TaskBrief、授权、decision和费用状态后必须重新验证不串线 |
| V1-9R autonomy and HumanGate recovery | next / blocks release | 先关闭真实失败基线、任务语义与授权、ActionPolicy、业务Tool连续ReAct、真实失败、关键UI和双用户黑盒，再恢复唯一真实整包 |

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

1. V1-9R0：把本次38条真实失败对话转成脱敏红测试，废止“逐节点继续/批准”作为成功行为。
2. V1-9R1/R2：贯通`TaskBrief + IntentGrant`，统一`PendingDecision`，用ActionPolicy把HumanGate收缩到真实风险与真实选择。
3. V1-9R3：让Main Agent发现并连续调用白名单业务Tool，Tool后自动Observe/Replan，不再统一停回确认。
4. V1-9R4/R5：禁止假fallback成功，关闭Markdown/历史成果/强度/窄屏问题，完成一句话任务和双用户黑盒回归。
5. V1-9：只执行一次产品内真实整包，外部Codex成包后黑盒审核；V1-10先完成候选教师签收，再原子切流并复核注册关闭和生产关键路径。

## 4. 下一阶段建议

当前唯一恢复点：

```text
V1-9R0：真实失败基线与旧验收语义纠偏
```

执行顺序：

1. 从真实项目提取脱敏fixture，稳定复现“理解正确、Tool输入丢失、重复requirement spec、60秒失败和deterministic草稿”。
2. 先写一句话PPT、继续、改道、风险HumanGate和无假fallback红测试，并识别与新产品目标冲突的旧断言。
3. 红测试成立后，按V1-9R1至R5顺序修改控制面；不靠增加Prompt限制或让教师再确认一次规避根因。
4. V1-9R5通过并形成恢复closeout前不调用新的真实整包Provider；V1-9运行中外部Codex介入编排次数必须为0。
5. 保持既有`v1`、`v1.1.0-alpha`和其他历史标签不动；最终邀请制发布使用新的不可变标识。

当前明确未关闭的上线门：Main Agent业务Tool连续自主调用、任务级授权、HumanGate职责分级、控制消息不丢任务、真实失败恢复、关键UI误导、受影响的双用户隔离和产品内真实E2E。真实E2E与外部黑盒审核P0=0后，先由至少一名真实教师在候选环境签收，再执行原子公网切流；切流后复核公开注册关闭、生产健康和教师关键路径。目标服务器运行、回滚、恢复、最小镜像和Provider配置底座已经关闭，只做受影响回归。

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
