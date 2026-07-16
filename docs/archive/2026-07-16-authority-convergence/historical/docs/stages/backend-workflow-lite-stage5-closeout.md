# Backend Workflow Lite Stage 5 Closeout

日期：2026-07-07

## 1. 阶段目标

Stage 5 目标是完成 AgentRun 与失败恢复状态真源：运行开始、成功、失败都必须持久化；失败时节点进入 failed，但旧产物保持可恢复。

## 2. 已完成内容

- 新增 `startAgentRun(projectId, input)`。
- 新增 `finishAgentRun(projectId, runId, input)`。
- start run 时：
  - 创建 `AgentRun.status=running`。
  - 对应 node 标记 `in_progress`。
- finish failed 时：
  - 写入 `finishedAt` 和 `errorMessage`。
  - 对应 node 标记 `failed`。
  - 保留旧 `approvedArtifactId` 和旧 approved artifact。
- finish succeeded 时：
  - 只结束 run，不自动批准 node。
- 新增 API route：
  - `POST /api/workbench/projects/[projectId]/agent-runs`
  - `POST /api/workbench/projects/[projectId]/agent-runs/[runId]/finish`
- 新增 Stage 5 测试，覆盖 service 和 route 正常/错误合同。
- 审查修复：finish route 只接受 `succeeded` 或 `failed`，非法状态返回 400，不写入失败状态。

## 3. 集中验收

```text
npm run test:stage5
结果：通过，1 个测试文件，7 个用例，失败数 0。

npm run test:stage1
结果：通过，1 个测试文件，4 个用例，失败数 0。

npm run test:stage2
结果：通过，1 个测试文件，6 个用例，失败数 0。

npm run test:stage3
结果：通过，1 个测试文件，7 个用例，失败数 0。

npm run test:stage4
结果：通过，1 个测试文件，6 个用例，失败数 0。

npm run build
结果：通过，Next.js production build exit 0。

git diff --check
结果：通过，exit 0。

真实 API smoke
结果：通过。
验证：确认 lesson_plan 旧 artifact -> start run -> finish failed -> snapshot。
返回：runStatus=failed，nodeStatus=failed，approvedArtifactId 保留，retainedApproved=true。
```

## 4. 审查与处理

独立审查结论：

- P1：finish route 若接受非法 status 会把错误状态传入 service。已修复为只接受 `succeeded` / `failed`，非法状态返回 400，并补充 route-level 测试确认原 running run 和 node in_progress 不被误写。
- P2：`finishAgentRun` 尚未校验 run 是否仍为 running，也未防止旧 run 迟到覆盖当前 node。此项属于并发与隔离强化，不在 Stage 5 最小失败恢复闭环内完成，已作为 Stage 6 首要风险记录。

自审结论：

- Stage 5 新增 API 不接真实 provider，不产生 mock 伪生成。
- failed run 不删除 artifact，不清空 `approvedArtifactId`，满足失败恢复要求。
- succeeded run 不自动 approve，仍保留 Stage 1-4 的 artifact 写入与用户确认边界。
- 跨项目 finish run 通过 projectId 查询隔离，route 返回 404，Project B snapshot 不出现 Project A run。

## 5. 未完成边界

Stage 5 不声明完成以下能力：

- Runtime 自动写入 artifact。
- 失败后自动重试。
- 失败错误的前端教师文案映射。
- 并发 run 冲突 guard。
- run finish 幂等/旧 run 迟到保护；已记录为 Stage 6 并发与隔离强化事项。

这些能力进入后续阶段继续推进。

## 6. 下一阶段建议

Stage 6 进入并发与隔离强化：

- artifact version guard。
- run finish 幂等/重复完成保护。
- projectId isolation API tests。
- SQLite 当前局限记录与 Postgres 迁移准备。
