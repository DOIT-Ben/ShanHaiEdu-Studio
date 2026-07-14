# Local Real MVP 当前主线状态

更新时间：2026-07-14（V1-9R仓内控制面通过，R5仅待Provider完整Main Agent与结构化文本链路健康）

## 1. 当前主线

当前唯一开发主线：

```text
V1 交付质量与邀请制上线
```

目标：在现有 Local Real MVP 代码基线上，让两名受邀教师通过可暂停、改道和局部返修的 Main Agent，真实获得可上课的教案、可编辑 PPTX、课堂视觉图、完整导入视频和版本一致的最终材料包；产品内智能体自主完成规划、Tool调用、课程锚点审查、HumanGate、Quality Gate和返修，外部Codex只负责工程实现与阶段末黑盒验收。

当前阶段：`V1-9R5 in progress / autonomous control-plane acceptance`。V1-9R0至R4已按对应计划和测试完成，不重做；V1-9A至V1-9G的媒体/Runtime/最终包前置硬化和V1-10A至V1-10G的部署/恢复底座继续保留。当前只关闭Main Agent自主选择高层业务Tool、动态Observe/Replan、失败恢复、暂停/改道/局部任务、桌面体验和两用户隔离；V1发布前不再运行390px真实黑盒。V1-9真实Provider E2E、正式公网切流和教师签收仍暂停。

2026-07-14最新仓内结论：`ppt_design`已按ADR分成R5紧凑语义候选与V1-9生产设计包。R5模型只生成`ppt-design-candidate.v1`的TaskBrief digest、完整目标语义、可信Artifact证据绑定、教学目标、叙事和连续逐页候选；服务端只计算candidate digest并验证最低结构，不确定性补全PageSpec、可编辑层、样张计划或production checks。缺少正式`pptDesignPackage`时，真实媒体Tool继续失败关闭。

本轮新鲜仓级门为：候选定向`3 files / 35 tests`、控制面扩大回归`16 files / 203 tests`、Node`284/284`、单worker排除独立互动课件Stage7在途冲突后Vitest`127 files / 960 tests`、TypeScript、生产构建14页面和`git diff --check`全部通过；构建仍只有既有5条动态文件模式警告。Runner证据隔离测试`8/8`，每次真实黑盒现在把脱敏snapshot写入该次独立run目录并记录非敏感Provider通道。

primary桌面运行`test-results\m67-e2e-47140-1784026423599\`证明Main Agent检查点压缩有效：一句话PPT三次Main Agent请求约`8.6k-10.2k tokens`，响应约`4.7-6.5s`，先自主选择并完成`create_requirement_spec`，再选择`create_ppt_outline`；后者的结构化文本Runtime单次180秒timeout，Observation保存`reasonCodes=[timeout,tool_execution_not_succeeded]`和`minimalNextAction=repair_upstream`，随后诚实暂停。A/B前置场景仍为0媒体GenerationJob、0外部Codex编排介入。

fallback ledger的最小Responses探针成功后，显式选择fallback执行桌面`test-results\m67-e2e-61104-1784027400662\`；两名教师的首轮真实Main Agent请求均在约1.0-1.1秒返回`403 Your request was blocked`。两次请求各约`8.7k tokens`并携带1个合格业务Tool，尚未产生Tool选择、Artifact或GenerationJob。该证据证明“最小Responses成功”不等于真实Main Agent工具请求健康；责任层仍是Provider访问/风控或兼容边界，不是1M上下文、SQLite、UI、Tool资格或PPT候选本地Schema。

当前权威状态：**仓内控制面通过，R5唯一剩余阻塞是同一Provider通道稳定完成带Tool的Main Agent Responses及后续结构化文本业务调用，并补齐真实桌面证据**。不再做等价最小探针或浏览器重跑；桌面未通过，R5未关闭，不创建closeout且不得进入V1-9。390px不属于V1发布前门禁。显式离线fixture仍只证明仓内合同，不能冒充真实Main Agent或R5整体通过。

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

1. V1-9R5：完成自主控制面验收。Main Agent看到全部当前合格的高层业务Tool并自主形成动态轨迹；服务端不固定下一Tool，Director/Critic不作为机械必经节点；Tool成功或失败后的具体Observation与ValidationReport reasonCode返回Main Agent，由其continue、repair、换Tool或Replan。
2. V1-9R5黑盒：一句话PPT只推进到真实模型来源、任务语义完整、证据绑定、最低结构有效且可供下游使用的设计候选；完整材料包只验证任务范围、规划、授权、Observation/Replan和双用户无串线，不调用真实图片、视频或整包Provider。
3. V1-9R5体验与停止：标准任务零例行确认；暂停、改道、局部任务、桌面、R-A01至R-A18及R-U01至R-U06有证据；重复失败不默认`ask_teacher`，预算耗尽时诚实暂停并保存恢复入口；外部Codex运行中编排介入为0。390px沿用既有合同证据，不做新的真实运行。
4. V1-9：R5关闭后只执行一次产品Main Agent自主编排的真实Provider全链路，验证真实可编辑PPTX、完整MP4、最小课程锚点、`ClassroomRunSpec`和版本一致ZIP，失败只返修受影响页面、镜头或版本。
5. V1-10：真实全链路及外部黑盒审核通过后，进入候选环境、故障恢复、教师签收、原子切流和发布后验证；部署、生产写入和发布按当次授权门执行。

## 4. 下一阶段建议

当前唯一恢复点：

```text
V1-9R5：Main Agent自主控制面验收
```

执行顺序：

1. forced-next-tool、Director/Critic机械前置和同一Tool重复失败默认`ask_teacher`的代码责任边界已关闭；保留权限、预算、版本、血缘、费用和副作用确定性门禁。
2. 当前等待同一Provider通道出现新的完整健康证据：既能接受带合格业务Tool与strict structured output的Main Agent Responses，又能完成随后结构化文本业务Tool；无Tool最小Responses、单段JSON或仅配置存在均不足以触发重跑。
3. 有新的通道级健康变化后，不再单独重复最小探针，只跑一次隔离真实桌面；黑盒只断言模型自主选择Tool和形成动态轨迹，不断言固定Tool顺序，完整材料包场景不得调用真实图片、视频或整包Provider。桌面通过后直接收口R5其余证据，不再跑390px。
4. R-A01至R-A18、R-U01至R-U06、暂停/改道/局部任务和两用户隔离全部有真实证据后才形成R5 closeout；外部Codex运行中编排介入次数必须为0。
5. R5关闭后才执行唯一一次V1-9真实Provider全链路；当前按用户要求停在R5汇报点，保持既有`v1`、`v1.1.0-alpha`和其他历史标签不动。

当前仓内合同已关闭；唯一未关闭的V1-9R上线门是Provider在同一通道恢复完整Main Agent工具请求与结构化文本业务调用后，由产品Main Agent在真实桌面完成自主Tool轨迹、失败Observation/Replan、暂停/改道/局部任务和两用户隔离证据。该门关闭前不创建R5 closeout、不执行V1-9真实全链路。390px不属于V1发布前门禁。真实E2E与外部黑盒审核P0=0后，先由至少一名真实教师在候选环境签收，再执行原子公网切流；切流后复核公开注册关闭、生产健康和教师关键路径。目标服务器运行、回滚、恢复、最小镜像和Provider配置底座已经关闭，只做受影响回归。

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
