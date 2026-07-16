# 对话交互需求：确认、改道与自由输入

更新时间：2026-07-10

## 1. 背景

当前工作台会给教师推荐下一步操作，例如“确认开始”。但真实教师经常不会点击推荐按钮，而是直接输入：

```text
直接开始做视频。
```

当前系统会因为没有收到按钮传入的 `confirmedActionId`，回复：

```text
我还没有拿到这一步的有效确认，请先确认当前待执行任务后再继续。
```

这不是单纯文案问题，而是对话确认模型过窄：系统只承认按钮确认，不承认自然语言确认、改道和继续执行意图。更完整的助手承诺、ActionOffer、计划生命周期和失败隔离要求见 `docs\product\conversation-commitment-execution-consistency-requirements.md`。

## 2. 产品目标

教师可以通过自然语言完成三类动作：

1. 确认当前推荐计划。
2. 改道到另一个能力，例如从 PPT 改为视频。
3. 请求继续执行某个可继续节点。
4. 对助手已经承诺的可执行选项做自然语言选择。
5. 在多分支不明确时，只回答一次具体消歧问题，而不是重新走完整需求收集。

系统必须保留 HumanGate / PlanGuard / Quality Gate，自然语言不能绕过 ActionPolicy、预算、权限或质量门。明确的完整任务可以通过已披露且版本绑定的 `IntentGrant` 授权标准预算内的真实生成和文件制作，不为每个内部 Tool 重复确认；超出授权、外发、权限变化或破坏性动作仍必须进入 HumanGate。

## 3. 目标行为

### 3.1 自然语言确认当前计划

用户输入：

```text
直接开始。
就按这个做。
确认开始。
开始生成。
```

如果存在 active plan，且用户语义与计划一致，系统应识别为继续当前任务。“继续”不能新建空需求，也不能覆盖 `TaskBrief`。任务级 `IntentGrant` 已覆盖且处于已披露标准预算内的动作可以继续；超预算、最高强度、范围扩张或外部副作用必须创建唯一 `PendingDecision`，不能由模糊“继续”扩大授权。

### 3.2 自然语言改道

用户输入：

```text
直接开始做视频。
先不要做 PPT，先做导入视频。
先生成分镜。
先做视频脚本。
```

系统应判断用户想切换到哪个能力，并检查前置材料。不得机械回复“没有有效确认”。

### 3.3 前置材料不足

当用户想做视频但缺少前置材料时，应回复教师可理解的缺口：

```text
可以做导入视频。现在还缺少视频主题、脚本、分镜和资产图，我会先补齐这些内部前置，再进入真实生成；如果预计超出本任务已经说明的积分范围，我会在产生额外消耗前单独询问你。
```

### 3.4 前置材料充足且进入真实生成

当材料充足且下一步属于教师已明确请求的交付范围，并处于已披露、版本绑定的标准预算内时，系统应自动继续；只有超出授权时才请求 HumanGate：

```text
材料已经齐全，我会按当前脚本、分镜和资产继续制作视频。如果预计超出本任务已经说明的积分范围，我会在产生额外消耗前单独询问你。
```

## 4. 非目标

- 不取消 HumanGate。
- 不允许模型直接调用 provider。
- 不允许缺前置产物时直接生成视频。
- 不把“自然语言确认”扩展为任意高风险动作授权。

## 5. 建议实现

新增后端解析层：

```text
src\server\conversation\conversation-control-resolver.ts
```

输入：

```ts
{
  userMessage: string;
  pendingPlan?: PendingDeliveryPlanSnapshot | null;
  capabilityAvailability: CapabilityAvailabilityEntry[];
  agentWorldState: AgentWorldState;
}
```

唯一 resolver 输出统一为 `ConversationControlDecision`；PendingAction 是唯一持久化计划状态源。最小示意：

```ts
{
  decisionId: string;
  teacherMessageId: string;
  pendingActionId?: string;
  matchedPlanVersion?: number;
  matchedIntentFingerprint?: string;
  resolverSource: "model" | "deterministic_fallback";
  resolverVersion: string;
  reasonCode: string;
  kind:
    | "confirm_active_offer"
    | "switch_to_capability"
    | "clarify_offer"
    | "cancel_active_offer"
    | "revise_active_offer"
    | "ordinary_message";
}
```

接入点：`ConversationTurnService` 在 PlanGuard 前先处理自然语言确认和改道。

实现不能只扩充 `isShortConfirmation(...)` 正则；必须同时校验 active ActionOffer、计划版本、能力、意图指纹和 HumanGate 状态。

## 6. 验收用例

| 用户输入 | 当前状态 | 期望 |
|---|---|---|
| `直接开始做视频。` | 视频前置不足 | 不出现“没有有效确认”，明确说明缺少视频前置材料 |
| `确认开始。` | 有 pending plan | 等价确认当前计划 |
| `先不要做 PPT，先做导入视频。` | 当前推荐 PPT | 识别为改道，检查视频能力可用性 |
| `直接生成最终视频。` | 缺片段/资产 | 阻断真实生成，说明缺少哪些材料 |
| `可以调用生成服务。` | 已有完整任务且标准预算已披露并授权 | 继续当前任务，不逐Tool确认 |
| `可以调用生成服务。` | 无预算披露、超预算或范围扩张 | 创建唯一PendingDecision，确认前零付费调用 |
| `我让你接着做啊？` | 唯一低副作用 active 计划 | 识别上下文省略，继续当前计划 |
| `我让你接着做啊？` | 唯一active任务且IntentGrant覆盖真实生成 | 保留TaskBrief并继续；超出授权才要求HumanGate |
| `接着做` | 同时存在视频/PPT候选且无唯一选择 | 只追问“继续视频还是改做 PPT” |
| 点击推荐后实质修改文本 | actionId 对应旧意图 | 旧 actionId 失效，重新规划或改道 |

## 7. 当前制作计划

对应需求：`RQ-028 当前制作计划`。

该需求已接受方向，但明确延期到 V1-10 验收与发布收口通过后实施，不插入当前 V1 主线。

目标交互：Main Agent 判断任务需要多阶段持续执行后，将经 PlanGuard 校验的当前有效计划挂载在对话输入框正上方。同一计划具有“计划视图”和“进度视图”：开始和发生实质 Replan 时按步骤逐行展示完整规划，进入稳定执行与收尾时可切换为紧凑分段进度；教师在任一视图下仍可直接输入自然语言暂停、继续、补充、改道或局部返修。

```text
聊天内容区
  ↓
当前制作计划（项目级、可折叠、实时更新）
  ↓
消息输入框（始终可用）
```

接入原则：

- 当前计划是产品内部 Agent Plan 的教师可见投影，不是独立的前端 Todo，也不是固定线性 DAG。
- 现有消息内 `DeliveryPlanCard` 可保留为历史计划快照；当前有效计划提升为工作台级 `activePlan`，由 Snapshot 返回。
- `activePlan` 必须绑定 projectId、IntentEpoch、planId 和 revision；自然语言改道后旧 revision 退出活动状态，新 revision 替换挂载。
- Tool、Observation、Quality Gate、HumanGate 和 Artifact 的真实状态驱动步骤变化，不使用前端定时器伪造进度。
- 用户只看到教师可理解的业务活动，不展示模型思维链、Prompt、Provider、API、路径、密钥或调试字段。
- UI 位置固定在 `ConversationWorkbench` 的 ScrollArea 与 `PromptComposer` 之间；新增独立 Dock/Plan 组件，不把计划状态管理塞入输入框组件。

双视图规则：

1. `plan` 计划视图：逐行显示计划名称、业务步骤、每步状态、当前处理项、等待确认和阻塞原因，用于新计划理解、确认和 Replan 审查。
2. `progress` 进度视图：紧凑显示计划名称、真实已耗时、当前活动、分段进度轨和总体状态，用于稳定执行和收尾阶段持续挂载。
3. 两种视图读取同一 `activePlan` 和 revision，只改变信息密度，不改变计划、步骤状态、执行顺序或授权状态。
4. 新计划、实质 Replan、HumanGate 等待、失败或阻塞时自动展开计划视图一次；进入稳定执行或收尾后，只有教师未手动选择视图时才可自动收起。手动选择在当前 revision 内优先。
5. 状态色固定为：完成绿色、进行中蓝色、未开始浅灰、等待确认琥珀、失败红色；同时提供文字、图标和 ARIA 状态，不能只靠颜色。
6. 分段只对应教师可理解的业务里程碑。Tool、Observation、Critic 调用可以驱动状态，但不逐个暴露为分段；步骤过多时按父级里程碑聚合。
7. 已耗时来自真实时间戳；预计剩余时间只有在存在可信统计时才显示并明确标注“预计”，不得伪造倒计时或模型猜测时长。
8. 完成态全部有效分段转为绿色，标题显示“已完成”，提供最终成果入口并退出活动计划；被取消或 supersede 的步骤不伪装成完成。

实施顺序：

1. 服务端从持久化计划 metadata 解析唯一当前 `activePlan`，并加入项目 Snapshot。
2. 前端 mapper 与 controller 接收并轮询更新 `activePlan`。
3. 工作台挂载双视图计划面板，保留输入框随时打断能力，并实现教师手动切换偏好。
4. 接入 Replan revision、HumanGate、失败、收尾完成和局部返修状态，定义自动切换优先级。
5. 完成桌面与 390px 两种视图、状态语义和切换行为的真实浏览器验收。
