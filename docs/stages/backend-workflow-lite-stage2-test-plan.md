# Backend Workflow Lite Stage 2 Test Plan

日期：2026-07-07

## 1. 测试目标

Stage 2 测试验证 Workflow Lite 的最小确认闭环：

- artifact 确认后自身状态变为 approved。
- 对应 WorkflowNode 记录 approved artifact。
- 下游节点只能读取已确认上游 artifact。
- 项目之间不能通过 artifactId 或 nodeKey 串数据。

## 2. 测试边界

本阶段测试：

- `approveArtifact(projectId, artifactId)`。
- `getApprovedInputs(projectId, nodeKey)`。
- API route 对 approve 和 approved-inputs 的最小合同。

本阶段不测试：

- regenerate 版本保留。
- 上游变更 stale 传播。
- 并发版本冲突。
- OpenAI/Runtime 生成质量。

## 3. 红绿测试清单

### T1：approve 会同步更新 artifact 和 node

步骤：

1. 创建项目。
2. 保存 `requirement_spec` artifact。
3. 调用 approve。
4. 读取 snapshot。

期望：

- artifact `status=approved`。
- artifact `isApproved=true`。
- `requirement_spec` node `status=approved`。
- node `approvedArtifactId` 等于 artifact id。

### T2：下游输入只返回已确认上游 artifact

步骤：

1. 创建项目。
2. 保存并确认 `requirement_spec` artifact。
3. 保存但不确认 `textbook_evidence` artifact。
4. 查询 `lesson_plan` approved inputs。

期望：

- 返回 `requirement_spec` artifact。
- 不返回未确认的 `textbook_evidence` artifact。

### T3：确认教材证据后 lesson_plan 输入包含两个上游

步骤：

1. 继续 T2 项目。
2. 确认 `textbook_evidence` artifact。
3. 查询 `lesson_plan` approved inputs。

期望：

- 返回 `requirement_spec` 和 `textbook_evidence` 两个 artifact。

### T4：跨项目 artifact 不能被确认

步骤：

1. 创建 Project A 和 Project B。
2. 在 Project A 保存 artifact。
3. 用 Project B 的 projectId 确认 Project A 的 artifact。

期望：

- 操作失败。
- Project B snapshot 不出现 Project A artifact。

## 4. 集中验收命令

```powershell
$env:VITEST_MAX_WORKERS="2"; npm run test:stage1
$env:VITEST_MAX_WORKERS="2"; npx vitest run src/server/workbench/__tests__/stage2-workflow-lite.test.ts
npm run build
git diff --check
```
