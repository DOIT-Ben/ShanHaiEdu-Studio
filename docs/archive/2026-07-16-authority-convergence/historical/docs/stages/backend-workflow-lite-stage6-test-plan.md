# Backend Workflow Lite Stage 6 Test Plan

日期：2026-07-07

## 1. 测试目标

Stage 6 测试验证并发与隔离强化：

- 同一个 AgentRun 只能 finish 一次。
- 旧 AgentRun 迟到失败不会覆盖新 AgentRun 的 node in_progress。
- route 对重复 finish 返回 409。
- regenerate 可用 expected latest version 拒绝过期写入。
- 不同项目的 artifact version 独立递增，不共享计数。

## 2. 红绿测试清单

### T1：重复 finish 被拒绝

步骤：

1. 创建项目。
2. start `lesson_plan` run。
3. finish failed。
4. 再次 finish succeeded。

期望：

- 第二次 finish 抛出冲突。
- run 保持 failed。
- errorMessage 不被清空。

### T2：旧 run 迟到失败不覆盖新 run

步骤：

1. 创建项目。
2. start run A。
3. start run B。
4. finish run A failed。
5. 读取 snapshot。

期望：

- run A 记录 failed。
- run B 仍 running。
- node 仍 in_progress。

### T3：route 重复 finish 返回 409

步骤：

1. route start run。
2. route finish failed。
3. route 再次 finish failed。

期望：

- 第三步返回 409。
- 返回 error 包含 already finished。

### T4：stale regenerate expected latest version guard

步骤：

1. 创建 artifact v1。
2. regenerate v2。
3. 对 v1 再调用 regenerate，传 `expectedLatestVersion=1`。

期望：

- 操作失败。
- route 返回 409。
- artifacts 仍只有 v1 和 v2。

### T5：项目间 artifact version 隔离

步骤：

1. Project A 创建并 regenerate `requirement_spec` 到 v2。
2. Project B 创建 `requirement_spec`。

期望：

- Project A versions 为 `[1,2]`。
- Project B versions 为 `[1]`。

## 3. 集中验收命令

```powershell
$env:VITEST_MAX_WORKERS="2"; npm run test:stage1
$env:VITEST_MAX_WORKERS="2"; npm run test:stage2
$env:VITEST_MAX_WORKERS="2"; npm run test:stage3
$env:VITEST_MAX_WORKERS="2"; npm run test:stage4
$env:VITEST_MAX_WORKERS="2"; npm run test:stage5
$env:VITEST_MAX_WORKERS="2"; npm run test:stage6
npm run build
git diff --check
```
