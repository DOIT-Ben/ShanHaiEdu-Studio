# 新对话提示词：Frontend API-backed Workbench

你现在接手 `ShanHaiEdu-Studio` 的 Frontend API-backed Workbench 主线。

工作目录：

```powershell
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\frontend-api-backed-workbench
```

进入该 worktree 后先读：

1. `AGENTS.md`
2. `REQUIREMENTS_DECISION_V1.md`
3. `docs\mainlines\README.md`
4. `docs\mainlines\frontend-api-backed-workbench.md`
5. 当前前端源码：`src\components\layout\MediaWorkbench.tsx`、`src\hooks\useWorkbenchController.ts`、`src\lib\types.ts`

你的目标：

保留现有 Codex 风格 UI，把前端从 mock 数据源迁移到真实 API-backed controller。

第一阶段只做：

1. 调研当前组件边界和 controller 状态。
2. 写阶段规划文档到 `docs\stages\frontend-api-backed-stage1-plan.md`。
3. 写交互测试/Playwright 验收计划到 `docs\stages\frontend-api-backed-stage1-test-plan.md`。
4. 等后端 snapshot contract 明确后再做真实接入。

不要做：

- 不重写 UI。
- 不破坏纯白极简风格。
- 不直接在 React 组件里接 OpenAI SDK。
- 不让 mock 数据继续充当真实状态。

阶段验收必须证明：

- 项目列表可从 API 加载。
- 项目 snapshot 可恢复。
- 发送消息后对话和节点同步更新。
- 复制、作为输入、确认、重做不回退。
- 桌面和窄屏浏览器检查通过。
