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

1. 上线门槛：完成内测反馈中心，支持引导分类、描述、图片选择、截图粘贴和服务端持久化。
2. 简单上线并邀请内测用户使用，优先收集真实问题，不在上线前扩大到第二档能力。
3. 第一档：收口 M54-A 前端聊天式工作台未完成项。
4. 第一档：自然语言确认与改道，解决“用户不点推荐按钮就无法执行”。
5. 核心交付：视频结构化前置链路和 PPTX / 视频 / 最终包真实质量门禁。
6. 架构后续：OpenAIRuntime native tool loop 主线接入。
7. 第二档：竞品研究衍生能力，完成一轮内测后再决定，现阶段不实现。

## 4. 下一阶段建议

建议立即进入：

```text
内测反馈中心上线门槛阶段
```

推荐拆分：

1. 反馈需求与数据契约定稿。
2. FeedbackStorage / 数据库记录 / 图片附件接口。
3. 全局反馈弹窗、引导分类、预制提示、图片选择和截图粘贴。
4. 消息点赞/点踩、头像菜单和全局入口统一接入。
5. 浏览器验收、持久化复验和上线前安全检查。
6. 上线后进入第一档 M54-A UI 收口及自然语言确认改道。

## 5. 不做事项

- 不在 M66-0 批量移动旧阶段文档。
- 不删除旧文档、旧分支或旧 worktree。
- 不把 runtime native tool loop 与自然语言确认修复混在同一个提交里。
- 不放松 HumanGate、PlanGuard、Quality Gate。
- 不在本轮实现 MagicSchool / Canva 竞品研究衍生的第二档能力。
