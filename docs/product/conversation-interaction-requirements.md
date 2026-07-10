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

系统必须保留 HumanGate / PlanGuard / Quality Gate，不允许因为一句自然语言直接绕过真实 provider、文件生成或高风险动作确认。

## 3. 目标行为

### 3.1 自然语言确认当前计划

用户输入：

```text
直接开始。
就按这个做。
确认开始。
开始生成。
```

如果存在 pending plan，且用户语义与计划一致，系统应识别为选择当前方向。低副作用、无需 HumanGate 的动作可以等价确认为当前计划；真实 provider 或高成本动作必须先披露动作范围，再要求按钮或明确复述动作的显式确认，不能由模糊“继续”授权。

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
可以做导入视频，但现在还缺少已确认的视频主题、脚本、分镜和资产图。我建议先从视频主题和脚本开始，确认后再进入分镜和素材图。是否现在开始整理视频主题？
```

### 3.4 前置材料充足但涉及真实 provider

当材料充足且下一步会调用真实生成服务时，仍需 HumanGate：

```text
可以，我将按已确认的脚本、分镜和资产图进入视频片段生成。这一步会调用真实视频生成服务，需要你确认后开始。
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
| `可以调用生成服务。` | 涉及真实 provider | 仍要求明确 HumanGate，不直接执行 |
| `我让你接着做啊？` | 唯一低副作用 active 计划 | 识别上下文省略，继续当前计划 |
| `我让你接着做啊？` | 唯一真实 provider 动作 | 只选择方向，展示动作后要求显式 HumanGate |
| `接着做` | 同时存在视频/PPT候选且无唯一选择 | 只追问“继续视频还是改做 PPT” |
| 点击推荐后实质修改文本 | actionId 对应旧意图 | 旧 actionId 失效，重新规划或改道 |
