# ShanHaiEdu V1 上线前主线微调与接管计划

更新时间：2026-07-13

状态：`Accepted / V1-9R next / V1-9 real E2E paused`

## 1. 目标

在保留现有执行安全、合同、质量、PPT、视频和最终包实现的基础上，把V1最后阶段从“由外部Codex继续制作更多验收包”调整为“证明产品内部Main Agent能够自主编排，并支持两名受邀教师同时使用”。

V1上线目标：两名教师可以同时登录、操作不同项目并提交完整备课任务；项目、对话、强度、任务和产物严格隔离；Main Agent能够执行有界`Observe -> Plan -> Guard -> Act -> Observe -> Replan`，通过注册工具、HumanGate和Quality Gate完成真实交付。

2026-07-13 最新真实对话验收推翻了“V1-4 HumanGate 产品体验已经完成”的结论。当前唯一下一阶段改为 `V1-9R Main Agent自主编排与HumanGate恢复`；在其确定性、浏览器和双用户门关闭前，暂停 V1-9 真实 Provider E2E 与正式公网切流。

## 2. 当前基线

- 执行身份、项目租约、fencing、IntentEpoch、幂等、Provider任务恢复和原子提升已实现并有自动化证据。
- Node Contract、ValidationReport、CriticReport、QualityDecision、Observation持久化和finish证据底座已实现；这不等于Main Agent已经能在同一轮依据Observation继续Replan。
- PPT生产方法和真实12页可编辑PPTX已形成有效金样。
- 低年级PPT、图片、视频和最终包技术链路已有真实证据，但视频独立创意与课程锚点失败，整包只能作为工艺、Provider和负例证据。
- 此前真实交付主要由产品外部Codex编排，不能证明产品Main Agent已经具备同等规划与返修能力。
- 当前Main Agent运行配置为`gpt-5.6-terra + high`；RQ-027目标态为四档生成强度，默认标准档映射Terra Medium。
- 最新真实项目38条消息连续生成8个`requirement_spec`，结构化`inputDraft`在Tool边界丢失，22个Capability全部逐Tool确认，业务Tool不能进入连续ReAct，Runtime失败还会静默形成`deterministic_draft`。这属于P0架构职责偏差，不是教师少点了一次确认。

## 3. 职责边界

| 能力 | 产品Main Agent/系统 | 外部Codex |
|---|---|---|
| 理解意图、选择下一能力、形成与修订计划 | 必须负责 | 不得在验收中代做 |
| 读取Observation并决定Replan/返修范围 | Main Agent与专业Agent Tool | 只实现合同和接线 |
| HumanGate真实决策 | 真实教师只处理不可推断选择、超授权费用/范围、最高强度、外发、权限和破坏性动作 | 不得模拟确认，也不得把内部节点升级为人工门 |
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
- Critic通过后，真实媒体调用仍须满足可信Executor、PlanGuard、任务级IntentGrant、ActionPolicy和QualityDecision；只有超出授权范围、预算或副作用边界时才创建HumanGate，不为每个镜头重复确认。

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

| 阶段 | 当前判断 | 处理方式 | 退出证据 |
|---|---|---|---|
| V1-0至V1-2 | 历史合同与审计完成 | 保留，不重做 | closeout继续作为底座证据 |
| V1-3 | 组件合同完成，产品连续ReAct未通过 | 在V1-9R3重新验收业务Tool发现、连续调用与Tool后Replan | 一句话PPT不靠固定点击推进 |
| V1-4 | 底层安全合同完成，产品验收失败，P0 reopen | 在V1-9R1/R2重做任务级授权、PendingDecision和HumanGate分级 | 标准内部节点零例行打断，真实风险仍零越权 |
| V1-5 | 强度合同完成，Runtime贯穿与UI状态P1 reopen | 在V1-9R1/R4修复强度快照与服务端权威同步 | 页面、任务快照和Runtime档位一致 |
| V1-6/V1-7 | PPT/视频领域Tool、Critic和返修合同完成 | 不重写生产工艺，在V1-9R3/R5重新验收产品内自主串联 | Main Agent独立完成PPT/视频确定性闭环 |
| V1-8 | 单进程两用户合同完成 | 在V1-9R5做受影响回归 | 两项目任务、授权、费用和产物不串线 |
| V1-9A-G | 媒体、Runtime与最终包前置硬化完成 | 保留；真实产品E2E继续暂停 | 不重做既有技术门 |
| V1-10A-G | 发布、容器、回滚恢复和Provider配置底座完成 | 保留；公网切流、注册复核和签收仍未完成 | 只做受影响回归与最终切流 |
| V1-9R0-R5 | Main Agent自主编排与HumanGate恢复 | 按专项计划依次关闭失败基线、语义授权、ActionPolicy、业务Tool loop、失败/UI和双用户门 | 专项test plan全部通过；外部Codex运行中介入0次；形成独立恢复closeout |
| V1-9 | 唯一真实产品E2E | 产品Main Agent独立生成完整整包，产品内审查，外部成包后黑盒审核 | 教案、PPTX、视觉图、完整MP4、`ClassroomRunSpec`和版本一致ZIP；P0=0 |
| V1-10 | 候选签收与发布 | 候选环境教师签收、原子切流、注册关闭与生产关键路径复核 | 至少一名教师签收；可回退切流；新不可变发布标识 |

V1-9R专项计划与测试入口：

```text
docs\stages\local-real-v1-v1-9r-agent-autonomy-human-gate-recovery-plan.md
docs\stages\local-real-v1-v1-9r-agent-autonomy-human-gate-recovery-test-plan.md
```

旧closeout不删除、不改写历史测试事实，但其“done”只说明当时合同和夹具通过。凡与最新真实产品验收冲突的产品结论，以当前基线和V1-9R为准。

## 6. 顺序与并行边界

```text
V1-9R0 -> V1-9R1 -> V1-9R2 -> V1-9R3 -> V1-9R5 -> V1-9 -> V1-10
                                      \-> V1-9R4 -/
```

TaskBrief、IntentGrant、PendingDecision、ActionPolicy和核心Tool loop保持单一集成人。关键UI修复可在V1-9R2合同冻结后并行，但V1-9R3和V1-9R4都通过才允许关闭V1-9R5；真实Provider只能在V1-9R closeout后执行，公网切流只能在V1-9真实E2E、外部审核和候选教师签收后执行。

## 7. 当前不做

- 不继续由外部Codex制作第三套完整验收包，也不让外部Codex替产品Main Agent推进节点。
- 不在V1-9R5通过前重复调用真实图片或视频Provider做效果展示。
- 不把样张、课程锚点、大纲或内部审查默认升级为HumanGate；教师明确要求暂停时才建立检查点。
- 不迁移LangGraph、Vercel AI SDK或其他通用Agent框架作为V1前置。
- 不提前实现V1.1/V1.2/V1.5的完整活动流、阶段QA、字体设置或成果工作区。
- 不向教师暴露底层模型名，不把两用户目标扩成更大容量。

## 8. 回退与发布标识

保留现有annotated tag `v1`、`v1.1.0-alpha`及其他历史标签不动。V1-9R按独立提交推进；若实现回归，只回退对应V1-9R提交，不回退已验证的V1-9A-G/V1-10A-G底座。最终邀请制发布通过后创建新的不可变发布标识。

## 9. 下一对话启动协议

新对话或新执行阶段按以下顺序恢复：

1. `docs\handoffs\2026-07-13-v1-main-agent-mainline-handoff.md`
2. `docs\product\current-requirements-baseline.md`
3. `docs\product\requirements-backlog.md`中的RQ-038
4. `docs\mainlines\current-mainline-status.md`
5. V1-9R plan与test plan
6. 本计划与总测试计划

下一项开发任务固定为V1-9R0：先把本次38条真实失败对话转成脱敏红测试，并找出所有把“逐节点继续/批准”固化成成功行为的旧断言。红测试成立前不修改控制面实现；V1-9R5通过前不运行真实整包。
