# Backend Workflow Lite Stage 3 Closeout

日期：2026-07-07

## 1. 阶段目标

Stage 3 目标是完成 artifact regenerate 与版本规则：重做必须创建新版本并保留旧版本，确认某一版本后下游输入必须切换到该版本，同时同项目同节点只能有一个当前 approved artifact。

## 2. 已完成内容

- 新增 `getArtifact(projectId, artifactId)`。
- 新增 `regenerateArtifact(projectId, artifactId, input)`。
- 增强 `approveArtifact`：同项目同 nodeKey 下先取消其它 approved artifact，再批准目标版本。
- 新增 API route：
  - `GET /api/workbench/projects/[projectId]/artifacts/[artifactId]`
  - `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/regenerate`
- 新增 Stage 3 测试，覆盖：
  - regenerate 创建 v2 且保留 v1。
  - v2 未确认前下游输入仍使用 v1。
  - approve v2 后取消 v1 approval，并切换 node approved 指针。
  - 跨项目读取和 regenerate 拒绝。
  - artifact detail/regenerate route 正常与 404 envelope。
  - 审查修复：regenerate 即使收到 `status=approved` 入参，也强制创建 `needs_review` 未确认版本；approved-inputs route 在新版本确认前仍返回旧 approved 版本。

## 3. 集中验收

```text
npm run test:stage3
结果：通过，1 个测试文件，7 个用例，失败数 0。

npm run test:stage1
结果：通过，1 个测试文件，4 个用例，失败数 0。

npm run test:stage2
结果：通过，1 个测试文件，6 个用例，失败数 0。

npm run build
结果：通过，Next.js production build exit 0。

真实 API smoke
结果：通过。
验证：v1 approve -> regenerate v2 -> approved inputs 仍为 v1 -> approve v2 -> approved inputs 切到 v2。
返回：v2Version=2，v2ApprovedBeforeApprove=false，inputBefore=v1 上游，inputAfter=v2 上游。
```

## 4. 未完成边界

Stage 3 不声明完成以下能力：

- 上游变更后的下游 stale 传播。
- 乐观并发版本冲突 guard。
- 数据库唯一约束层面的 `(projectId,nodeKey,version)` 并发保护；当前 MVP 串行路径由应用事务保证，Stage 6 继续强化。
- AgentRun 失败恢复。
- Runtime 自动生成 artifact。

这些能力进入 Stage 4 之后继续按阶段推进。

## 5. 下一阶段建议

Stage 4 进入上游变更与 stale 传播：

- 当上游节点产生新确认版本后，下游已确认节点应保留内容但标记 stale。
- stale 节点应带 `staleReason`。
- approved inputs 仍可显式读取，但 snapshot 要暴露下游需重审状态。
