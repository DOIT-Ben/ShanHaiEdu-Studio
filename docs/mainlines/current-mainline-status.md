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
| M64-R | done | 17/17 工具注册一致性；PPTX、图片、视频统一经 ToolRouter；resolved Artifact 与 Artifact Truth Gate |
| M65 | done | OpenAI Responses native function_call 协议闭环与 OpenAIRuntime 可选接线 |
| M66-R runtime plan | planned/deferred | 已有 runtime tool loop 主线接入计划，但因上线反馈与交互控制优先，暂后置 |
| M67 feedback center | implementation done / rollout pending | 工程实现与本地 E2E 已完成；真实服务器重启、回滚和备份恢复门禁待关闭 |
| Agent workflow closure | accepted/next | 下一阶段：剩余阻断工具、真实最终包、M68 执行一致性和真实任务全链路验收 |
| Multi-user management | accepted/after workflow closure | 智能体真实主链闭环后进入多用户隔离、公开注册与用户管理规划 |
| M68 conversation control | planned | 第一档：对话承诺、自然语言控制与执行一致性 |

## 3. 当前优先级

当前优先级从高到低：

1. 下一阶段：先完成真实智能体工作流闭环，包括剩余阻断工具、真实最终包和一条真实教师任务端到端验收。
2. 实施 M68 自然语言确认、对话承诺与执行一致性，解决“用户不点推荐按钮就无法执行”和“助手承诺后仍被门禁阻断”。
3. 智能体主链闭环后进入多用户隔离、公开注册与用户管理，补齐账号日常管理、会话撤销和跨用户资源授权。
4. 邀请真实用户前，在目标服务器关闭 M67 共享卷重启、release 回滚和备份恢复门禁。
5. 架构后续：M66-R OpenAIRuntime native tool loop 主线接入。
6. 前端工作台优化与竞品衍生能力后置，不阻塞真实链路和多用户上线。

## 4. 下一阶段建议

建议立即进入：

```text
智能体真实工作流闭环阶段
```

推荐拆分：

1. 以一个真实小学数学公开课任务为固定验收样本。
2. 实现 `asset_image_generate`、`concat_only_assemble` 和工具层真实最终包动作。
3. 完成 M68 对话确认、改道、承诺与 ActionExecution 一致性。
4. 使用真实 Provider 跑通需求、教案、PPT 设计、PPTX、图片、视频和最终材料包。
5. 主链验收通过后进入公开注册、多用户隔离和管理员用户管理。
6. 真实用户开放仍必须等待 M67 生产门禁关闭。

## 5. 不做事项

- 不批量移动旧阶段文档。
- 不删除旧文档、旧分支或旧 worktree。
- 不把 runtime native tool loop 与自然语言确认修复混在同一个提交里。
- 不放松 HumanGate、PlanGuard、Quality Gate。
- 不在本轮实现 MagicSchool / Canva 竞品研究衍生的第二档能力。
