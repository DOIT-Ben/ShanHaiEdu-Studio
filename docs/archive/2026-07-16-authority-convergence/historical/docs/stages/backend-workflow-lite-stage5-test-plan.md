# Backend Workflow Lite Stage 5 Test Plan

日期：2026-07-07

## 1. 测试目标

Stage 5 测试验证 AgentRun 和失败恢复：

- start run 会写入 AgentRun 并把 node 设为 in_progress。
- failed run 会写 errorMessage、finishedAt，并把 node 设为 failed。
- failed 不删除旧 approved artifact，不清空 approvedArtifactId。
- succeeded run 不自动批准节点。
- 跨项目 finish run 被拒绝。

## 2. 红绿测试清单

### T1：start run 写入 running 状态

步骤：

1. 创建项目。
2. 对 `lesson_plan` start AgentRun。
3. 读取 snapshot。

期望：

- agentRuns 包含 running run。
- lesson_plan node status 为 in_progress。

### T2：fail run 写入失败并保留旧 artifact

步骤：

1. 创建并确认 lesson_plan artifact。
2. start lesson_plan run。
3. finish failed。
4. 读取 snapshot。

期望：

- run status failed。
- run errorMessage 有值。
- lesson_plan node failed。
- lesson_plan approvedArtifactId 仍指向旧 artifact。
- 旧 artifact 仍 isApproved=true。

### T3：succeeded run 不自动 approved

步骤：

1. start `ppt_draft` run。
2. finish succeeded。
3. 读取 snapshot。

期望：

- run succeeded。
- ppt_draft node 不自动 approved。

### T4：跨项目 run finish 被拒绝

步骤：

1. Project A start run。
2. Project B 尝试 finish Project A run。

期望：

- 操作失败。
- Project B snapshot 不出现 Project A run。

## 3. 集中验收命令

```powershell
$env:VITEST_MAX_WORKERS="2"; npm run test:stage1
$env:VITEST_MAX_WORKERS="2"; npm run test:stage2
$env:VITEST_MAX_WORKERS="2"; npm run test:stage3
$env:VITEST_MAX_WORKERS="2"; npm run test:stage4
$env:VITEST_MAX_WORKERS="2"; npm run test:stage5
npm run build
git diff --check
```
