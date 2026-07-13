# ShanHaiEdu V1 上线前主线微调与接管计划

更新时间：2026-07-13

状态：`Accepted / V1-1 to V1-4 done / V1-5 next`

## 1. 目标

在保留现有执行安全、合同、质量、PPT、视频和最终包实现的基础上，把V1最后阶段从“由外部Codex继续制作更多验收包”调整为“证明产品内部Main Agent能够自主编排，并支持两名受邀教师同时使用”。

V1上线目标：两名教师可以同时登录、操作不同项目并提交完整备课任务；项目、对话、强度、任务和产物严格隔离；Main Agent能够执行有界`Observe -> Plan -> Guard -> Act -> Observe -> Replan`，通过注册工具、HumanGate和Quality Gate完成真实交付。

## 2. 当前基线

- 执行身份、项目租约、fencing、IntentEpoch、幂等、Provider任务恢复和原子提升已实现并有自动化证据。
- Node Contract、ValidationReport、CriticReport、QualityDecision、Observation持久化和finish证据底座已实现；这不等于Main Agent已经能在同一轮依据Observation继续Replan。
- PPT生产方法和真实12页可编辑PPTX已形成有效金样。
- 低年级PPT、图片、视频和最终包技术链路已有真实证据，但视频独立创意与课程锚点失败，整包只能作为工艺、Provider和负例证据。
- 此前真实交付主要由产品外部Codex编排，不能证明产品Main Agent已经具备同等规划与返修能力。
- 当前Main Agent运行配置为`gpt-5.6-terra + high`；RQ-027目标态为四档生成强度，默认标准档映射Terra Medium。

## 3. 职责边界

| 能力 | 产品Main Agent/系统 | 外部Codex |
|---|---|---|
| 理解意图、选择下一能力、形成与修订计划 | 必须负责 | 不得在验收中代做 |
| 读取Observation并决定Replan/返修范围 | Main Agent与专业Agent Tool | 只实现合同和接线 |
| HumanGate批准 | 真实教师 | 不得模拟成真实签收 |
| 文件、页数、hash、ffprobe、版本与血缘 | 确定性Validator/Guard | 实现和验证 |
| PPT/视频语义与效果审查 | 专业Critic Agent Tool | 实现Rubric与接线 |
| Provider调用与持久化 | 注册Tool、Adapter、Job和Repository | 实现基础设施 |
| 发布结论 | Release Gate与真实用户证据 | 汇总证据，不越权批准 |

产品内编排验收期间，禁止用外部脚本手工选择节点、批准样张、决定返修页/镜头或生成完整包后宣称Main Agent已完成。

外部Codex在本主线中降为工程实施者和阶段末黑盒验收者：前段只实现、接线、注入测试条件和读取证据，不替Main Agent规划生产路径或替Critic作质量决定；收尾时只审核产品内部智能体独立生成的最终包，定位链路缺陷并提出下一轮系统优化。若Main Agent协调失败，先从WorldState、上下文、Tool可发现性与合同、Observation质量、Prompt、Rubric、预算和停止条件中定位原因，再修改对应责任层，禁止由外部Codex接管任务来掩盖缺陷。

### 3.1 课程锚点硬定义

- 课程锚点只负责把已经成立的独立短片回接到本课学习任务，通常是唯一的触发事件、课堂第一问、未解释的冲突或交接瞬间。
- 课程锚点不是教材摘要、PPT叙事、课堂活动脚本，也不要求出现教师、学生、教室、黑板或同龄儿童。
- “适合小学生理解和观看”是可理解性、安全性与节奏约束，不是故事世界、人物年龄或场景约束。
- Video Creative Director必须先提出机制不同的独立创意候选；产品内独立`delivery_critic.review`必须在`course_anchor`阶段阻塞教材动画化、PPT动态版和全程课堂化方案，并在`video_final_review`阶段检查真实成片是否发生创意或锚点漂移。
- Main Agent负责根据CriticReport执行Replan或请求HumanGate；外部Codex不得替它选案、批准锚点或决定返修镜头。

### 3.2 课程锚点审查归属

- `video_director.plan_or_repair`负责提出与修订创意，不得用自己的三问自评批准自己的输出。
- `delivery_critic.review(domain="video", stage="course_anchor")`是课程锚点的独立权威Critic Agent Tool；报告必须绑定projectId、IntentEpoch、创意版本digest、rubricVersion、generatorInvocationId和criticInvocationId。
- Critic固定检查：脱离教材仍可理解、去掉课程回接仍有观看价值、不是教材/PPT复刻、只有一个最小课程锚点、受众年龄没有变成故事世界限制、不提前泄露答案。
- 失败或证据不足必须保留`responsibleStage`、typed locator、minimal fix和禁止调用的下游Tool，形成Main Agent可消费的结构化Observation；不得只返回“请重新确认任务”的通用失败文案。
- 儿童主角可以因独立创意需要而出现。教室仅在最终回接是明确正例但不是唯一允许情形；若教室服务于独立叙事且不依赖课堂教学，也可以通过。禁止的是把“小学生受众”推导成儿童主角、教师、教室或课堂活动的必需条件。

### 3.3 成片后二次产品内审查

- Provider前`course_anchor`审查判断创意和回接方案是否允许进入昂贵媒体生产；它不能证明Provider实际生成的成片仍忠于方案。
- 组装后`delivery_critic.review(domain="video", stage="video_final_review")`必须读取实际MP4、字幕或转写、采样帧、音轨和时间线证据，复核六硬门、连续性、字幕、音频和技术效果。
- finding必须定位到`shotId`、时间范围、字幕或音轨片段，并给出上游责任阶段和最小修复；Main Agent依据Observation定点重做镜头、字幕、音轨或时间线，不允许外部Codex代做返修决策。
- V1-7用确定性媒体夹具和历史证据验证合同与编排，V1-9才对产品Main Agent真实生成的MP4执行这道门；外部成包后黑盒审核不能替代产品内成片审查。

## 4. Tool注册边界

Main Agent只接触业务语义稳定、输入输出可审计的高层能力：

- `ppt_director.plan_or_repair`
- `video_director.plan_or_repair`
- `delivery_critic.review`
- `generate_ppt_sample_assets`
- `assemble_ppt_key_samples`
- `generate_ppt_full_assets`
- `assemble_ppt_full_deck`
- `repair_ppt_full_deck_pages`
- `generate_video_assets`
- `generate_video_shot`
- `assemble_video`
- `create_final_package`

Main Agent不得直接接触密钥、Provider URL、数据库写入、Artifact状态提升、`final_eligible`设置或绕过Validator的能力。Validator、PlanGuard、HumanGate、DataRightsGuard和FinalDeliveryGate由系统强制执行，不作为模型可自由选择的工具。

## 5. 分阶段实施

| 阶段 | 目标 | 核心动作 | 退出证据 |
|---|---|---|---|
| V1-0 | 主线微调封板 | 冻结两用户、产品内编排、四档强度与非目标；提交并打接管标签 | 权威计划、测试计划、backlog和主线状态一致 |
| V1-1 | 编排归因审计 | 逐节点标记Main Agent、固定代码、Tool、外部Codex和人工决策归属 | `done`：见V1-1审计与closeout |
| V1-2 | Tool与Agent Tool注册 | Registry、调用信封、Router、独立Critic、结构化返修、默认授权、Executor结果字段封闭与签名目标绑定已经封板 | `done`：见V1-2 closeout；三个Agent Tool仍不接生产Executor |
| V1-3 | Main Agent受控ReAct | 统一Dispatcher、OpenAI严格Schema Executor、只读Agent Tool内循环、业务Tool结果后WorldState刷新与Replan、Queue身份/fence透传及固定链显式降级已经封板 | `done`：专项197/197、全量、构建、SQLite和diff门禁通过；见V1-3 closeout |
| V1-4 | HumanGate与自然语言打断 | 按钮/自由输入统一授权、暂停恢复、取消改道、旧action防重放、IntentEpoch隔离、多计划消歧和PPT页级影响报告已经封板 | `done`：专项96/96、全量、构建、SQLite和diff门禁通过；见V1-4 closeout |
| V1-5 | 生成强度 | 实施RQ-027四档滑杆、默认标准、升级建议、积分趋势和确认 | 不暴露模型、不静默升级、Sol需要二次确认 |
| V1-6 | PPT内部编排闭环 | 复用现有金样输入，验证大纲、PageSpec、样张、全量、审查和页级返修 | 决策全部来自产品Agent/Tool；Codex不代做 |
| V1-7 | 视频内部编排闭环 | 接入Concept Selection、Director独立短片三问、`course_anchor`六硬门、最小课程锚点和`video_final_review`成片复核 | 前置反例在昂贵Provider调用前阻断；成片漂移能定位到shot/时间范围并由Main Agent定点返修 |
| V1-8 | 两用户并发 | 两账号、两项目、双Agent任务、强度隔离、排队和恢复 | 不串数据、不重复付费、不使用全局串行锁 |
| V1-9 | 产品内真实E2E | 仅在V1-1至V1-8通过后，从产品界面启动一次真实任务；外部Codex不参与编排 | 产品Main Agent自主产出真实PPTX、MP4和最终包；产品内成片审查通过；外部只读`ExternalAcceptanceReport`可追溯到具体责任层 |
| V1-10 | 发布收口 | 服务器共享卷、重启、回滚、备份恢复、注册关闭、监控和教师签收 | P0=0；两名邀请用户可用；创建新发布标识 |

V1-3已经封板共享Agent Tool执行、Report/Observation持久化和Main Agent Replan运行时。它不等于课程锚点领域闭环；真实课程锚点Critic输入、Rubric、返修决策和成片后二次复核仍在V1-7单独取证，此前不得宣称“产品内课程锚点审查闭环”。

## 6. 顺序与并行边界

```text
V1-0 -> V1-1 -> V1-2 -> V1-3 -> V1-4 -> V1-5
                                      -> V1-6 -> V1-7 -> V1-8 -> V1-9 -> V1-10
```

V1-6与V1-7只有在共享Tool合同、Observation、HumanGate和版本状态冻结后才能分工推进。热点文件、数据库schema和核心ToolRegistry保持单一集成人。

## 7. 当前不做

- 不继续由外部Codex制作第三套完整验收包。
- 不在产品内编排成立前重复调用真实图片或视频Provider做效果展示。
- 不用频繁真实电路测试替代Agent编排测试；真实Provider全链路集中到V1-9及必要的定点复验。
- 不把外部Codex的选案、锚点审查、样张批准或返修决定混入产品内能力证据。
- 不迁移LangGraph、Vercel AI SDK或其他通用Agent框架作为V1前置。
- 不把模型选择权直接交给模型文本，也不向教师暴露底层模型名。
- 不把两用户目标扩成十用户容量或复杂多租户系统。

## 8. 回退与发布标识

保留现有annotated tag `v1`与`v1.1.0-alpha`不动。`v1.1.0-alpha`只表达“V1执行安全和交付质量基线已形成，产品内编排与两用户上线阶段待实施”，不包含当前未提交的V1-1/V1-2成果。后续每阶段通过独立closeout和新提交推进，不移动历史标签。

## 9. 下一对话启动协议

新对话或新执行阶段从唯一交接文档恢复，不从旧Stage 6真实包路线继续：

1. `docs\handoffs\2026-07-13-v1-main-agent-mainline-handoff.md`
2. `docs\product\current-requirements-baseline.md`
3. `docs\mainlines\current-mainline-status.md`
4. 本计划与`local-real-v1-mainline-adjustment-test-plan.md`
5. `docs\stages\local-real-v1-v1-2-tool-agent-tool-registration-closeout.md`
6. `docs\retrospectives\2026-07-12-grade1-package-video-anchor-failure.md`

第一项开发任务已经切换为V1-5生成强度：先冻结四档映射、默认标准、升级建议、确认和积分趋势合同，再实现服务端强度快照、前端强度控件与最高档二次提醒。V1-4已完成专项96/96、全量、生产构建、SQLite连续初始化和closeout；不得重新从V1-3/V1-4候选状态起步。

V1-5期间仍不得调用真实图片/视频Provider、制作新整包、移动既有标签，也不得由外部Codex替Main Agent选择创意、批准课程锚点或决定返修范围。
