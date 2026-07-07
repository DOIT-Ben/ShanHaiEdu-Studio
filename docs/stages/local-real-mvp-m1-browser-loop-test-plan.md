# Local Real MVP M1 Browser Loop Test Plan

日期：2026-07-07

## 1. 测试目标

M1 测试目标是在本地真实浏览器中验证最小 MVP 闭环：教师能新建项目、输入一句话需求、看到需求规格产物、确认产物，并在刷新后恢复状态。

## 2. 前置条件

- M0 `npm test` 通过。
- M0 `npm run build` 通过。
- M0 `npm run test:e2e:stage2:preflight` 通过。
- 已执行 `npm ci` 或本地依赖已完整安装。

## 3. 集中验收命令

### M1-1：浏览器真实闭环

命令：

```powershell
npm run test:e2e:stage2
```

预期运行方式：

- `scripts\run-stage2-e2e.mjs` 清理 `test-results\stage2-e2e.db` 及 SQLite sidecar 文件。
- 初始化 SQLite schema。
- 设置 `DATABASE_URL=file:./test-results/stage2-e2e.db`。
- 设置 `NEXT_PUBLIC_WORKBENCH_DATA_SOURCE=api`。
- 使用 Playwright Chromium desktop 运行 `tests\e2e\stage2-deterministic.spec.ts`。

通过标准：

- exit 0。
- `creates a project, generates a requirement artifact, approves it, and restores after refresh` 通过。
- 断言覆盖用户消息、assistant 回复、需求规格节点、详情、确认状态和刷新恢复。
- 教师可见工程词扫描结果为空。
- 通过路径截图保存到 Playwright output。

### M1-2：资源残留检查

命令：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'vitest|jest|playwright' } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```

通过标准：

- 不存在本轮遗留的 Vitest、Jest 或 Playwright worker。

### M1-3：提交前检查

命令：

```powershell
git diff --check
git status --short
```

通过标准：

- 无空白错误。
- 只包含 M1 授权范围内的文档和必要修复。

## 4. 失败处理

- 若 dev server 未启动或端口冲突，先记录端口和错误日志，再用当前脚本支持的环境变量调整端口。
- 若 UI 选择器失效，先确认用户可见文案是否仍符合教师体验，再决定修测试还是修 UI。
- 若刷新恢复失败，优先定位 API snapshot、SQLite 持久化或 controller applySnapshot 边界，不把前端临时状态当修复目标。
- 若工程词红线失败，优先修用户可见文案，不放宽红线。
- 连续两轮排障未通过时，收敛为已知事实、失败点和下一步最小动作。
