# Backend Workflow Lite Stage 2 Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

Stage 1 已经能保存项目、消息、节点、artifact，并读取 snapshot。Stage 2 的核心是让“用户确认”成为真实业务状态，而不是前端按钮效果：只有 approved artifact 才能作为下游节点输入。

本阶段必须证明：

- artifact 可以被确认。
- 确认后对应 WorkflowNode 记录 approved artifact。
- 下游节点能读取已确认的上游 artifact。
- 项目隔离仍然成立。

## 2. 可复用方案调研

复用 Stage 1 已确定的方案：

- Next.js Route Handlers 继续承载最小 API。
- Prisma transaction 保证 artifact 和 node 确认状态一致更新。
- Repository/Service 边界继续隔离数据库细节。

参考：

- <https://nextjs.org/docs/app/api-reference/file-conventions/route>
- <https://www.prisma.io/docs/orm/prisma-client/queries/transactions>

## 3. 复用、适配与必要自研

复用：

- 继续使用 `Artifact.isApproved`、`Artifact.status`、`WorkflowNode.status`、`WorkflowNode.approvedArtifactId`。
- 继续使用 `WorkflowNode.upstreamNodeKeysJson` 判断下游输入范围。

适配：

- `approveArtifact(projectId, artifactId)` 必须同时校验 projectId，防止跨项目确认。
- `getApprovedInputs(projectId, nodeKey)` 只返回目标节点 upstream 中已 approved 的 artifact。

自研：

- 新增 `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/approve`。
- 新增 `GET /api/workbench/projects/[projectId]/approved-inputs?nodeKey=...`。
- snapshot 继续保持 Stage 1 shape，不在本阶段加入前端复杂字段。

## 4. Stage 2 开发方案

### 服务能力

- `approveArtifact(projectId, artifactId)`
  - 查找 artifact，必须属于 projectId。
  - 将 artifact 更新为 `status=approved`、`isApproved=true`。
  - 将同项目同 nodeKey 的 WorkflowNode 更新为 `status=approved`、`approvedArtifactId=artifactId`。
  - 返回确认后的 artifact。

- `getApprovedInputs(projectId, nodeKey)`
  - 读取目标 WorkflowNode。
  - 解析 upstream node keys。
  - 返回同项目、upstream nodeKey 内、`isApproved=true` 的 artifact。

### API 合同

| Method | Path | 能力 |
| --- | --- | --- |
| `POST` | `/api/workbench/projects/[projectId]/artifacts/[artifactId]/approve` | 确认 artifact |
| `GET` | `/api/workbench/projects/[projectId]/approved-inputs?nodeKey=lesson_plan` | 读取某节点可用上游输入 |

### 文件结构

修改：

- `src/server/workbench/repository.ts`
- `src/server/workbench/service.ts`
- `src/server/workbench/types.ts`

新增：

- `src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/approve/route.ts`
- `src/app/api/workbench/projects/[projectId]/approved-inputs/route.ts`
- `src/server/workbench/__tests__/stage2-workflow-lite.test.ts`

## 5. 风险与回退

| 风险 | 控制方式 | 回退方式 |
| --- | --- | --- |
| approve 跨项目串数据 | service/repository 双层 projectId 条件 | 测试覆盖跨项目 artifactId |
| 下游输入包含未确认版本 | 查询条件限定 `isApproved=true` | Stage 3 再做版本 guard |
| 一个节点多版本均 approved | Stage 2 允许历史 approved 并返回已确认项 | Stage 3 收口当前版本指针 |

## 6. Stage 2 验证标准

- `npm run test:stage1` 通过，保证 Stage 1 不退化。
- 新增 Stage 2 测试通过，覆盖 approve、下游输入和项目隔离。
- `npm run build` 通过。
- 真实 API smoke 覆盖 approve 和 approved-inputs。
- `git diff --check` 通过。
