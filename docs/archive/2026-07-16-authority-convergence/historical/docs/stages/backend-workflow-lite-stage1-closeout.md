# Backend Workflow Lite Stage 1 Closeout

日期：2026-07-07

## 1. 阶段目标

Stage 1 目标是建立后端状态真源与 API 合同骨架，覆盖 `Project`、`ConversationMessage`、`WorkflowNode`、`Artifact`、`AgentRun` 的最小数据模型，并提供项目、消息、artifact 和 snapshot 的保存/读取能力。

## 2. 已完成内容

- 新增 Prisma 7 schema，开发期使用 SQLite，配置通过 `DATABASE_URL` 覆盖。
- 新增 `WorkflowRepository` 和 `WorkbenchService`，把 Prisma 细节隔离在后端业务层。
- 新增默认工作流节点定义，创建项目时初始化 8 个节点。
- 新增 API route：
  - `GET/POST /api/workbench/projects`
  - `GET /api/workbench/projects/[projectId]`
  - `GET/POST /api/workbench/projects/[projectId]/messages`
  - `GET/POST /api/workbench/projects/[projectId]/artifacts`
  - `GET /api/workbench/projects/[projectId]/snapshot`
- 新增 Stage 1 contract tests，覆盖项目创建、消息保存、artifact 保存、snapshot 恢复、双项目隔离。

## 3. 集中验收

```text
npm run test:stage1
结果：通过，1 个测试文件，4 个用例，失败数 0。

npm run build
结果：通过，Next.js production build exit 0。

git diff --check
结果：通过，exit 0。

真实 API smoke
结果：通过。
验证：创建项目 -> 保存消息 -> 保存 requirement_spec artifact -> 读取 snapshot。
snapshot 返回：messageCount=1，artifactCount=1，nodeCount=8。
```

资源检查：

```text
Vitest / Next dev / Playwright 相关残留 node 进程：无。
```

## 4. 未完成边界

Stage 1 不声明完成以下能力：

- artifact approve / regenerate 的真实版本闭环。
- 上游变更后下游 stale 传播。
- 并发版本 guard。
- Agent Runtime 写入真实 run result。
- OpenAI、PPTX、图片、视频生成。

这些能力进入 Stage 2 之后按阶段继续做。

## 5. 下一阶段建议

Stage 2 进入 Workflow Lite 节点推进：

- 实现 `approveArtifact`。
- approved artifact 写入 `WorkflowNode.approvedArtifactId`。
- snapshot 明确返回当前可作为下游输入的 artifact。
- 为 Stage 3 的 regenerate/version guard 预留接口，但不在 Stage 2 伪装完成。
