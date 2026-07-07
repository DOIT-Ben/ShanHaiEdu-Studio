# Backend Workflow Lite Stage 4 Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

Stage 3 已完成 artifact 多版本和确认指针。Stage 4 要解决上游确认版本变化后，下游产物不能被静默继续视为有效。核心规则是：下游旧内容保留，但必须标记需重审。

本阶段必须证明：

- 上游节点确认新版本时，依赖它的已确认下游节点标记 `stale`。
- 下游 `approvedArtifactId` 和旧 artifact 保留，不删除、不覆盖。
- stale 节点带可读 `staleReason`。
- 未开始或未确认的下游节点不被误标 stale。

## 2. 可复用方案调研

继续复用 Stage 1-3 的架构边界：

- Prisma transaction：同一次 approve 中更新上游确认和下游 stale。
- `WorkflowNode.upstreamNodeKeysJson`：作为依赖图来源。
- `WorkflowRepository`：封装节点依赖查询与状态更新。

参考：

- <https://www.prisma.io/docs/orm/prisma-client/queries/transactions>

## 3. 复用、适配与必要自研

复用：

- 复用 `WorkflowNode.status=stale` 和 `staleReason` 字段。
- 复用 `upstreamNodeKeysJson` 判断依赖关系。

适配：

- `approveArtifact(projectId, artifactId)` 在批准目标 artifact 后，查找同项目中 `upstreamNodeKeysJson` 包含目标 nodeKey 的节点。
- 只标记当前 `status=approved` 且存在 `approvedArtifactId` 的下游节点。

自研：

- `markDownstreamNodesStale(projectId, upstreamNodeKey, reason)` repository helper。
- stale reason 文案保持后端内部清晰，前端可映射为教师可读提示。

## 4. Stage 4 开发方案

### 服务能力

增强 `approveArtifact`：

1. 批准目标 artifact。
2. 将目标 node 设为 approved。
3. 查找依赖目标 nodeKey 的下游节点。
4. 对已 approved 的下游节点更新：
   - `status=stale`
   - `staleReason=上游「{nodeTitle}」已确认新版本，需要重新检查。`
5. 保留下游 `approvedArtifactId`。

### API 合同

不新增 API；snapshot 中现有 nodes 会反映 stale 状态。

## 5. 风险与回退

| 风险 | 控制方式 | 回退方式 |
| --- | --- | --- |
| 未开始节点被误标 stale | 只更新 `status=approved` 且有 approvedArtifactId 的节点 | 测试覆盖未确认下游 |
| 下游内容丢失 | 不改 artifact，不清 approvedArtifactId | 测试检查旧 artifact 保留 |
| stale 传播过深 | Stage 4 只做直接下游 | 后续阶段再做递归传播 |

## 6. Stage 4 验证标准

- `npm run test:stage1` 通过。
- `npm run test:stage2` 通过。
- `npm run test:stage3` 通过。
- `npm run test:stage4` 通过。
- `npm run build` 通过。
- 真实 API smoke 覆盖上游新版本确认后下游 node stale。
- 自审或独立审查完成并处理意见。
- 提交并 push 到 `origin/feature/mvp-backend-workflow-lite`。
