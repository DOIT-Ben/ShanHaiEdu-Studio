# Local Real MVP 当前主线状态

更新时间：2026-07-12（V1 交付质量主线接管）

## 1. 当前主线

当前唯一开发主线：

```text
V1 交付质量与邀请制上线
```

目标：在现有 Local Real MVP 代码基线上，让受邀教师通过可暂停、改道和局部返修的 Main Agent，真实获得可上课的教案、可编辑 PPTX、课堂视觉图、完整导入视频和版本一致的最终材料包；通过真实 Provider、服务器恢复和教师签收后开放邀请制 V1。

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
| Agent workflow closure | implementation done / smoke pending | `asset_image_generate`、`concat_only_assemble`、真实最终包与 package resolved Artifact 门禁已完成；真实外部 provider smoke 待执行 |
| M69 multi-user management | implementation done / rollout pending | 内测账号分配、登录、管理员用户管理、项目成员共享与隔离已完成；真实用户开放仍等待生产门禁和真实 provider smoke |
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
| V1 Stage 3B/3C | two real courses done | 高年级《百分数的意义》与低年级《1～5 的认识》均完成真实样张/资产、12 页可编辑 PPTX/PDF、逐页渲染和页级返修；中年级待教材输入 |
| V1 Stage 4 | one passed / one concept rework | 高年级视频已有真实链路证据；低年级18秒和60秒视频技术通过但独立创意锚点失败，退回Concept Selection |
| V1 Stage 5 | one passed / one package invalidated | 低年级ZIP文件结构和哈希通过，但因核心视频不合格撤销完整交付资格；尚无真实教师签收 |
| V1 Stage 6 local gates | done / external gates pending | M67 7 通过/1 设计跳过；Node 259/259、Vitest 658/658、构建、SQLite 双初始化通过；故障合同 90/90 通过 |

## 2.1 v1 候选基线

- 候选提交：`fffdfb3b050782208bb6e288d3e324ba44a4c659`。
- annotated tag：`v1`，仍指向上述提交，未移动、未重写。
- 交接文档提交：`7ad967c69fd7539e6ba64495384e4be322fbc175`、`a6c11b8e390ca19e327b652f24e6760a204334ce`；当前 `main` HEAD 为 `a6c11b8`，相对 `origin/main` ahead 2 / behind 0，两个提交均只修改文档。
- 当前工作树包含尚未提交的 V1 Agent/交付质量资料迁入，以及 M72 最小缺口说明的代码和测试；仍需保留三层基线区分：`v1` 历史代码、交接文档 HEAD、当前 V1 实施工作树。
- 2026-07-12 Stage 6 新鲜工程证据：Node 259/259；Vitest 658/658；M67 7 通过/1 按设计跳过；生产构建、SQLite 连续初始化和 `git diff --check` 通过。
- 2026-07-12 低年级真实交付：人教版一年级上册《1～5 的认识》官方教材证据、12 页可编辑 PPTX/PDF、18.166 秒真实 Grok 三镜头 MP4、课时方案与 35,733,473 bytes 最终 ZIP 均通过集成审查和反向验包；`teacher_signoff=false`。
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

1. 为中年级几何/测量补齐真实教材、版本、页码和例题/主题图证据，再生产最后一套 PPTX/MP4/ZIP。
2. 执行真实断网、跨标签页、worker 强杀恢复和目标服务器共享卷/回滚/备份恢复演练。
3. 邀请至少一名真实教师完成首次任务、局部返修、下载和可授课签收。

## 4. 下一阶段建议

用户已经批准继续推进 V1 交付质量主线。执行安全、受控 ReAct、首套高年级 PPT/视频/最终包、本机浏览器与全量质量门已经完成。当前进入：

```text
V1 Stage 6：补齐两套教材输入与真实交付、外部故障/服务器恢复和教师签收
```

推荐拆分：

1. 中年级新课件必须获得真实教材输入；现有实验材料不能冒充教材页码证据。
2. 复用已经验证的样张、全量生产、逐页返修、视频参考实传和版本化打包链路，不扩张无关架构。
3. 邀请真实用户前关闭目标服务器共享卷重启、release 回滚、备份恢复、公开注册和真实教师签收门。
4. 保持既有 `v1` 标签不动；最终邀请制发布使用新的不可变发布标识，不重写历史候选标签。

当前明确未关闭的上线门：低年级视频独立创意重选、真实重制和整包复验，中年级教材证据及最后一套真实 PPTX/MP4/最终包，真实断网与 worker 强杀实操，目标服务器共享卷重启、release 回滚、备份恢复、公开注册关闭复核，以及至少一名真实教师签收。高年级交付与本机自动化质量门已关闭；低年级仅 PPT 门关闭，视频与整包门重新打开；集成批准不得冒充教师签收。

V1 Agent 与交付质量设计、Contracts、Prompts 和实验依据已经迁入项目，统一入口：

```text
docs\architecture\2026-07-11-v1-agent-delivery-quality\README.md
```

2026-07-13 起，V1上线前后续执行以产品内编排和两用户邀请制为中心，不再继续由外部Codex制作更多验收包。实施与测试入口：

```text
docs\stages\local-real-v1-mainline-adjustment-plan.md
docs\stages\local-real-v1-mainline-adjustment-test-plan.md
```

## 5. 不做事项

- 不批量移动旧阶段文档。
- 不删除旧文档、旧分支或旧 worktree。
- 不把 runtime native tool loop 与自然语言确认修复混在同一个提交里。
- 不放松 HumanGate、PlanGuard、Quality Gate。
- 不在本轮实现 MagicSchool / Canva 竞品研究衍生的第二档能力。
