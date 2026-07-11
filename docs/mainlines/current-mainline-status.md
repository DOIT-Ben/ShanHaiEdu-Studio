# Local Real MVP 当前主线状态

更新时间：2026-07-11

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
| M69 multi-user management | implementation done / rollout pending | 内测账号分配、登录、管理员用户管理、项目成员共享与隔离已完成；真实用户开放仍等待生产门禁和真实 provider smoke |
| M70 frontend workbench polish | done | 首次欢迎态、附件拖放/截图粘贴、文件状态、工具菜单、假入口清理和桌面/390px 响应式验收已完成 |
| M71A project lifecycle and feedback polish | done | 反馈选中态、轻量问候、项目重命名、归档、回收站、恢复、生命周期写入门禁与受控回退已完成；不含永久删除 |

## 3. 当前优先级

当前优先级从高到低：

1. 恢复上线前生产门禁：真实外部 provider smoke 和一条真实教师任务端到端验收。
2. 邀请真实用户前，在目标服务器关闭 M67 共享卷重启、release 回滚和备份恢复门禁。
3. 后续产品主线：补齐视频结构化前置链路，确保真实视频 provider 调用前有可校验脚本、分镜、资产图和片段计划。
4. 架构后续：MCP Client Adapter 与 provider/package 工具进入 native loop 的安全输入扩展。
5. 竞品衍生能力后置，不阻塞真实链路、多用户、前端第一档和生产门禁收口。

## 4. 下一阶段建议

建议立即进入：

```text
上线前生产门禁与真实 provider smoke 收口
```

推荐拆分：

1. 在目标服务器关闭 M67 共享卷重启、release 回滚和备份恢复门禁。
2. 执行真实外部 PPTX、图片、视频/OpenAI-compatible provider smoke，不用 mock 或文件名冒充真实交付。
3. 用一条真实教师任务做端到端验收，覆盖需求、教案、PPT 设计、PPTX、图片、视频和最终材料包。
4. 通过后再评估是否进入小范围真实用户邀请。
5. 若继续产品能力开发，下一阶段建议进入 M71 视频结构化前置链路补齐。

## 5. 不做事项

- 不批量移动旧阶段文档。
- 不删除旧文档、旧分支或旧 worktree。
- 不把 runtime native tool loop 与自然语言确认修复混在同一个提交里。
- 不放松 HumanGate、PlanGuard、Quality Gate。
- 不在本轮实现 MagicSchool / Canva 竞品研究衍生的第二档能力。
