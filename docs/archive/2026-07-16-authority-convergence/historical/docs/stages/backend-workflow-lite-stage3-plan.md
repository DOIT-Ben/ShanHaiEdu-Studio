# Backend Workflow Lite Stage 3 Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

Stage 2 已完成 artifact 确认和下游 approved inputs。Stage 3 要解决“重做”不是覆盖旧内容，而是生成新版本，并且确认状态必须指向用户选择的版本。

本阶段必须证明：

- regenerate 会保留旧 artifact，创建同 nodeKey 的新版本。
- 新版本默认未确认，不会自动替换下游 approved input。
- approve 某版本后，对应 node 的 `approvedArtifactId` 指向该版本。
- 同一节点只能有一个当前 approved artifact。

## 2. 可复用方案调研

复用 Stage 1/2 已落地方案：

- Prisma transaction 保证同节点版本和确认状态一致。
- Next.js Route Handlers 提供最小 API。
- Service/Repository 继续承载业务边界。

参考：

- <https://www.prisma.io/docs/orm/prisma-client/queries/transactions>
- <https://nextjs.org/docs/app/api-reference/file-conventions/route>

## 3. 复用、适配与必要自研

复用：

- 复用 `Artifact.version`。
- 复用 `Artifact.isApproved`。
- 复用 `WorkflowNode.approvedArtifactId`。

适配：

- `saveArtifact` 当前已经按 nodeKey 自动递增版本；Stage 3 将其明确作为 regenerate 底层机制。
- `approveArtifact` 需要增强为同项目同 nodeKey 先取消其他版本 approval，再批准目标版本。

自研：

- `regenerateArtifact(projectId, artifactId, draft)`：基于旧 artifact 的 nodeKey/kind/title 创建下一版本。
- `GET /api/workbench/projects/[projectId]/artifacts/[artifactId]`：读取单个 artifact。
- `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/regenerate`：生成新版本。

## 4. Stage 3 开发方案

### 服务能力

- `getArtifact(projectId, artifactId)`：按 projectId 和 artifactId 获取 artifact，防止串项目。
- `regenerateArtifact(projectId, artifactId, input)`：
  - 旧 artifact 必须属于 projectId。
  - 新 artifact 继承旧 artifact 的 `nodeKey` 和 `kind`。
  - 新 artifact version = 同项目同 nodeKey 当前最大版本 + 1。
  - 新 artifact `isApproved=false`，status 默认 `needs_review`。
  - 旧 artifact 保留。
- `approveArtifact(projectId, artifactId)`：
  - 同项目同 nodeKey 其他 artifact 取消 `isApproved`。
  - 目标 artifact 设为 approved。
  - node 指向目标 artifact。

### API 合同

| Method | Path | 能力 |
| --- | --- | --- |
| `GET` | `/api/workbench/projects/[projectId]/artifacts/[artifactId]` | 读取单个 artifact |
| `POST` | `/api/workbench/projects/[projectId]/artifacts/[artifactId]/regenerate` | 基于旧 artifact 创建新版本 |

### 文件结构

修改：

- `src/server/workbench/repository.ts`
- `src/server/workbench/service.ts`
- `src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/route.ts`
- `src/app/api/workbench/projects/[projectId]/artifacts/[artifactId]/regenerate/route.ts`

新增：

- `src/server/workbench/__tests__/stage3-artifact-versioning.test.ts`

## 5. 风险与回退

| 风险 | 控制方式 | 回退方式 |
| --- | --- | --- |
| 多版本同时 approved | approve transaction 内先取消同 nodeKey 其他版本 | Stage 3 测试覆盖 |
| regenerate 覆盖旧内容 | 只 create 新 artifact，不 update 旧 artifact | 测试旧版本仍可读取 |
| 下游输入误用未确认新版本 | approved inputs 查询保持 `isApproved=true` | 测试重做后仍返回旧 approved |

## 6. Stage 3 验证标准

- `npm run test:stage1` 通过。
- `npm run test:stage2` 通过。
- `npm run test:stage3` 通过。
- `npm run build` 通过。
- 真实 API smoke 覆盖 regenerate -> approve 新版本 -> approved inputs 更新。
- 独立审查或自审处理完毕。
- 提交并 push 到 `origin/feature/mvp-backend-workflow-lite`。
