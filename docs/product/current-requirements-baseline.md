# ShanHaiEdu 当前需求与质量门禁基线

更新时间：2026-07-17

> 本文只定义产品不变量和验收边界。当前阶段、运行身份、测试计数和阻塞状态以主线与阶段文档为准。

## 1. 产品目标

- ShanHaiEdu面向教师完成真实备课交付，不是固定线性流水线、逐节点审批台或mock展示页。
- ShanHaiEdu本质是一个由Main Agent持续思考和行动的智能体产品；工作流只可拆解为原子Tool、Tool级Skill和质量规则，不能成为生产控制器。
- 教师可以从一句话、已有材料、局部任务或失败恢复入口切入，并能自然语言暂停、改道、补充和定点返修。
- 系统交付结构化教案、逐页PPT设计、真实可编辑PPTX、课堂视觉、独立创意导入短片、`ClassroomRunSpec`和版本一致材料包。
- 已有可信产物必须复用；缺少硬前置时只补最小必要输入，不强制从头执行完整DAG。

## 2. 单一控制面

- 产品 Main Agent 是业务Tool选择、下一步、Observation、Replan、重试和停止的唯一编排者。
- 原生function-call、Observation和ReAct是唯一生产业务控制循环；外层`toolPlan`、`deliveryPlan`、宏节点和阶段模板不得再次选择、执行或强制下一Tool。
- 明确交付任务首轮必须能发现创建第一个可信产物所需的合格高层Tool；不得把“尚未有上游Artifact”误判为“不能创建第一个Artifact”。
- 服务端Guard、Adapter和Repository负责授权、费用、副作用、幂等、真实Provider、文件验真和状态提升，不替Main Agent固定下一Tool。
- Runner、assistant-ui、兼容层、Director、Critic、业务Skill和外部Codex均不得拥有第二编排权。
- Director和Critic只在存在对应可信审查目标时暴露；它们返回审查Observation，不成为机械必经节点。
- 每次Tool结果必须先原子持久化调用、校验、Observation、事件和允许的Artifact，再由同一Main Agent决定继续、修输入、换Tool、Replan或暂停。

## 3. 任务、授权与执行合同

- 明确交付任务必须形成完整、版本绑定的 `TaskBrief`，保留目标、教材、约束、排除项、请求产物、强度和结构化输入。
- `IntentGrant`绑定已披露的预算版本、授权范围和副作用边界；`IntentEpoch`与计划revision必须单调，改道后迟到旧结果不能提升。
- 所有可执行Tool必须通过有效 `ExecutionEnvelope`，核验actor、project、task、TaskBrief digest、IntentEpoch、plan revision、强度、授权、action digest和幂等键。
- 标准任务范围内的可逆内部工作零例行确认。Main Agent 仍可在多个合理理解会实质改变结果、且现有上下文无法消除边界时，自主发起一次 `DialogueCheckpoint` 请求教师判断；是否发起由 Main Agent 基于语义决定，不按固定节点、正则或产物状态触发。
- `DialogueCheckpoint` 只负责理解校准、方向选择和成果审阅；缺少有效授权或预算，或涉及外发、权限变化、覆盖删除和其他破坏性副作用时才进入 `HumanGate`。两者不得互相冒充。
- 同一Tool同原因重复失败达到预算后诚实暂停并保存恢复入口，不循环，不默认 `ask_teacher`，不生成fallback成果。

## 4. 消息与教师体验

- `assistant-ui`是教师对话区唯一目标UI Runtime；项目自有 `MessagePart` 和 `AgentEventEnvelope` 是数据库与API合同。
- 教师界面按同一turn的自然文本、Tool、Observation、失败位置、Artifact和恢复状态实时投影；每个可见步骤至少说明真实目的、已知输入依据、预期输出、当前状态和真实耗时，不得用固定宏阶段或大节点终态替代真实轨迹。
- 无正文可流式输出且尚无已持久化活动事实时，只显示中性等待文案和真实耗时。只有对应事件已经持久化后，才可显示请求已开始、Tool已开始或Observation已收到；不得预告“正在理解”“正在选择下一步”等尚未发生的动作，也不得显示模拟百分比、虚构阶段、思维链、函数参数或后台调试信息。
- 同一失败只在具体失败步骤呈现一次，并只保留一个恢复入口；不得把一次失败重复为顶部状态、泛化失败节点、Tool状态和多张恢复卡。
- 前端只投影服务端线程、计划、Tool状态、Artifact引用、HumanGate和错误恢复，不从正文关键词猜测业务状态。
- 控制消息必须先持久化暂停、取消或改道，再允许任何Tool继续；有无pending plan都遵守同一顺序。
- 教师界面不得出现schema、provider、node_id、storage、debug、local path、token或内部推理。
- 成果数量、页码、镜头、版本、费用和质量状态必须来自真实持久事实；未达标必须显示原因和恢复动作。

## 5. Artifact与质量真值

- mock、placeholder、deterministic draft、文本fallback、degraded输出和未验证文件不得标为生产成功。
- 模型来源、执行器来源、输入血缘、Artifact版本、摘要、内部质量、下游可用和教师签收是不同事实。
- 没有正式持久化package asset时最终包失败关闭；不得从最新版、未批准版、不同任务、不同IntentEpoch或临时路径现场拼装ZIP。
- 失败返修只影响被finding定位的页面、镜头或版本；未受影响Artifact不得重生成。

## 6. 教案与PPT门禁

- 教案必须包含课程目标、教材依据、学情、重点难点、教学流程、师生活动、板书、评价、风险和可供下游消费的结构字段。
- PPT设计必须逐页描述底图、元素、文字、排版、教学动作和视觉重点，不能用页码范围合并代替逐页设计。
- 结构化设计候选与生产设计包是不同合同；缺少正式生产设计包时不得进入真实图片、PPTX或整包成功态。
- 可编辑PPTX必须是有效Open XML包，包含真实slide文件；实际slideCount必须与TaskBrief目标一致。

## 7. 视频与课程锚点门禁

- 视频先作为脱离教材仍成立的独立创意短片，再以唯一最小课程锚点回接课程任务。
- 课程锚点不是全片知识中心，不要求儿童、教师、教室、课堂活动或机械百分比位置，也不能提前泄露答案。
- 只做视频脚本不得被系统固定扩张为教案、PPT、图片、成片或整包。
- 真实视频生产前必须有主题、脚本、资产、分镜、镜头时长、动作、声音或字幕和边界约束。
- 完整导入短片为30至90秒；成片必须通过文件结构、完整解码、音轨、字幕、时间线和采样帧验证。
- 课程锚点审查、成片内审和最终包外部验收是三道独立门，证据不得互相替代。

## 8. Skill、Provider与费用边界

- 现行业务Skill权威源为集合根既有 `shanhaiedu-技能系统`；运行时projection只是一次运行冻结投影。
- Skill只能增强Main Agent当前选择的高层业务Tool，不能规划、批准、返修、重试或停止整个任务。
- 工作流模板和Skill可以为当前Tool提供业务策略与质量规范，但不得携带隐藏的下一步、固定依赖链或整任务完成条件。
- Main Agent只调用高层业务Tool，不选择裸Provider。Provider配置、模型、凭据和能力以API台账与运行时Binding Policy为准。
- V1图片生产使用台账绑定的MiniMax通道，不允许静默切换free或其他fallback通道。
- 没有有效费用披露版本时付费调用为0；预算升级必须是类型化HumanGate并原子更新授权。

## 9. 多用户、安全与恢复

- 同一项目同时只有一个有效写者和一条有效生成主线；不同用户、项目、TaskBrief、预算、强度、Artifact和恢复状态必须隔离。
- Provider请求提交、submission_unknown、重试、checkpoint和恢复均需持久化，避免重复调用和重复扣费。
- 数据库、对象、权限、签名URL、密钥和内部路径不向教师界面泄露。
- 运行开始后合同与摘要冻结；实质升级必须终止旧运行并创建显式后继，不能在同一run静默换规则。

## 10. 验收分层

所有结论必须归入：

```text
contract / executor / model orchestration / product E2E / release
```

fixture和单元测试只能证明仓内合同；真实模型调用、真实可编辑文件、完整产品链路、教师签收和发布分别需要独立证据。V1发布前真实浏览器门使用桌面视口；390px不作为V1前置条件，除非用户明确要求。
