# ShanHaiEdu V1 交付质量与邀请制上线主计划

更新时间：2026-07-12

状态：`Accepted / Active`

## 1. 目标

在现有 Local Real MVP 代码基线上，交付一个邀请制、小范围真实教师可用的小学数学公开课制作 V1。教师通过 Main Agent 提出目标并在任意关键节点暂停、修改、改道或局部返修，最终获得：

- 有教材依据的结构化教案；
- 逐页设计、真实可编辑并通过实物审查的 PPTX；
- 有独立创意且能回接课程的完整导入视频；
- 版本、血缘、文件和质量一致的最终材料包。

V1 完成不以“测试绿色”或“任务状态成功”为准，而以真实 PPTX、真实 MP4、真实局部返修、真实最终包、服务器恢复和教师签收为准。

## 2. 当前权威与基线

执行时按以下顺序解释：

```text
AGENTS.md
  > docs\product\current-requirements-baseline.md
  > docs\product\requirements-backlog.md
  > docs\mainlines\current-mainline-status.md
  > 本计划与对应 test-plan
  > 已接受 ADR
  > 迁入专题中的候选设计和历史审计
```

当前三层基线必须分开：

| 层 | 当前事实 | 约束 |
|---|---|---|
| V1 代码候选 | annotated tag `v1` 指向 `fffdfb3` | 不移动、不重写 |
| 交接文档 | `main` HEAD `a6c11b8`，本地 ahead 2 / behind 0 | 两个提交均为 docs-only |
| 当前规划资料 | V1 架构与交付质量资料处于未提交 docs 工作树 | 不把候选设计冒充已实现代码 |

2026-07-12 当前本机基线：Node 259/259、Vitest 658/658、M67 浏览器 7 通过/1 按设计跳过、生产构建、SQLite 连续两次初始化和 `git diff --check` 通过。后续架构、依赖和调用链判断以当前源码、配置、测试、运行日志和真实行为为准。

## 3. V1 产品边界

### 3.1 必须包含

1. M72、M77、M78 未关闭浏览器门禁收口。
2. 执行 actor、项目写租约、fencing token、IntentEpoch、输入快照、幂等和 Provider 任务恢复。
3. 可执行 Node Contract、Validator、Critic、QualityDecision 和 FinalDeliveryGate。
4. 有界 `Observe -> Plan -> Guard -> Act -> Observe -> Replan`，支持自然语言打断与定点返修。
5. PPT Quality 完整纵向闭环。
6. 视频 Full Intro 逐镜头完整纵向闭环。
7. `ClassroomRunSpec`、最终材料包真实性和版本一致性。
8. 三个真实小学数学任务、故障注入、真实教师演练和邀请制上线判断。

### 3.2 本轮不包含

- 不以迁移 LangGraph、OpenAI Agents SDK 或 Vercel AI SDK 为质量前置。
- 不建设通用 Agent 框架、完整 EventLog/Tracing、通用 MCP 平台或高自主度 Runtime。
- 不扩到全学科、全学段；V1 以小学数学校准质量。
- 不建设完整 Studio、共享资源库、LMS、学校多租户、SSO 或复杂 RBAC。
- 不重写既有 `v1` 标签，不把 preview、mock、deterministic draft 或 degraded 产物打进最终包。

### 3.3 V1 Main Agent 模型策略

- MainConversationAgent、ConversationOrchestrator 和 AgentRuntime 统一使用 `gpt-5.6-terra`，Responses 推理强度固定为 `high`。
- V1 不允许模型自行更换模型 ID；模型选择属于服务端受控配置，不由模型文本决策。
- 教师端模型选择器暂不进入当前切片。后续只有在候选模型 ID、推理强度、成本、延迟和降级策略完成真实基准后，才设计可见选项。
- Provider 未枚举或未实测通过的别名不得进入配置或前端，例如当前不存在的 `gpt-5.6-terra-extra`。

2026-07-13 已接受但尚未实施的目标调整见 RQ-027：后续把教师侧能力收敛为“标准、增强、深度、极致”四档生成强度，目标默认改为 `gpt-5.6-terra + medium`；`gpt-5.6-sol + high`仅作为极致档和万不得已的受控升级。该调整必须经过独立实施与测试，不能仅修改环境变量后宣称完成；在对应 closeout 前，当前运行事实仍是 Terra High。

复杂任务升级采用“系统建议、用户确认、下一次调用生效”：模型不得自行切换模型，服务端必须基于持久化失败、质量定位、重试预算和IntentEpoch判断建议资格；教师只看到强度与积分趋势，不看到模型名。

## 4. Skill 使用边界

本计划不绑定任何开发方法类 Skill，不把特定开发 Skill 作为前置、门禁或完成条件，尤其不得要求调用任何 `superpowers:*` 系列 Skill。

允许按实际业务需要使用 PPT、视频、图像、浏览器验证和 Provider/API 等功能型 Skill。它们只提供专项能力，不接管 Main Agent，不改变合同、Guard、质量门、Artifact/Job 状态或教师确认边界，也不构成阶段完成的强制依赖。

## 5. 分阶段实施

| 阶段 | 目标 | 核心工作 | 退出证据 |
|---|---|---|---|
| 0R | 接管对账与本地门禁收口 | 修订权威文档；关闭 M72 视频脚本路径；完成 M77/M78 owner Select；探测 Provider/渲染/FFmpeg/存储能力 | 当前计划 accepted；桌面与 390px 通过；完整测试/build 通过；能力基线有真实证据 |
| 1A | 执行身份与租约 | 后台 actor fail-closed；ProjectExecutionLease；fencingToken；获取、续租、释放 | 同项目只有一个写者；不同项目可并发；旧 fence 不能提交；停用用户任务被拒 |
| 1B | 输入代际与幂等恢复 | IntentEpoch；RunInputSnapshot；inputHash；GenerationJob idempotencyKey、providerTaskId、pollState | 同 key 同 hash 复用；异 hash 冲突；旧 epoch 拒绝；有 taskId 只 poll |
| 1C | 原子提交与隔离 | staging、validate、fenced commit、quarantine；Artifact/Node/Job 原子提升 | 迟到结果不可见；半成功可对账；PPT/图片/视频入口统一受控 |
| 2 | 合同、质量与受控 ReAct | pre/post contract；ValidationReport；CriticReport；QualityDecision；locator；预算；影响分析 | 硬门不可被模型覆盖；可暂停、改道、局部返修；预算耗尽后暂停 |
| 3 | PPT Quality | 教材证据、叙事大纲、视觉系统、PageSpec、样张、资产、PPTX、render、页级返修 | 至少一套真实 12 页 PPTX；多格式页数一致；批准资产嵌入；单页返修 |
| 4 | 视频 Full Intro | 课程锚点、独立创意、Beat、ShotSpec、视频资产、逐镜头 job、音字后期、FFmpeg | 镜头可独立恢复/批准；参考资产实传；ffprobe 与时间线一致；单镜头返修 |
| 5 | 整堂课与最终包 | ClassroomRunSpec；跨产物一致性；FinalDeliveryGate；反向生成 manifest/ZIP | 只收录 current final_eligible；ZIP、manifest、hash、目录和数据库一致 |
| 6 | 真实验收与邀请上线 | 三个任务、故障注入、成本与耗时、服务器恢复、教师演练 | 三套真实交付；P0=0；至少一名教师签收；发布门全部关闭 |

阶段 3 与阶段 4 可在阶段 2 的共享合同、执行身份、版本语义和 locator 冻结后并行；热点文件和数据库 schema 必须由单一集成人控制。

## 6. 关键业务状态

| 状态 | 含义 | 可进入最终包 |
|---|---|---|
| `staging` | 已产生文件或 Provider 结果，尚未完成校验和 fenced commit | 否 |
| `preview_only` | 可供教师查看，但生产路径或质量不足 | 否 |
| `final_candidate` | 已完成生产和审查，等待确定性决策或批准 | 否 |
| `final_eligible` | 硬门通过、版本当前有效、批准范围匹配 | 是 |
| `stale` | 上游或教师意图变化，保留历史但不再有效 | 否 |
| `quarantined` | 迟到、失租约、输入不一致、actor 失效或提交未知 | 否 |
| `partial/degraded` | 可导出的中间成果或降级成果 | 否 |

## 7. 实施原则

- 测试定义早于对应代码实施；每个阶段另建 plan/test-plan/closeout 或在本计划明确的阶段切片下维护等价证据。
- Provider 长调用期间不持有数据库事务；通过租约、心跳、taskId 和 fenced commit 控制。
- HumanGate actionId 不能直接充当 Provider 幂等键。
- Provider 已接受请求但 taskId 未可靠保存时进入 `submission_unknown`，对账前不得自动重提。
- Critic 不判定 slideCount、文件结构、ffprobe、hash、参考图是否实传或血缘是否当前。
- 修改上游后保留历史版本，但旧下游退出当前有效集；默认按 pageId、assetId、shotId 或 track 定点返修。
- 真实 API、Provider、服务器和教师演练产生的证据必须脱敏；密钥不得进入文档、日志、截图或提交。

## 8. 试点与质量指标

固定三个递增任务：低年级数概念、中年级几何/测量、高年级百分数/分数。至少一个任务产出 12 页真实 PPTX。

记录：

- 首次可授课率；
- 人工修改时间；
- 页级/镜头级返修次数；
- 全链耗时和 Provider 等待时间；
- 单任务成本和重复付费次数；
- Provider 失败率与恢复成功率；
- 教师签收结论和 P0/P1 问题。

## 9. 上线判定

以下任一项未通过，V1 只能保持工程候选或内部演示态：

1. 真实 PPTX、图片、视频和最终包未完成端到端。
2. M72/M77/M78 浏览器门未关闭。
3. 同项目并发、旧 worker、输入改版或 Provider 中断可造成脏提交或重复计费。
4. 最终包可混入 stale、preview、degraded、缺失或错版本产物。
5. 目标服务器共享卷重启、release 回滚、备份恢复或公开注册关闭未复核。
6. 三个真实任务未完成、P0 不为 0，或没有真实教师签收。

最终邀请制发布使用新的不可变发布标识；现有 `v1` 标签保留为 2026-07-11 工程候选历史点。

## 10. 当前动作

Stage 0R、1A、1B、1C、2A/2B/2C、高年级《百分数的意义》与低年级《1～5 的认识》两套真实 PPT Quality、视频、版本一致最终包，以及本机 M67/全量质量门均已有 closeout 证据。当前 Stage 6 继续生产中年级几何/测量最后一套真实 PPTX、MP4 和最终 ZIP；随后执行故障注入、目标服务器恢复、公开注册关闭复核和真实教师签收。两套课程的集成批准均不得冒充真实教师签收。
