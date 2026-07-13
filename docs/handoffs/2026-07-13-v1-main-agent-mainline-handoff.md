# ShanHaiEdu V1 Main Agent 主线开发交接

更新时间：2026-07-13

状态：`V1-9R0 next / real Provider E2E paused / public cutover paused`

## 1. 交接结论

下一阶段不是让教师继续点击旧 HumanGate，也不是直接执行 V1-9 真实整包。唯一下一主线是：

```text
V1-9R Main Agent自主编排与HumanGate恢复
```

最新真实对话已经证明：Main Agent能够理解教师的“投篮命中率”目标，但完整结构化输入在内部 Tool 边界丢失；22个Capability全部逐Tool确认；执行确认与产物批准混用；业务Tool不能进入Main Agent连续ReAct；Tool成功后服务端又统一停回确认；Runtime失败会静默生成deterministic草稿。38条消息最终形成8个重复requirement spec，没有教案、PPT或视频。

因此 V1-4 重标为“底层安全合同完成 / 产品验收失败 / P0 reopen”。V1-3、V1-6、V1-7保留组件和领域合同，但重新验收产品内连续自主编排；V1-5重开强度贯穿和状态同步。V1-8、V1-9A-G、V1-10A-G的独立底座证据保留，不重新开发。

## 2. V1 最终目标

在两名受邀教师范围内，使产品 Main Agent 从一句自然语言需求建立稳定 `TaskBrief`，自主规划并连续调用 PPT、视频和最终包业务 Tool；标准授权范围内的可逆内部步骤自动推进，只在真实费用、不可逆影响、外发/权限或无法推断的用户选择处触发 HumanGate。

完成证据：本次失败对话回归通过、无重复确认、无 deterministic 成果冒充、两用户完全隔离、全量测试/构建/桌面/390px通过；产品 UI 独立生成同一版本的结构化教案、真实可编辑PPTX、课堂视觉图、30-90秒完整MP4、`ClassroomRunSpec`和manifest/hash一致ZIP；外部黑盒P0=0、候选教师签收、原子切流与切流后复核通过。

## 3. 产品与架构边界

ShanHaiEdu是面向教师、尽量顺从教师目标但受事实与真实风险边界约束的公开课制作助手。它不是固定单向流水线，也不是逐节点审批工作台。

```text
Main Agent：理解、计划、选择Tool、Observe、Replan
Director/Critic：专业规划与独立审查
ActionPolicy/Guard：权限、预算、幂等、版本和副作用
HumanGate：真实选择与真实风险
Validator/Quality Gate：交付事实与质量
```

明确请求“做一个PPT/视频/完整材料包”就是对该目标范围内、标准预算内、可逆内部动作的任务级授权。需求整理、大纲、逐页设计、样张、Critic和定点返修默认自动推进；教师明确要求“先给我看样张”时才建立该检查点。

HumanGate只保留：不可推断且实质改变结果的选择、超任务预算、最高强度、扩大交付范围、外发发布、权限变化、覆盖删除和最终发布签收。模型不能自行决定权限，但HumanGate也不能决定模型是否可以思考和完成普通工作。

## 4. 必须落地的最小合同

| 合同 | 作用 |
|---|---|
| `TaskBrief` | 保存完整目标、交付物、教材、约束、排除项、质量和IntentEpoch；控制消息不得覆盖 |
| `IntentGrant` | 保存任务级授权范围、标准费用上限、强度、外部副作用和教师要求的检查点 |
| `WorkingPlan` | 动态步骤、依赖、revision、预算和停止条件；不是固定DAG |
| `ExecutionEnvelope` | 把actor/project/task、TaskBrief digest、IntentEpoch、plan revision、强度、授权和幂等键传给Tool |
| `ToolObservation` | 保存结果/错误、artifact refs、Runtime来源、费用、可重试性和定位信息 |
| `PendingDecision` | 统一按钮和自然语言确认，绑定唯一任务、intent、plan、版本和过期条件 |

确定性验证、Critic审查、下游可用和教师签收必须分开。教师未签收不能让已通过内部质量门的草稿永久无法作为下游草稿输入；教师签收也不能替代Validator或Critic。

## 5. 执行阶段

| 阶段 | 目标 | 退出标准 | 估算 |
|---|---|---|---|
| V1-9R0 | 真实失败基线与旧测试纠偏 | 一句话PPT、继续、改道、风险门和无假fallback测试先红 | 0.5天 |
| V1-9R1 | TaskBrief/IntentGrant与输入贯穿 | Tool永远收到完整目标；改道使旧意图失效 | 0.5-1天 |
| V1-9R2 | ActionPolicy与HumanGate分级 | 内部节点零例行打断；真实风险仍阻断 | 1天 |
| V1-9R3 | 业务Tool连续ReAct | Main Agent自主完成PPT安全链并能定点返修 | 1-1.5天 |
| V1-9R4 | 真实失败与关键UI | 无假fallback；Markdown、历史成果、强度、窄屏和状态关闭 | 0.5-1天 |
| V1-9R5 | 产品黑盒与双用户回归 | 两项目并行；一句话PPT与自然语言改道全链通过 | 0.5-1天 |
| V1-9 | 唯一真实产品E2E | 完整整包、版本一致、外部黑盒P0=0 | 1-2天 |
| V1-10 | 候选签收与发布 | 教师签收、原子切流、注册关闭和生产复核 | 0.5-1天 |

V1-9R工程候选为4-6个集中开发日；两人邀请制V1总工期为6-10个自然日。Provider、外部审核或教师签收等待不计入工程工时；真实成片新增P0时增加1-2天。前两天应得到“一句话发起、无需反复确认、自动推进到可信PPT候选”的确定性候选版。

## 6. 下一执行任务

下一任务固定为V1-9R0，不先改生产代码：

1. 从真实项目提取脱敏fixture，覆盖投篮命中率、继续、确定、重复requirement spec和60秒失败。
2. 在既有conversation、control resolver、Main Agent loop、HumanGate和capability测试中先增加红测试。
3. 找出并改写把“确认开始 -> 继续下一步 -> 再继续”固化为成功的旧断言。
4. 红测试稳定后进入V1-9R1；V1-9R5通过前不执行新的真实图片、视频或整包Provider任务。

专项计划：

```text
docs\stages\local-real-v1-v1-9r-agent-autonomy-human-gate-recovery-plan.md
docs\stages\local-real-v1-v1-9r-agent-autonomy-human-gate-recovery-test-plan.md
```

## 7. 新会话读取顺序

1. `AGENTS.md`
2. `docs\README.md`
3. `docs\product\current-requirements-baseline.md`
4. `docs\product\requirements-backlog.md`中的RQ-038
5. `docs\mainlines\current-mainline-status.md`
6. V1-9R plan与test plan
7. `docs\stages\local-real-v1-v1-4-human-gate-natural-language-interruption-closeout.md`，仅作历史合同证据
8. `docs\stages\local-real-v1-v1-9g-final-package-runtime-lineage-closeout.md`
9. `docs\stages\local-real-v1-v1-10g-atomic-container-switch-closeout.md`

开始前必须重新核对`git status --short --branch`、`git log -1`和`origin/main...main`。当前工作树另有V1.1/V1.2/V1.5/V2.0需求与研究文档在途，除非另行授权，不得把它们混入V1-9R代码提交，也不得删除或回退。

## 8. 外部Codex边界

- 外部Codex负责工程实现、测试、证据审计和产品成包后的黑盒审核。
- 外部Codex不得在运行中选择样张、视频创意、课程锚点、下一Tool或返修范围，也不得模拟真实教师签收。
- Main Agent失败时，必须归因到TaskBrief、Tool可发现性、合同、Observation、ActionPolicy、Prompt、Rubric、预算或停止条件，再修对应责任层；不允许外部人工接管业务链掩盖缺陷。
- 本主线不绑定开发方法类Skill，禁止`superpowers:*`；可以使用PPT、视频、图片、浏览器和业务质量类功能性能力，但不能把外部能力结果记为产品Main Agent证据。
- V1不迁移LangGraph、Vercel AI SDK或其他Agent框架。框架选型不解决错误的授权和数据语义，待V1真实上线后再单独评估。

## 9. 禁止事项

- 不让教师“再确认一次”来绕过当前P0。
- 不通过增加更多Prompt限制压缩模型能力。
- 不将每个内部节点封装成必须人工批准的固定DAG。
- 不让deterministic、placeholder或degraded产物进入真实完成态。
- 不移动历史标签，不跳过V1-9R5直接运行真实整包或公网切流。
- 连续两轮不同排障路径仍无新证据时，记录事实、失败点、已尝试动作和恢复入口，转向不依赖该阻塞的同阶段任务，不重复等价尝试。
