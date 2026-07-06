# 新对话提示词：Backend Workflow Lite

你现在接手 `shanhai-media-workbench` 的 Backend Workflow Lite 主线。

工作目录建议：

```powershell
git worktree add ..\shanhai-media-workbench-backend -b feature/mvp-backend-workflow-lite main
```

进入 worktree 后先读：

1. `AGENTS.md`
2. `REQUIREMENTS_DECISION_V1.md`
3. `docs\mvp-to-production-agent-architecture.md`
4. `docs\mainlines\README.md`
5. `docs\mainlines\backend-workflow-lite.md`

你的目标：

建立真实 MVP 状态真源：Project、ConversationMessage、WorkflowNode、Artifact、AgentRun，以及对应 API 合同。

第一阶段只做：

1. 调研 Next.js API / Prisma / Postgres 或 SQLite 开发期方案。
2. 写阶段规划文档到 `docs\stages\backend-workflow-lite-stage1-plan.md`。
3. 写测试文档或 contract test 计划到 `docs\stages\backend-workflow-lite-stage1-test-plan.md`。
4. 等规划明确后再开发。

不要做：

- 不改前端视觉。
- 不接 OpenAI。
- 不做 PPTX、视频、图片生成。
- 不把 mock 当真实状态。

阶段验收必须证明：

- 可以创建项目。
- 可以保存和读取消息。
- 可以保存和读取 artifact。
- 可以返回项目 snapshot。
- 两个项目不会串数据。
