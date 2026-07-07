# Backend Workflow Lite Stage 4 Test Plan

日期：2026-07-07

## 1. 测试目标

Stage 4 测试验证上游变更后的下游 stale 传播：

- 上游确认新版本后，已确认下游节点标记 stale。
- stale 保留旧 approvedArtifactId。
- 旧下游 artifact 不删除。
- 未确认下游不被标记 stale。

## 2. 红绿测试清单

### T1：确认 requirement_spec 新版本会标记 lesson_plan stale

步骤：

1. 创建项目。
2. 保存并确认 `requirement_spec` v1。
3. 保存并确认 `lesson_plan` v1。
4. regenerate `requirement_spec` v2。
5. approve `requirement_spec` v2。
6. 读取 snapshot。

期望：

- `requirement_spec` node approved。
- `lesson_plan` node stale。
- `lesson_plan.approvedArtifactId` 仍指向旧教案 artifact。
- `lesson_plan.staleReason` 非空。

### T2：未确认下游不被标记 stale

步骤：

1. 创建项目。
2. 保存并确认 `requirement_spec` v1。
3. 保存但不确认 `lesson_plan` v1。
4. regenerate 并确认 `requirement_spec` v2。

期望：

- `lesson_plan` 不变成 stale。

### T3：stale 不删除旧 artifact

步骤：

1. 完成 T1 流程。
2. 读取 artifacts。

期望：

- 旧 lesson_plan artifact 仍存在。
- 旧 lesson_plan artifact 保持 approved。

### T4：直接下游传播，不递归污染未直接依赖节点

步骤：

1. 确认 requirement_spec、lesson_plan、ppt_draft。
2. 确认 requirement_spec 新版本。

期望：

- lesson_plan stale。
- ppt_draft 暂不在 Stage 4 中递归 stale。

## 3. 集中验收命令

```powershell
$env:VITEST_MAX_WORKERS="2"; npm run test:stage1
$env:VITEST_MAX_WORKERS="2"; npm run test:stage2
$env:VITEST_MAX_WORKERS="2"; npm run test:stage3
$env:VITEST_MAX_WORKERS="2"; npm run test:stage4
npm run build
git diff --check
```
