# Backend Workflow Lite Stage 7 Test Plan

日期：2026-07-07

## 1. 测试目标

Stage 7 测试验证整条 Backend Workflow Lite 主线的 API 合同可交给前端、Runtime 和 E2E 主线使用：

- 项目创建和 snapshot 恢复。
- 消息保存。
- artifact 保存、读取、approve、regenerate。
- approved inputs 读取。
- AgentRun start / finish。
- 409 冲突合同。
- 两个项目数据不串。

## 2. 合同回归测试

### T1：主线 happy path route envelope

步骤：

1. `POST /api/workbench/projects`
2. `POST /messages`
3. `POST /artifacts`
4. `POST /artifacts/[artifactId]/approve`
5. `GET /approved-inputs?nodeKey=lesson_plan`
6. `POST /artifacts/[artifactId]/regenerate`
7. `POST /agent-runs`
8. `POST /agent-runs/[runId]/finish`
9. `GET /snapshot`

期望：

- 每个 route 返回稳定 envelope。
- snapshot 包含 project、messages、nodes、artifacts、agentRuns。

### T2：冲突合同

步骤：

1. 对已完成 run 再次 finish。
2. 对过期 latest version 进行 regenerate。

期望：

- 两者都返回 409。

### T3：项目隔离

步骤：

1. Project A 写 message/artifact/run。
2. Project B 写独立 message。
3. 读取两个 snapshot。

期望：

- Project B 不出现 Project A message/artifact/run。

## 3. 集中验收命令

```powershell
$env:VITEST_MAX_WORKERS="2"; npm run test:stage1
$env:VITEST_MAX_WORKERS="2"; npm run test:stage2
$env:VITEST_MAX_WORKERS="2"; npm run test:stage3
$env:VITEST_MAX_WORKERS="2"; npm run test:stage4
$env:VITEST_MAX_WORKERS="2"; npm run test:stage5
$env:VITEST_MAX_WORKERS="2"; npm run test:stage6
$env:VITEST_MAX_WORKERS="2"; npm run test:stage7
npm run build
git diff --check
```
