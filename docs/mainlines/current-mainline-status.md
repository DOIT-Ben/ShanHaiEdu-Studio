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
| M66-R runtime loop | done | OpenAIRuntime native tool loop 已通过显式开关接入生产 Runtime Factory；首批只暴露 internal tools，provider 工具仍后置 |
| M67 feedback center | implementation done / rollout pending | 工程实现与本地 E2E 已完成；真实服务器重启、回滚和备份恢复门禁待关闭 |
| Agent workflow closure | implementation done / smoke pending | `asset_image_generate`、`concat_only_assemble`、真实最终包与 package resolved Artifact 门禁已完成；真实外部 provider smoke 待执行 |
| Multi-user management | accepted/next | 下一阶段：内测账号分配、登录、管理员用户管理、资源共享与隔离；公开注册继续关闭 |
| M68 conversation control | planned | 第一档：对话承诺、自然语言控制与执行一致性 |

## 3. 当前优先级

当前优先级从高到低：

1. 下一阶段：按用户指定顺序进入内测版本多用户管理，补齐账号分配、登录、管理员用户管理、会话撤销和跨用户资源共享/隔离；公开注册继续关闭。
2. 后续进入前端功能需求收口，补齐按钮、输出提示、附件/菜单/欢迎态等第一档工作台体验。
3. 真实外部 provider smoke 和一条真实教师任务端到端验收仍是邀请真实用户前门禁。
4. 邀请真实用户前，在目标服务器关闭 M67 共享卷重启、release 回滚和备份恢复门禁。
5. 架构后续：MCP Client Adapter 与 provider/package 工具进入 native loop 的安全输入扩展。
6. 竞品衍生能力后置，不阻塞真实链路、多用户和前端第一档收口。

## 4. 下一阶段建议

建议立即进入：

```text
M69 内测版本多用户管理阶段
```

推荐拆分：

1. 公开注册保持关闭，仅支持管理员分配账号和教师登录。
2. 补齐管理员用户列表、搜索、邀请/创建、停用/启用、角色调整、凭据重置和会话撤销。
3. 项目、对话、产物和反馈按 owner / membership 做服务端授权。
4. 增加共享与隔离机制，支持管理员/项目成员边界内的受控访问。
5. 完成后提交不推送，并自动进入前端功能需求收口阶段。
6. 真实用户开放仍必须等待 M67 生产门禁和真实 provider smoke 关闭。

## 5. 不做事项

- 不批量移动旧阶段文档。
- 不删除旧文档、旧分支或旧 worktree。
- 不把 runtime native tool loop 与自然语言确认修复混在同一个提交里。
- 不放松 HumanGate、PlanGuard、Quality Gate。
- 不在本轮实现 MagicSchool / Canva 竞品研究衍生的第二档能力。
