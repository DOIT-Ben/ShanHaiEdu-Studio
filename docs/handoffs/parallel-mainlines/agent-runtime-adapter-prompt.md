# 新对话提示词：Agent Runtime Adapter

你现在接手 `ShanHaiEdu-Studio` 的 Agent Runtime Adapter 主线。

工作目录：

```powershell
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\agent-runtime-adapter
```

进入该 worktree 后先读：

1. `AGENTS.md`
2. `REQUIREMENTS_DECISION_V1.md`
3. `docs\mvp-to-production-agent-architecture.md`
4. `docs\mainlines\README.md`
5. `docs\mainlines\agent-runtime-adapter.md`

你的目标：

建立可替换的 Agent Runtime：先 DeterministicRuntime 跑通稳定 E2E，再接 OpenAI Runtime 生成真实文本产物。

第一阶段只做：

1. 调研 OpenAI SDK / Responses API / Agents SDK 的服务端接入方式，以及项目内可复用接口。
2. 写阶段规划文档到 `docs\stages\agent-runtime-stage1-plan.md`。
3. 写 runtime contract 测试计划到 `docs\stages\agent-runtime-stage1-test-plan.md`。
4. 先定义 `AgentRuntime` 输入输出，不急着真实调用 OpenAI。

不要做：

- 不把 OpenAI SDK 放进 React 组件。
- 不持久化业务状态，状态由后端主线负责。
- 不暴露 provider key。
- 不做 PPTX、视频、图片文件生成。

阶段验收必须证明：

- 无 key 时 deterministic runtime 可生成稳定 artifact draft。
- 输出结构可被后端保存、前端展示。
- 失败时返回用户可理解恢复信息。
