# 目标模式 Hand off：Backend Workflow Lite

你现在接手 `ShanHaiEdu-Studio` 的 Backend Workflow Lite 主线。请进入目标模式，而不是只做一次性回复。

## 目标模式

如果当前环境支持 goal / 目标工具，第一步请创建目标：

```text
完成 ShanHaiEdu-Studio Backend Workflow Lite 主线的 MVP 可合并版本：建立真实状态真源和 API 合同，让项目、对话、节点、产物、确认状态可以被真实创建、保存、读取和恢复，并通过阶段验收。
```

如果当前环境没有 goal 工具，也要在回复开头明确这个目标，并持续推进到目标完成。不要写完规划就停；规划只是第一步。只有满足以下任一条件才允许结束：

- 本主线目标完成，测试和构建通过，变更已提交，且给出可合并说明。
- 出现同一个外部阻塞连续三轮无法绕过，已写清已知事实、阻塞点、已尝试动作、下一步最小动作。

## 工作目录

```powershell
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\backend-workflow-lite
```

进入该 worktree 后先执行：

```powershell
git status --short --branch
```

## 必读材料

1. `AGENTS.md`
2. `REQUIREMENTS_DECISION_V1.md`
3. `docs\mvp-to-production-agent-architecture.md`
4. `docs\mainlines\README.md`
5. `docs\mainlines\backend-workflow-lite.md`

## 主线目标

建立真实 MVP 状态真源和 API 合同，覆盖：

- Project
- ConversationMessage
- WorkflowNode
- Artifact
- AgentRun
- 项目 snapshot
- artifact approve / regenerate 的最小闭环

## 执行协议

严格按项目准则执行：

```text
调研现有工具/方案
-> 写阶段规划文档
-> 写测试文档或测试用例
-> 按规划开发
-> 按测试文档集中验收
-> 审查与修正
-> 收尾记录
-> 提交本主线变更
```

第一阶段必须先产出：

- `docs\stages\backend-workflow-lite-stage1-plan.md`
- `docs\stages\backend-workflow-lite-stage1-test-plan.md`

写完规划和测试文档后继续开发，不要停下来等用户再次催。

## 边界

- 不改前端视觉。
- 不接 OpenAI。
- 不做 PPTX、视频、图片生成。
- 不把 mock 当真实状态。
- 不把数据库、文件路径、密钥写死到业务组件里。

## 阶段验收

阶段完成前必须证明：

- 可以创建项目。
- 可以保存和读取消息。
- 可以保存和读取 artifact。
- 可以返回项目 snapshot。
- 可以记录节点状态和确认状态。
- 两个项目不会串数据。
- `npm run build` 通过。
- 相关测试通过。

## 收尾要求

完成后提交本 worktree 的变更，提交信息使用中文格式：

```text
类型: 简要描述 | 版本号 | YYYY-MM-DD HH:MM
```

最终回复要说明：完成了什么、关键文件、验证命令和结果、剩余风险、是否可以合并到 `main`。
