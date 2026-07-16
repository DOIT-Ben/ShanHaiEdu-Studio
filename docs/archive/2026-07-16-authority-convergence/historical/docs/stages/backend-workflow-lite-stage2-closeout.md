# Backend Workflow Lite Stage 2 Closeout

日期：2026-07-07

## 1. 阶段目标

Stage 2 目标是完成 Workflow Lite 的最小确认闭环：artifact 被用户确认后，后端真实记录确认状态，并让下游节点读取已确认的上游 artifact。

## 2. 已完成内容

- 新增 `approveArtifact(projectId, artifactId)`。
- 新增 `getApprovedInputs(projectId, nodeKey)`。
- approve 时同步更新：
  - `Artifact.status=approved`
  - `Artifact.isApproved=true`
  - `WorkflowNode.status=approved`
  - `WorkflowNode.approvedArtifactId=artifactId`
- 新增 API route：
  - `POST /api/workbench/projects/[projectId]/artifacts/[artifactId]/approve`
  - `GET /api/workbench/projects/[projectId]/approved-inputs?nodeKey=lesson_plan`
- 新增 Stage 2 测试，覆盖确认、下游输入、双上游输入、跨项目拒绝。
- 根据独立审查意见补充 route-level 合同测试和稳定错误响应：
  - approve route 正常响应 envelope。
  - approved-inputs route 正常响应 envelope。
  - 跨项目 approve 返回 404。
  - 非法 nodeKey 返回 400。

## 3. 集中验收

```text
npm run test:stage2
结果：通过，1 个测试文件，6 个用例，失败数 0。

npm run test:stage1
结果：通过，1 个测试文件，4 个用例，失败数 0。

npm run build
结果：通过，Next.js production build exit 0。

真实 API smoke
结果：通过。
验证：创建项目 -> 保存 requirement_spec artifact -> approve artifact -> 查询 lesson_plan approved inputs。
返回：approvedStatus=approved，approvedFlag=true，inputCount=1，firstInputNode=requirement_spec。
```

## 4. 未完成边界

Stage 2 不声明完成以下能力：

- regenerate 版本保留。
- 当前版本唯一批准守卫。
- 上游变更 stale 传播。
- 并发冲突处理。
- Runtime 自动写入 AgentRun。

这些能力进入 Stage 3 之后继续按阶段推进。

## 5. 下一阶段建议

Stage 3 进入 regenerate 与版本规则：

- 实现 artifact regenerate API。
- regenerate 保留旧版本，创建新版本。
- approve 只批准目标版本，并更新节点当前 approved 指针。
- 为同节点多版本建立当前版本/确认版本的清晰查询规则。
