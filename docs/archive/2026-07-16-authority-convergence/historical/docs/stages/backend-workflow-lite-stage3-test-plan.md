# Backend Workflow Lite Stage 3 Test Plan

日期：2026-07-07

## 1. 测试目标

Stage 3 测试验证 artifact 版本和 regenerate 规则：

- regenerate 不覆盖旧版本。
- regenerate 创建新版本且默认未确认。
- 下游输入在新版本未确认前仍使用旧 approved artifact。
- approve 新版本后，旧版本取消 approved，node 指向新版本。
- 跨项目不能读取、重做或确认其他项目 artifact。

## 2. 红绿测试清单

### T1：regenerate 创建新版本并保留旧版本

步骤：

1. 创建项目。
2. 保存并确认 `requirement_spec` v1。
3. 基于 v1 regenerate。
4. 读取 artifacts。

期望：

- artifacts 中有 v1 和 v2。
- v1 markdown 保留。
- v2 version=2。
- v2 `isApproved=false`。

### T2：新版本未确认前，下游输入仍使用旧 approved

步骤：

1. 创建并确认 v1。
2. regenerate v2。
3. 查询 `lesson_plan` approved inputs。

期望：

- 返回 v1。
- 不返回 v2。

### T3：approve 新版本会切换确认指针

步骤：

1. 创建并确认 v1。
2. regenerate v2。
3. approve v2。
4. 读取 snapshot。

期望：

- v1 `isApproved=false`。
- v2 `isApproved=true`。
- node `approvedArtifactId=v2.id`。
- approved inputs 返回 v2。

### T4：跨项目 artifact 不能读取或 regenerate

步骤：

1. Project A 创建 artifact。
2. Project B 尝试读取/regenerate Project A artifact。

期望：

- 操作失败。
- Project B 不出现 Project A artifact。

## 3. 集中验收命令

```powershell
$env:VITEST_MAX_WORKERS="2"; npm run test:stage1
$env:VITEST_MAX_WORKERS="2"; npm run test:stage2
$env:VITEST_MAX_WORKERS="2"; npm run test:stage3
npm run build
git diff --check
```
