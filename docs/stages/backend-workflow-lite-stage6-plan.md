# Backend Workflow Lite Stage 6 Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

Stage 5 已经把 AgentRun 开始、成功、失败写成真实状态，但仍有一个关键缺口：当两个运行先后启动时，旧运行的迟到 finish 不能覆盖新运行代表的当前节点状态；同一个 run 也不能被重复 finish 后反复改写。

Stage 6 的核心是给 MVP 加上最小并发与隔离防线：

- finish run 必须只允许 running run。
- 旧 run 迟到失败可以记录自身失败，但不能把当前 node 从新 run 的 in_progress 改成 failed。
- artifact 重做必须支持 expected latest version guard，避免过期视图继续写新版本。
- regenerate 可带 expected latest version，拒绝基于过期视图继续写新版本。
- 路由层对并发冲突返回稳定 409，供前端和 Runtime 做恢复。

## 2. 可复用方案调研

继续复用：

- Prisma transaction：同一次 finish 中读取 run、判断 latest run、更新 run 和必要的 node 状态。
- Next.js Route Handlers：并发冲突映射为 HTTP 409。

参考：

- <https://www.prisma.io/docs/orm/prisma-client/queries/transactions>
- <https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/409>

## 3. 复用、适配与必要自研

复用：

- 复用 Stage 5 的 `startAgentRun` / `finishAgentRun`。
- 复用 Stage 3 的 artifact version 规则和 regenerate route。

适配：

- `finishAgentRun`：
  - run 不存在：继续返回 not found。
  - run 非 running：拒绝，route 返回 409。
  - 当前 finish 的 run 不是同项目同 nodeKey 的最新 run：只更新 run 自身，不更新 node。
  - 当前 finish 的 run 是最新 run 且 failed：node 标记 failed。
- `regenerateArtifact`：
  - 支持 `expectedLatestVersion`。
  - 如果传入值与当前 latest version 不一致，拒绝，route 返回 409。

自研：

- Stage 6 测试覆盖重复 finish、旧 run 迟到、artifact expected version guard、跨项目版本隔离。

## 4. Stage 6 开发方案

### 服务能力

- `finishAgentRun(projectId, runId, input)`
  - `existing.status !== "running"` 时抛出并发冲突。
  - 查询同项目同节点 latest run。
  - 只有 latest run 的 failed finish 才更新 workflow node 为 failed。

- `regenerateArtifact(projectId, artifactId, input)`
  - `input.expectedLatestVersion` 可选。
  - 当 latest version 与 expected 不一致时抛出并发冲突。

### API 合同

| Method | Path | 新增 Stage 6 行为 |
| --- | --- | --- |
| `POST` | `/api/workbench/projects/[projectId]/agent-runs/[runId]/finish` | 重复 finish 返回 409 |
| `POST` | `/api/workbench/projects/[projectId]/artifacts/[artifactId]/regenerate` | expected latest version 冲突返回 409 |

## 5. 风险与回退

| 风险 | 控制方式 | 回退方式 |
| --- | --- | --- |
| 旧 run 迟到覆盖新 run | latest run 判断后只更新 run，不更新 node | 测试覆盖 |
| 重复 finish 改写 finishedAt/error | 非 running run 拒绝 | 测试覆盖 |
| SQLite 并发能力有限 | MVP 先落应用 guard；数据库唯一约束留到后续 migration / Postgres 准备阶段 | Stage 6 closeout 记录 |
| expected version 影响旧调用 | 字段可选，不传时保持 Stage 3 兼容 | 路由测试覆盖 |

## 6. Stage 6 验证标准

- `npm run test:stage6` 通过。
- `npm run test:stage1` 到 `npm run test:stage5` 回归通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- API smoke 覆盖重复 finish 409 和 stale regenerate 409。
- 自审或独立审查完成并处理意见。
- 提交并 push 到 `origin/feature/mvp-backend-workflow-lite`。
