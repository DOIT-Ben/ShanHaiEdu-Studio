# 第一档：对话承诺与执行一致性需求

更新时间：2026-07-10

状态：已接受；内测反馈中心之后优先实施。

## 1. 对话证据

截图中的助手先向教师承诺：

```text
你只要回复一句：“继续做视频”或“改做PPT”，我就按对应方向重新开始，不再混用前面的失败状态。
```

教师随后回复：

```text
我让你接着做啊？
```

系统却返回：

```text
我还没有拿到这一步的有效确认，请先确认当前待执行任务后再继续。
```

这段对话表明：助手自然语言承诺、用户真实意图理解、前端确认元数据和后端执行门禁没有形成同一套合同。

## 2. 暴露的问题

### 2.1 助手承诺了系统实际上做不到的交互

助手说“回复一句就能继续”，但当前真实执行仍依赖推荐按钮附带的隐藏 `confirmedActionId`。用户按照自然语言承诺回复时，没有 actionId，最终被 PlanGuard 阻断。

要求：助手只能承诺后端当前确实支持的动作。所有“你回复 X 我就执行”的话术必须绑定真实、可执行、未过期的 action offer，不能由模型自由发挥。

### 2.2 系统依赖魔法短语，不理解上下文省略

历史系统曾在模型失败或降级时，用固定词fallback匹配“继续”“确认开始”“开始生成”等短语。截图证明该路径没有把“我让你接着做啊”稳定映射到可执行确认；生产deterministic fallback现已废弃，不得作为未来修复方向。

要求：模型主路径输出结构化控制决策，服务端只做schema、授权和当前状态校验。确认与继续必须基于最近有效计划、最近明确选择和当前可执行能力判断，不能靠恢复fallback或继续扩充正则词表解决。

### 2.3 多分支场景没有消歧

助手同时给出“继续做视频”和“改做 PPT”两个方向。教师说“接着做”时，如果最近上下文不能唯一确定方向，系统应只追问一个具体问题：

```text
你想继续做视频，还是改做 PPT？
```

不能把语义歧义误报成“没有有效确认”，也不能擅自选择高成本分支。

### 2.4 隐藏 actionId 与用户文本耦合错误

当前点击 quick reply 会在前端保存 actionId；当前 `updateInput(...)` 已在用户编辑输入时清除 actionId，这是正确的安全行为。截图暴露的是另一侧：用户手动输入等价确认时没有 actionId，后端没有建立可审计的语义确认桥梁。

要求：

- actionId 必须绑定计划版本、能力、项目和意图指纹。
- 必须保留并扩展当前安全行为：用户对 quick reply 做任何编辑时同时清除旧 actionId 和 selectedOfferId；后端再判断是等价确认、修订还是改道。不得回归为“修改文本仍携带旧确认或旧分支选择”。
- 用户手动输入与当前唯一 action offer 语义一致时，后端可以生成“确认当前计划”的控制决策，但不能伪造或绕过 HumanGate。

### 2.5 Pending plan 生命周期不完整

当前重点只有 `pending` / `confirmed`，不足以表达教师改道、取消、旧计划失效和执行完成。

唯一持久化状态源必须是架构中已有的 `PendingAction`；当前 `pendingDeliveryPlan` metadata 是它的现有存储表现。第一档扩展 PendingAction 生命周期：

```text
pending
confirmed
cancel_requested
superseded
cancelled
completed
failed
expired
```

同一项目同一时刻只能有一个 active action；`pending`、`confirmed` 和 `cancel_requested` 都属于 active。教师在确认前改做 PPT、改做视频或重新规划时，旧 pending action 必须标记 `superseded`；已经 confirmed 并执行中的动作必须先进入终态，或按能力支持的取消流程结束，不能静默替换。

`ActionOffer` 只是 PendingAction 的教师可见投影，不单独维护另一套状态；`ConversationControlDecision` 是 resolver 的瞬时/审计输出，也不成为第二个计划状态源。

### 2.6 “重新开始且不混用失败状态”没有系统合同

助手承诺不会混用前面的失败状态，但目前没有明确规定哪些状态保留审计、哪些状态退出活动上下文、哪些预算仍然有效。

要求：

- 历史失败 observation 和预算事件必须保留，不能删除审计证据。
- 新计划只读取与当前 plan/action/capability 相关的活动 observation。
- 被 supersede 的旧分支失败不得阻断新分支，也不得被模型当成当前失败原因。
- 同一能力同一动作的重试预算不能通过改写一句话无限重置。
- 新分支是否进入新预算作用域由服务端 `ExecutionScopeKey` 决定；actionId、planVersion 和模型文案都不能单独重置预算。

### 2.7 错误提示暴露内部门禁，而没有解决用户任务

“没有有效确认”是系统内部状态，不是教师需要理解的任务反馈。

要求根据真实原因分别回答：

- 唯一方向且语义确认：确认并继续。
- 多个可能方向：询问“视频还是 PPT”。
- 前置材料不足：说明缺少什么，并给出下一步。
- action 已过期或被替换：说明计划已变化，并展示当前可执行选项。
- 无有效任务授权、超预算、最高强度、外发、权限变化或破坏性动作：说明将发生什么，再要求明确确认；已披露且版本绑定的IntentGrant内真实生成自动推进。

## 3. 产品目标

教师可以像正常说话一样继续、改道、补充或取消，而系统始终保证：

1. 助手说能做的，后端确实有对应动作。
2. 用户的自然语言能映射到当前唯一计划，或得到最小必要追问。
3. 自然语言不会绕过 HumanGate、PlanGuard、Quality Gate。
4. 改道后旧计划和旧失败不污染新分支。
5. UI 推荐按钮是快捷入口，不是唯一有效入口。

## 4. 建议合同

### 4.1 唯一状态源：PendingAction

扩展现有 `PendingAction`，并继续由后端持久化：

```ts
type PendingAction = {
  id: string;
  actionId: string;
  projectId: string;
  planVersion: number;
  capabilityId: CapabilityId;
  expectedArtifactKind: string;
  intentFingerprint: string;
  requestFingerprint: string;
  sourceMessageId?: string;
  sourceArtifactId?: string;
  sourceArtifactVersion?: number;
  sourceArtifactHash?: string;
  status: "pending" | "confirmed" | "cancel_requested" | "superseded" | "cancelled" | "completed" | "failed" | "expired";
  createdFromAssistantMessageId?: string;
  supersededByActionId?: string;
};
```

状态转换固定为：

```text
pending -> confirmed | superseded | cancelled | expired
confirmed -> completed | failed | cancel_requested
cancel_requested -> cancelled | completed | failed
```

`pending`、`confirmed` 和 `cancel_requested` 都占用项目活动槽位。确认后执行尚未结束时不能创建第二个 pending action；改道必须等待当前执行进入终态，或先通过能力支持的取消流程进入 `cancel_requested`，再由 provider 取消结果转为 `cancelled/completed/failed`。

M68 保留现有 `human:${projectId}:${capabilityId}:${messageId}` actionId 格式；PendingAction.actionId 就是 HumanGate / PlanGuard 校验值，数据库 `id` 只是内部主键。不得让模型生成 actionId，也不得在本阶段引入第二种确认 ID。

对 provider 或 Artifact 派生动作，确认必须同时校验 sourceArtifactId、版本/hash、expectedArtifactKind 和规范化 requestFingerprint。任一字段与当前后端事实不一致时，旧 action 进入 expired 并重新披露动作；不能只凭项目和 actionId 重放旧确认。sourceMessageId 与 sourceArtifactId 至少存在一个。

### 4.2 ActionOffer

助手向教师提出的可执行选项必须由 PendingAction 投影生成：

```ts
type ActionOffer = {
  offerId: string;
  sourcePendingActionId?: string;
  kind: "confirm_pending_action" | "switch_to_capability" | "cancel_pending_action";
  targetCapabilityId?: CapabilityId;
  label: string;
  teacherPrompt: string;
  requiresHumanGate: boolean;
};
```

助手文案和 quick replies 都从 ActionOffer 生成。一个 PendingAction 决策点可以投影出“确认当前动作”和若干“切换到其他能力”的选项，但只有确认当前动作能引用当前 actionId；切换选项只能重新规划。不存在 ActionOffer 时，不得说“回复这句话我就执行”。

ActionOffer 必须作为 assistant message metadata 的结构化投影随 API 返回，并在 PendingAction 转换时同步更新，使异步队列完成、刷新和跨标签页后仍能恢复同一有效选项。前端发送 selectedOfferId/actionId，服务端重新校验当前 action 与 planVersion；模型自由文本不能创建 offer 或执行承诺。

### 4.3 ConversationControlDecision

在 Main Agent 规划和 PlanGuard 之间增加对话控制决策：

```ts
type ConversationControlDecision = {
  decisionId: string;
  projectId: string;
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
  targetCapabilityId?: CapabilityId;
  clarificationOptions?: ActionOffer[];
  teacherInstruction?: string;
};
```

该决策必须由服务端生成并写入教师消息 metadata 或独立审计记录。它只解释教师意图，不直接执行工具：

- `confirm_active_offer` 只有在 pendingActionId、计划版本和意图指纹仍匹配当前 PendingAction 时，才能转换为 HumanGate 的确认输入。
- `switch_to_capability` 只触发重新规划和创建新 PendingAction，不能授权工具执行。
- `clarify_offer`、`revise_active_offer`、`cancel_active_offer` 都不直接调用 provider。
- 模型只能提出控制意图，不能创建 actionId、planVersion、fingerprint 或确认审计证据。

## 5. 关键行为

### 5.1 唯一活动计划

如果当前只有一个active任务，教师说“接着做”“按刚才的继续”“就做这个”，系统应保持原TaskBrief并继续IntentGrant范围内的合法动作。

真实provider或最终包本身不自动触发HumanGate。只有不存在有效预算披露/IntentGrant，或下一动作会超预算、进入最高强度、扩大范围、外发、改变权限或产生破坏性副作用时，模糊“接着做”只能保留当前方向，系统必须创建绑定任务、intent、plan和版本的`PendingDecision`并披露影响；不能把模糊“继续”升级为新授权。

### 5.2 多个候选方向

如果存在视频、PPT 等多个候选且无唯一最近选择，系统只问一个具体选择题，并提供两个 quick reply；不得返回通用门禁错误。

### 5.3 改道

教师明确说“改做 PPT”时：

1. 旧视频 action 为 pending 时，标记为 `superseded`。
2. 旧视频 action 已 confirmed/cancel_requested 时，不静默改道；提示当前执行中，并提供能力支持时的取消入口。
3. 旧 action 进入终态后，检查 PPT 前置产物。
4. 更新TaskBrief和WorkingPlan；现有IntentGrant覆盖时直接继续，否则创建新的PendingDecision。
5. 超预算、最高强度、外发、权限或破坏性动作仍需确认；真实provider本身不构成确认理由。

### 5.4 补充要求

教师点击推荐后修改了任务内容，例如从“继续视频”改成“继续视频，但改成卡通风格”，不能继续携带原 actionId 直接执行。系统应将其识别为 revise，更新TaskBrief、IntentEpoch、影响范围和计划；仍在原IntentGrant内则自动继续，超出范围、预算或副作用边界才生成新的PendingDecision。

### 5.5 失败恢复

教师说“重新开始”时，系统必须说明重新开始的范围，例如“从视频脚本重新开始”或“从 PPT 大纲重新开始”。如果范围不明确，只追问范围，不清空历史项目事实。

### 5.6 稳定预算键

执行预算不能直接使用 planVersion，也不能因教师换一种说法或重新生成 PendingAction 就重置。服务端生成稳定的 `ExecutionScopeKey`：

```text
capabilityId
+ expectedArtifactKind
+ goalRevisionId
+ approvedUpstreamArtifactVersionHash
```

规则：

- planVersion、actionId 和用户原始措辞不进入预算键。
- 同一能力、同一目标修订、同一批已确认上游产物，无论重新规划多少次都沿用原预算。
- 只有切换 capability、已确认上游产物版本变化，或教师明确修改目标且后端创建新的 goalRevisionId 时，才进入新预算作用域。
- 模型不能创建 goalRevisionId，也不能决定预算是否重置。

### 5.7 所有执行入口使用同一动作合同

自然语言确认、推荐按钮、Artifact 真实生成按钮和内部 ToolRouter 最终都必须进入同一个服务端 ActionExecution 协调器。不得只修聊天入口或 HTTP route 之一；ConversationTurnService、Coze PPT、图片和视频路径都要使用同一 PendingAction CAS、sourceArtifact/requestFingerprint 校验、执行 checkpoint 和幂等键。

内部能力允许按同一 execution key 受控恢复，但 Artifact 和完成消息必须有执行级唯一来源；真实 provider 不支持幂等或查询时不得自动重发。

### 5.8 状态不明必须有对账出口

provider 执行状态不明或取消待确认时，可以继续占用活动槽位以避免并发重复，但不能永久静默卡住：

- 有 provider 查询/取消接口时由恢复 worker 对账并进入真实终态。
- 无法自动判断时进入管理员受控对账，要求证据备注和 AuditLog。
- 教师看到“生成状态待核对”，不看到内部 ID；管理员裁决后释放项目活动槽位。

## 6. 验收用例

| 上下文 | 用户输入 | 期望 |
|---|---|---|
| 唯一低副作用视频前置计划 | `我让你接着做啊？` | 识别为继续当前前置计划，不出现“没有有效确认” |
| 唯一真实视频任务，IntentGrant与预算披露有效 | `我让你接着做啊？` | 保持TaskBrief并继续，不逐Tool确认 |
| 真实视频任务无有效预算披露或预计超预算 | `我让你接着做啊？` | 保留方向，创建唯一PendingDecision，确认前零付费调用 |
| 视频和 PPT 两个候选，无最近唯一选择 | `接着做` | 追问“继续视频还是改做 PPT”，提供两个选项 |
| 助手承诺“回复继续视频即可” | `继续做视频` | 文本确认与对应 ActionOffer 绑定，进入正确门禁 |
| 点击“继续视频”后把文字改成“改做 PPT” | 修改后发送 | 旧 actionId 失效，识别为改道，不执行视频 |
| 视频计划失败后改做 PPT | `改做 PPT` | 视频计划 superseded，旧视频失败不阻断 PPT |
| 已 superseded 的旧 actionId | 再次提交旧确认 | 拒绝旧动作并展示当前 active offer |
| 用户说“重新开始”但范围不明 | `重新开始` | 追问从视频、PPT 或哪个节点开始，不删除历史事实 |
| 真实视频生成在IntentGrant内 | `继续视频` | 自动继续并保留完整任务；超出授权时才披露影响并进入HumanGate |

## 7. 非目标

- 不取消按钮和 quick replies。
- 不让模型直接生成或猜测 actionId。
- 不用无限增加正则短语代替上下文决策。
- 不删除历史失败、审计和预算记录。
- 不把模糊的“继续”自动映射到高成本或不可逆动作。
