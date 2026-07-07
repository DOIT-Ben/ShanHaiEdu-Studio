# Backend Workflow Lite Stage 4 Closeout

日期：2026-07-07

## 1. 阶段目标

Stage 4 目标是完成上游确认版本变化后的直接下游 stale 传播：下游旧内容必须保留，但状态必须提示需重审。

## 2. 已完成内容

- 增强 `approveArtifact`：
  - 批准目标 artifact 后查找直接依赖该 nodeKey 的下游节点。
  - 只把 `status=approved` 且有 `approvedArtifactId` 的直接下游节点标记为 `stale`。
  - 保留下游 `approvedArtifactId`。
  - 写入教师可读 `staleReason`，使用节点标题而不是工程 key。
- 新增 Stage 4 测试，覆盖：
  - 上游新版本确认后已确认直接下游 stale。
  - 未确认下游不被误标 stale。
  - stale 不删除旧 artifact。
  - Stage 4 只做直接下游，不递归污染更下游节点。
  - 审查修复：stale 节点重新确认后清空 `staleReason`。
  - 审查修复：重复确认同一个上游 artifact 不重复污染下游 stale。
  - 审查修复：staleReason 文案去掉依赖图术语，使用 `「需求规格」已更新确认，需要重新检查相关内容。`。

## 3. 集中验收

```text
npm run test:stage4
结果：通过，1 个测试文件，6 个用例，失败数 0。

npm run test:stage1
结果：通过，1 个测试文件，4 个用例，失败数 0。

npm run test:stage2
结果：通过，1 个测试文件，6 个用例，失败数 0。

npm run test:stage3
结果：通过，1 个测试文件，7 个用例，失败数 0。

npm run build
结果：通过，Next.js production build exit 0。

真实 API smoke
结果：通过。
验证：确认 requirement_spec v1 -> 确认 lesson_plan -> regenerate/approve requirement_spec v2 -> snapshot。
返回：lessonNodeStatus=stale，lessonArtifactStillApproved=true，staleReason=「需求规格」已更新确认，需要重新检查相关内容。
```

## 4. 未完成边界

Stage 4 不声明完成以下能力：

- 递归 stale 传播。
- 并发版本冲突 guard。
- 失败恢复和 AgentRun 状态闭环。
- Runtime 自动生成 artifact。

这些能力进入后续阶段继续推进。

## 5. 下一阶段建议

Stage 5 进入失败恢复与 AgentRun：

- Runtime/服务写入 AgentRun。
- 失败时记录可恢复状态。
- snapshot 返回失败 run 和受影响 node。
- 教师可见错误映射由前端/Runtime 主线消费。
