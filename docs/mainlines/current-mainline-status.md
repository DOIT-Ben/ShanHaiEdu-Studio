# Local Real MVP 当前主线状态

更新时间：2026-07-11（v1 封板交接）

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
| M72 nonlinear beta readiness | implementation verified / acceptance gap | 反馈、双账号隔离、CSRF、会话撤销和历史归属已验证；“只做视频脚本”真实浏览器路径仍返回前置确认，RQ-015 不关闭 |
| M73 artifact capability navigation | done | 最多 6 个能力入口、备课成果抽屉、分组筛选与返回来源通过自动化和真实浏览器验收 |
| M74 branded auth page | done | 1366×768 与 390px 品牌认证入口通过；公网注册关闭仍属于发布门禁 |
| M75 authenticated welcome | done | 登录/刷新先到欢迎页，主动选择或新建后进入项目 |
| M76 interactive list row | done | 三处计划内列表迁移完成，颜色型交互与独立菜单边界通过 |
| M77 select polish | implementation verified / browser pending | 自动化通过；真实 owner 成员权限 Select 的展开、键盘选择和保存未完成 |
| M78 unified UI system | implementation verified / browser pending | 全局基础组件抽离及常用页面验收完成；继承 M77 owner 写路径门禁 |

## 2.1 v1 候选基线

- 候选提交：`fffdfb3b050782208bb6e288d3e324ba44a4c659`。
- annotated tag：`v1`，仍指向上述提交，未移动、未重写。
- `main` 与 `origin/main` 在封板开始时一致；后续只允许新增 closeout/docs 提交，不修改 v1。
- 新鲜工程证据：Graphify 3111 nodes / 7772 edges；Node 259/259；Vitest 481/481；生产构建和 diff check 通过。

## 3. 当前优先级

当前优先级从高到低：

1. 关闭 M72 按需视频脚本真实浏览器差距。
2. 使用真实项目 owner 完成 M77/M78 成员权限 Select 写路径浏览器验收。
3. 获得单独授权后执行真实外部 provider smoke 和一条真实教师任务端到端验收。
4. 邀请真实用户前，在目标服务器关闭 M67 共享卷重启、release 回滚和备份恢复门禁。
5. 修订仍查找旧认证标题的 M67 E2E；该测试债务不通过修改 v1 历史解决。

## 4. 下一阶段建议

封板完成后停止继续开发。主 Codex 接管时优先进入：

```text
v1 未关闭门禁收口，不启动 M79
```

推荐拆分：

1. 在目标服务器关闭 M67 共享卷重启、release 回滚和备份恢复门禁。
2. 执行真实外部 PPTX、图片、视频/OpenAI-compatible provider smoke，不用 mock 或文件名冒充真实交付。
3. 用一条真实教师任务做端到端验收，覆盖需求、教案、PPT 设计、PPTX、图片、视频和最终材料包。
4. 通过后再评估是否进入小范围真实用户邀请。
5. 若继续产品能力开发，下一阶段建议进入 M71 视频结构化前置链路补齐。

当前明确未关闭的上线门：真实 Provider/PPTX/图片/视频/最终包端到端、目标服务器共享卷重启、release 回滚、备份恢复、公开注册关闭复核、M72 按需视频脚本差距、M77 owner 写路径浏览器验收。

## 5. 不做事项

- 不批量移动旧阶段文档。
- 不删除旧文档、旧分支或旧 worktree。
- 不把 runtime native tool loop 与自然语言确认修复混在同一个提交里。
- 不放松 HumanGate、PlanGuard、Quality Gate。
- 不在本轮实现 MagicSchool / Canva 竞品研究衍生的第二档能力。
