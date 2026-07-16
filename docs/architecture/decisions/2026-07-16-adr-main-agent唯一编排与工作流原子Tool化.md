# ADR：Main Agent唯一编排与工作流原子Tool化

日期：2026-07-16
状态：accepted

## 背景

当前产品已经具备原生function-call、Observation、ReAct、ExecutionEnvelope、原子提交、流式事件和assistant-ui骨架，但生产层仍混有多套历史控制设计：

- 宏节点、固定阶段和approve后自动推进；
- 服务端Capability Planner、`toolPlan`和`deliveryPlan`；
- Main Agent原生function-call循环；
- Adapter、Director、Critic中的隐式下一步和重试责任；
- 重复失败默认`ask_teacher`；
- 前端固定阶段和大节点终态投影。

这些路径让多个组件同时拥有Tool选择、下一步、重试或停止权。模型虽被称为Main Agent，却无法完整保留教师目标并根据具体Observation自主调整行动。

## 决策

### 1. 唯一编排者

产品Main Agent是业务Tool选择、下一步、Observation、Replan、重试和停止的唯一编排者。生产控制循环统一为：

```text
TaskBrief
-> Main Agent function call
-> ToolExecutionGateway
-> 原子Tool执行
-> 原子提交ValidationReport / Observation / Artifact / Event
-> 同一Main Agent继续判断
```

Runner、兼容层、Capability Planner、`toolPlan`、`deliveryPlan`、Adapter、Skill、Director、Critic、Artifact approve路由和assistant-ui均不得再次选择或执行下一业务Tool。

### 2. 工作流能力拆分

旧工作流不再作为生产控制器。仍有价值的内容拆为：

- 可独立发现、执行、校验和恢复的原子高层业务Tool；
- 只增强当前Tool的业务Skill；
- 决定结果能否成为可信Observation或Artifact的质量规则。

工作流模板只可作为Main Agent参考策略、迁移证据或展示投影，不得隐藏固定依赖链、下一步或整任务完成条件。

### 3. 服务端责任

服务端只拥有确定性守门责任：身份与任务隔离、TaskBrief和Intent版本核验、授权、预算、费用、副作用、ExecutionEnvelope、幂等、Provider提交状态、真实性、血缘、原子提交和恢复。

服务端不得因缺少上游Artifact隐藏能够创建第一个Artifact的Tool，不得强制下一Tool，不得把重复失败转换为例行HumanGate。

### 4. 统一合同

- `TaskBrief`：任务目标、请求产物、输入、约束、排除项、强度和计划语义真源。
- `ExecutionEnvelope`：所有执行型Tool进入Executor前的强制合同。
- `Observation`：成功、失败、reasonCode、finding、Artifact引用和恢复入口的模型输入事实。
- `MessagePart`与`AgentEventEnvelope`：assistant-ui唯一消息和事件边界。
- `Artifact`：绑定task、IntentEpoch、版本、调用和真实性证据的不可变业务事实。

### 5. 前端投影

assistant-ui按同一turn实时投影自然文本、Tool、Observation、失败位置、Artifact和恢复状态。固定宏阶段和大节点终态不得替代真实轨迹，前端不得从正文关键词推断业务状态。

### 6. DialogueCheckpoint

增加由 Main Agent 自主调用的 `request_teacher_decision` 控制 Tool。它只在存在会实质改变结果的语义边界时创建持久化 `DialogueCheckpoint` 并暂停同一 ReAct；不按固定节点触发，不授予任何风险权限，也不进入 `HumanGate`。教师自然语言回答后，从冻结的 TaskBrief、IntentEpoch、plan revision 和 checkpoint 恢复。

所有可见步骤携带教师安全的目的、输入依据、预期输出、开始时间、真实耗时和 Observation 摘要。同一失败只投影一次，并只保留一个恢复入口。

## 控制权矩阵

| 决策 | Main Agent | 服务端Guard/Gateway | Tool/Adapter/Skill | assistant-ui |
|---|---|---|---|---|
| 选择业务Tool | 唯一负责 | 只过滤不合格调用 | 不负责 | 不负责 |
| 决定下一步/重试/停止 | 唯一负责 | 只执行硬预算和风险阻断 | 不负责 | 不负责 |
| 权限、费用、副作用 | 读取结果 | 唯一硬门 | 声明事实 | 展示HumanGate |
| 执行动作 | 发起调用 | 校验Envelope | 只执行当前Tool | 不负责 |
| 提升Artifact | 不能直接提升 | 按真实性合同原子提交 | 返回候选结果 | 只投影 |
| 任务状态 | 提议行动 | 持久化有效状态 | 不负责 | 只投影 |

## 不采用的方案

- 不设计新的固定DAG或SubworkflowExecutor取得业务编排权。
- 不保留原生ReAct和外层`toolPlan`两套控制面并行运行。
- 不用Prompt要求模型服从固定流程来掩盖服务端双重编排。
- 不把LangChain、LangGraph、OpenAI Agents SDK或业务Skill升级为第二编排者。
- 不用deterministic、placeholder或degraded fallback维持旧成功率。

## 迁移

1. 先用六组P1特征测试定位所有旧控制权。
2. 贯通TaskBrief、IntentEpoch、ExecutionEnvelope和跨轮语义快照。
3. 将高层业务能力整理为原子Tool合同。
4. 收敛为单一原生function-call + Observation + ReAct循环。
5. 先提交暂停/改道和Tool结果，再继续模型决策。
6. 统一MessagePart、AgentEventEnvelope和assistant-ui步骤投影。
7. 删除forced-next-tool、重复失败默认`ask_teacher`、approve自动推进、现场拼包和fallback成功路径。

旧路径只有在消费者、测试和运行时引用均为0后才删除。迁移中不得以兼容层重新实现第二编排者。

## 后果

- Main Agent获得完整的任务适应能力，局部任务不再被固定扩张为整包。
- Tool合同和服务端守门更严格，旧测试中依赖固定顺序或默认推进的断言必须删除。
- 前端需要从宏阶段展示转为事件流投影。
- 真实交付物全链路必须等重构仓内门关闭后重新规划，旧V1-9计划不能复用。

## 验证

- 六组P1先红后绿，不断言固定Tool顺序。
- 静态和运行时证据证明只有一个组件拥有Tool选择、下一步、重试和停止权。
- 明确交付任务首轮可发现创建第一个产物的合格Tool。
- Tool结果先原子持久化Observation，再返回同一Main Agent。
- 暂停、无pending plan改道、迟到结果和两用户隔离通过。
- assistant-ui桌面真实文本交互显示步骤、失败和恢复；V1前不跑390px。
- TypeScript、生产构建、定向测试、控制面扩大回归和`git diff --check`通过。

## 回退

实施开始前，可以恢复本次权威切换快照并停止重构。实施开始后，回退只能按迁移切片撤销新接线；不得恢复已证明会形成第二编排者、越权提升Artifact或伪成功的旧生产路径。
