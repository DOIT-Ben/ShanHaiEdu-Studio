# Local Real MVP 当前主线状态

更新时间：2026-07-10

## 1. 当前主线

当前唯一开发主线：

```text
Local Real MVP
```

目标：让教师在本机完成一节小学数学公开课材料的真实生产闭环，包括需求、教案、PPT 设计稿、真实 PPTX、课堂视觉图、导入视频和最终材料包。

## 2. 最近已完成阶段

| 阶段 | 状态 | 说明 |
|---|---|---|
| M61 | done | Agent 上下文门禁与异步队列 |
| M62/M63 | done | AgentWorldState、ToolObservation、AgentHarnessBudget |
| M64 | done | ToolRegistry、ToolRouter、内部工具/Provider adapter、CTS 接入 |
| M65 | done | OpenAI Responses native function_call 协议闭环与 OpenAIRuntime 可选接线 |
| M66 runtime plan | planned/deferred | 已有 runtime tool loop 主线接入计划，但因交互确认需求优先，暂后置 |

## 3. 当前优先级

当前优先级从高到低：

1. 文档结构治理：建立需求、架构、主线、阶段文档边界。
2. 自然语言确认与改道：解决“用户不点推荐按钮就无法执行”的交互问题。
3. 视频结构化前置链路：补齐主题、脚本、分镜、资产图、片段计划。
4. PPTX / 视频 / 最终包真实质量门禁持续回归。
5. OpenAIRuntime native tool loop 主线接入。

## 4. 下一阶段建议

建议下一阶段命名：

```text
M66 文档治理与自然语言确认改道
```

推荐拆分：

1. M66-0：文档结构、需求总账、主线状态落地。
2. M66-1：自然语言确认与改道 resolver。
3. M66-2：ConversationTurnService 接入 resolver。
4. M66-3：截图场景浏览器验收与 UI 文案协调。
5. M66-4：集中验收与 closeout。

## 5. 不做事项

- 不在 M66-0 批量移动旧阶段文档。
- 不删除旧文档、旧分支或旧 worktree。
- 不把 runtime native tool loop 与自然语言确认修复混在同一个提交里。
- 不放松 HumanGate、PlanGuard、Quality Gate。
