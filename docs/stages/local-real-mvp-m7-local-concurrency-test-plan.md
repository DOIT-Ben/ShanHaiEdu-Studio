# Local Real MVP M7 Local Concurrency Test Plan

日期：2026-07-07

## 1. 测试目标

M7 测试目标是验证两个本地浏览器上下文下的项目隔离和状态恢复。测试必须证明项目、消息、产物和当前项目选择不会互相串写。

## 2. 集中验收命令

### M7-1：单元与合同测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- 既有 Stage 6 并发/隔离测试通过。
- 既有 M0-M6 合同仍通过。
- 失败数为 0。

### M7-2：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Prisma Client、Next.js 编译、TypeScript 和静态页面生成均通过。

### M7-3：主链路浏览器回归

命令：

```powershell
npm run test:e2e:stage2
```

通过标准：

- exit 0。
- M1-M5 单项目主链路仍通过。

### M7-4：双上下文本地隔离

命令：

```powershell
npm run test:e2e:stage7
```

通过标准：

- exit 0。
- 两个 browser context 分别创建不同项目。
- 刷新后各自恢复当前项目。
- A 看不到 B 的原始需求，B 看不到 A 的原始需求。
- 两个项目均能生成各自需求规格待确认产物。

### M7-5：资源残留检查

命令：

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'vitest|jest|playwright' } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```

通过标准：

- 不存在本轮遗留的 Vitest、Jest 或 Playwright worker。

### M7-6：提交前检查

命令：

```powershell
git diff --check
git status --short
```

通过标准：

- 无空白错误。
- 只包含 M7 授权范围内的文档、测试、runner 和必要修复。

## 3. 失败处理

- 若两个 context 刷新后都落到同一项目，优先检查当前项目持久化 key 和项目选择逻辑。
- 若 A 页面出现 B 的需求，优先检查 snapshot/projectId 过滤。
- 若 SQLite 出现锁冲突，记录迁移 PostgreSQL 条件，不直接扩大数据库迁移范围。
- 若新增 E2E 不稳定，先用严格等待和明确响应条件收敛，不放宽隔离断言。
