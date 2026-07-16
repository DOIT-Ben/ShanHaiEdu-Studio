# Backend Workflow Lite Stage 5 Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

Stage 1-4 已经让项目、消息、artifact、确认、重做和 stale 成为真实状态。Stage 5 要补齐“运行失败也是真实状态”：Runtime 或后端任务开始、完成、失败都必须写入 `AgentRun`，失败时节点进入可恢复状态，但不得删除旧产物。

本阶段必须证明：

- 可以创建 AgentRun。
- 可以把 AgentRun 标记为 succeeded 或 failed。
- 失败时对应 node 标记 `failed`，并保留旧 approved artifact。
- snapshot 能返回 AgentRun，供前端/Runtime 恢复。

## 2. 可复用方案调研

继续复用：

- Prisma transaction：run 状态和 node 状态一致更新。
- Route Handlers：提供最小 run 写入 API。
- 现有 snapshot 聚合：Stage 1 已包含 `agentRuns` 字段。

参考：

- <https://www.prisma.io/docs/orm/prisma-client/queries/transactions>
- <https://nextjs.org/docs/app/api-reference/file-conventions/route>

## 3. 复用、适配与必要自研

复用：

- 复用 `AgentRun` 模型。
- 复用 `WorkflowNode.status=failed`。
- 复用 snapshot 中 `agentRuns`。

适配：

- `startAgentRun(projectId, input)` 创建 `status=running` run，并把 node 设为 `in_progress`。
- `finishAgentRun(projectId, runId, input)` 更新 run 为 `succeeded` 或 `failed`。
- failed 时 node 设为 `failed`，但不清空 `approvedArtifactId`。
- succeeded 时 node 不自动 approved；artifact 写入和确认仍由 Stage 1-4 API 控制。

自研：

- `POST /api/workbench/projects/[projectId]/agent-runs`
- `POST /api/workbench/projects/[projectId]/agent-runs/[runId]/finish`

## 4. Stage 5 开发方案

### 服务能力

- `startAgentRun(projectId, { nodeKey, runtime })`
  - 创建 AgentRun。
  - 将 node 标记 `in_progress`。

- `finishAgentRun(projectId, runId, { status, errorMessage })`
  - run 必须属于 projectId。
  - `status=succeeded`：写 finishedAt。
  - `status=failed`：写 finishedAt、errorMessage，并将 node 标记 `failed`。

### API 合同

| Method | Path | 能力 |
| --- | --- | --- |
| `POST` | `/api/workbench/projects/[projectId]/agent-runs` | 创建运行记录 |
| `POST` | `/api/workbench/projects/[projectId]/agent-runs/[runId]/finish` | 结束运行记录 |

## 5. 风险与回退

| 风险 | 控制方式 | 回退方式 |
| --- | --- | --- |
| 失败覆盖旧确认产物 | 不清 approvedArtifactId，不改 artifact | 测试覆盖 |
| 跨项目 finish run | run 查询带 projectId | 测试覆盖 |
| succeeded 误标 approved | succeeded 只结束 run，不替代确认流程 | 测试覆盖 |

## 6. Stage 5 验证标准

- `npm run test:stage1` 通过。
- `npm run test:stage2` 通过。
- `npm run test:stage3` 通过。
- `npm run test:stage4` 通过。
- `npm run test:stage5` 通过。
- `npm run build` 通过。
- API smoke 覆盖 run start/fail/snapshot 恢复。
- 自审或独立审查完成并处理意见。
- 提交并 push 到 `origin/feature/mvp-backend-workflow-lite`。
