# Local Real MVP 当前主线状态

更新时间：2026-07-13（V1 产品内编排主线推进）

## 1. 当前主线

当前唯一开发主线：

```text
V1 交付质量与邀请制上线
```

目标：在现有 Local Real MVP 代码基线上，让两名受邀教师通过可暂停、改道和局部返修的 Main Agent，真实获得可上课的教案、可编辑 PPTX、课堂视觉图、完整导入视频和版本一致的最终材料包；产品内智能体自主完成规划、Tool调用、课程锚点审查、HumanGate、Quality Gate和返修，外部Codex只负责工程实现与阶段末黑盒验收。

当前阶段：`V1-1编排归因审计与V1-2 Tool/Agent Tool合同封板已完成；下一阶段是V1-3 Main Agent同轮受控ReAct，先写计划与测试定义，再接生产Executor和Dispatcher`。

## 2. 最近已完成阶段

| 阶段 | 状态 | 说明 |
|---|---|---|
| M61 | done | Agent 上下文门禁与异步队列 |
| M62/M63 | done | AgentWorldState、ToolObservation、AgentHarnessBudget |
| M64 | done | ToolRegistry、ToolRouter、内部工具/Provider adapter、CTS 接入 |
| M64-R | done | 17/17 工具注册一致性；PPTX、图片、视频统一经 ToolRouter；resolved Artifact 与 Artifact Truth Gate |
| M65 | done | OpenAI Responses native function_call 协议闭环与 OpenAIRuntime 可选接线 |
| M66-R runtime loop | done | OpenAIRuntime native tool loop 已通过显式开关接入生产 Runtime Factory；首批只暴露 internal tools，provider 工具仍后置 |
| M67 feedback center | implementation done / rollout pending | 工程实现与本地 E2E 已完成；真实服务器重启、回滚和备份恢复门禁待关闭 |
| Agent workflow closure | implementation done / V1-9 real E2E pending | `asset_image_generate`、`concat_only_assemble`、真实最终包与package resolved Artifact门禁已完成；不在前段追加真实Provider smoke |
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

## 2.1 v1 与接管基线

- 候选提交：`fffdfb3b050782208bb6e288d3e324ba44a4c659`。
- annotated tag：`v1`，仍指向上述提交，未移动、未重写。
- V1上线前接管提交：`c85c49f65d0fb6a438c06dba76e5e81ad271dbbc`；annotated tag：`v1.1.0-alpha`。该标识表示执行安全、合同质量、PPT链路和规划已形成，产品内Main Agent编排、视频创意门、双用户并发和发布门待完成。
- V1-1/V1-2工作发生在接管标签之后；进入新会话必须重新核对`main`与`origin/main`及工作树，历史`v1`与`v1.1.0-alpha`均不移动、不重写。
- 2026-07-13 V1-2最终封板证据：Agent Tool专项8文件140/140；TypeScript exit 0；Node 259/259；Vitest 103文件763/763；生产构建exit 0并生成13个静态页面；`.tmp`隔离SQLite同库连续初始化2/2；`git diff --check` exit 0。构建保留3条既有动态文件模式性能警告。
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

1. V1-3完成Main Agent同轮Observe/Replan、可信Agent Tool Executor、统一Dispatcher和固定DeliveryPlan显式降级。
2. 后续阶段完成自然语言打断、PPT/视频产品内编排、课程锚点前置与成片后Critic、双用户隔离和恢复。
3. 仅在V1-1至V1-8通过后执行一次产品内真实PPT/视频/最终包E2E；外部Codex在成包后黑盒审核并将问题归因到责任层。
4. 完成目标服务器恢复、公开注册关闭复核和真实教师签收后开放邀请制V1。

## 4. 下一阶段建议

用户已经批准继续推进 V1 交付质量主线。PPT、图片、视频和最终包的底层生产链已经有真实证据，下一阶段不再由外部Codex重复制作交付包，而是验证产品内部Main Agent的协调能力。当前唯一恢复点：

```text
V1-3：Main Agent同轮受控ReAct
```

推荐拆分：

1. 读取V1-2 closeout并复用已封板的Registry、Schema、Router和授权边界。
2. 先写V1-3计划与测试计划，再实现统一Dispatcher、可信Executor和同轮Observation/Replan。
3. 固定DeliveryPlan只作为显式降级，注入Executor和外部人工编排均不计入产品能力。
4. 前段使用确定性夹具、失败注入和状态证据验证编排，避免频繁调用真实图片/视频Provider。
5. V1-9由产品智能体独立生成真实交付包，外部Codex只在成包后审查PPT、视频、课程一致性和链路归因，再推动定点优化。
6. 保持既有`v1`、`v1.1.0-alpha`和`v1.1.0-alpha.1`标签不动；最终邀请制发布使用新的不可变发布标识。

当前明确未关闭的上线门：V1-2 Agent Tool正式封板、Main Agent同轮受控ReAct、HumanGate与自然语言打断、四档生成强度、PPT/视频产品内闭环、课程锚点独立Critic审查、双用户并发、产品内真实E2E、目标服务器恢复、公开注册关闭复核和至少一名真实教师签收。既有真实包只作为工艺、Provider和负例证据，不作为产品Main Agent已经通过的证据。

V1 Agent 与交付质量设计、Contracts、Prompts 和实验依据已经迁入项目，统一入口：

```text
docs\architecture\2026-07-11-v1-agent-delivery-quality\README.md
```

2026-07-13 起，V1上线前后续执行以产品内编排和两用户邀请制为中心，不再继续由外部Codex制作更多验收包。实施与测试入口：

```text
docs\stages\local-real-v1-mainline-adjustment-plan.md
docs\stages\local-real-v1-mainline-adjustment-test-plan.md
docs\stages\local-real-v1-v1-2-tool-agent-tool-registration-checkpoint.md
docs\handoffs\2026-07-13-v1-main-agent-mainline-handoff.md
```

## 5. 不做事项

- 不批量移动旧阶段文档。
- 不删除旧文档、旧分支或旧 worktree。
- 不把 runtime native tool loop 与自然语言确认修复混在同一个提交里。
- 不放松 HumanGate、PlanGuard、Quality Gate。
- 不在本轮实现 MagicSchool / Canva 竞品研究衍生的第二档能力。
