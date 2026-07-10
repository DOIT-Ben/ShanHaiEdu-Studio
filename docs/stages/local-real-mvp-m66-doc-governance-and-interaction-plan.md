# M66 文档治理与自然语言确认改道实施计划

日期：2026-07-10

## 1. 目标

M66 先解决两个阻塞后续主线的问题：

1. 文档结构混杂：需求、架构、主线、阶段开发需要分清楚。
2. 对话确认过死：用户不点推荐按钮，而是直接输入“直接开始做视频”时，系统不应机械回复“没有有效确认”。

## 2. 范围

### 纳入范围

- 建立 `docs\README.md`、需求总账、对话交互需求、架构入口、主线状态文档。
- 更新 `AGENTS.md`，写明项目文档结构和新增需求入口。
- 后续实现自然语言确认与改道 resolver。
- 后续在 `ConversationTurnService` 的 PlanGuard 前接入 resolver。

### 不纳入范围

- 不批量移动旧文档。
- 不删除历史阶段文件。
- 不降低 HumanGate、PlanGuard、Quality Gate。
- 不直接接真实 MCP。
- 不把 provider 工具自由暴露给模型。

## 3. 阶段拆分

### M66-0 文档结构治理

产物：

```text
docs\README.md
docs\product\requirements-backlog.md
docs\product\conversation-interaction-requirements.md
docs\architecture\README.md
docs\architecture\decisions\README.md
docs\mainlines\current-mainline-status.md
docs\stages\README.md
AGENTS.md
```

验收：文档存在、开头内容正常、`AGENTS.md` 明确文档分类和新增需求入口。

### M66-1 自然语言确认与改道 Resolver

建议新增：

```text
src\server\conversation\natural-confirmation-resolver.ts
tests\natural-confirmation-resolver.test.ts
```

核心行为：

- 识别确认当前 pending plan。
- 识别改道到视频、PPT、教案等能力。
- 前置不足时返回教师可理解的缺口。
- 不授权真实 provider 或高风险动作。

### M66-2 ConversationTurnService 接入

接入点：PlanGuard 前。

验收截图场景：

```text
用户：直接开始做视频。
期望：不再出现“我还没有拿到这一步的有效确认”。
```

### M66-3 UI 与浏览器验收

- 推荐按钮继续保留。
- 用户自由输入也能推进或得到明确缺口说明。
- 教师界面不出现工程词。

### M66-4 收尾

集中验收：

```powershell
npx vitest run tests/natural-confirmation-resolver.test.ts tests/conversation-turn-service.test.ts --maxWorkers=1
npx tsc --noEmit
npm run build
graphify update .
```

收尾文档：

```text
docs\stages\local-real-mvp-m66-doc-governance-and-interaction-closeout.md
```

## 4. 风险

| 风险 | 控制 |
|---|---|
| 自然语言确认误触发真实生成 | 真实 provider 仍需 HumanGate |
| 改道绕过前置材料 | resolver 必须检查 capabilityAvailability 和 AgentWorldState |
| 文档继续膨胀 | 新需求先入 backlog，再入阶段计划 |
| 旧文档引用断裂 | M66-0 不移动旧文件 |
