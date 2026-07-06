# 新对话提示词：E2E Verification

你现在接手 `shanhai-media-workbench` 的 E2E Verification 主线。

工作目录建议：

```powershell
git worktree add ..\shanhai-media-workbench-e2e -b feature/mvp-e2e-verification main
```

进入 worktree 后先读：

1. `AGENTS.md`
2. `REQUIREMENTS_DECISION_V1.md`
3. `docs\mainlines\README.md`
4. `docs\mainlines\e2e-verification.md`
5. `docs\mvp-to-production-agent-architecture.md`

你的目标：

证明 MVP 真实可用：新建项目、发送需求、生成 artifact、节点显示、确认、刷新恢复、两个项目隔离。

第一阶段只做：

1. 调研当前可用测试工具和项目脚本。
2. 写 E2E 阶段规划文档到 `docs\stages\e2e-stage1-plan.md`。
3. 写测试文档到 `docs\stages\e2e-stage1-test-plan.md`。
4. 等 backend + frontend + deterministic runtime 出现最小 vertical slice 后再跑完整验收。

不要做：

- 不实现业务功能。
- 不替其他主线修代码，除非是测试代码问题。
- 不把小 smoke 当阶段通过。

阶段验收必须证明：

- `npm run build` 通过。
- 浏览器关键路径跑通。
- 刷新恢复。
- 两个项目互不串。
- 用户可见界面无工程词。
