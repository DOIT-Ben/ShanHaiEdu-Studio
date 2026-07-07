# Local Real MVP M30 Generation Job Queue Test Plan

日期：2026-07-07

## 1. 测试目标

M30 测试目标是证明真实生成任务具备本地持久化队列基础：任务能创建、启动、成功、失败、恢复列表，并且 route 触发 PPTX、图片和视频真实生成时能写入任务状态，不破坏现有浏览器联动。

## 2. TDD 红灯用例

### M30-1：service 任务状态机

命令：

```powershell
node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage30-generation-job-queue.test.ts --maxWorkers=1
```

红灯标准：

- `createGenerationJob` 创建 `queued` 任务。
- `startGenerationJob` 把任务推进到 `running`，并增加 attempts。
- `finishGenerationJob` 把任务推进到 `succeeded`，记录 resultArtifactId 和 finishedAt。
- `failGenerationJob` 把任务推进到 `failed`，记录 errorMessage、attempts 和 finishedAt。
- 非 owner actor 不能读取另一个项目的 generation jobs。
- `getProjectSnapshot` 返回 `generationJobs`，刷新后可恢复任务状态。

### M30-2：route 任务状态

同一命令内覆盖：

- `POST /coze-ppt` 成功时响应包含 `job.status = "succeeded"` 和 `artifact`。
- `POST /image` 或 `POST /video` 失败时响应仍不泄露 provider 细节，但 `GET /generation-jobs` 能读到 failed job。
- `GET /generation-jobs` 受 M29 actor 权限保护。

## 3. 集中验收命令

### M30-3：全量测试

命令：

```powershell
npm test
```

通过标准：

- exit 0。
- Node 测试和 Vitest 测试失败数为 0。

### M30-4：构建

命令：

```powershell
npm run build
```

通过标准：

- exit 0。
- Prisma generate、Next 编译、TypeScript、静态页面生成均通过。
- 如仍有 Turbopack output tracing warning，记录来源，不把 warning 包装成已消除。

### M30-5：浏览器隔离回归

命令：

```powershell
npm run test:e2e:stage7
```

通过标准：

- 两个 browser context 分别创建项目。
- 项目、消息、产物、刷新恢复不串。

### M30-6：真实生成浏览器回归

命令：

```powershell
node scripts\run-stage27-e2e.mjs
```

通过标准：

- 教师真实生成入口、刷新、PPTX/PNG/MP4 下载和材料包联动不回归。

### M30-7：提交前审查

命令：

```powershell
git diff --check
git check-ignore -v .env .tmp
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object { $_.CommandLine -like '*local-real-mvp-mainline*' -and $_.CommandLine -match 'vitest|jest|playwright|next dev' }
```

通过标准：

- 无空白错误。
- `.env`、`.tmp` 不进入 git。
- 文档、测试、脚本和服务端代码不包含真实 key、token、私有端点、签名 URL 或任务标识值。
- 当前 worktree 无残留测试/dev 进程。

## 4. 失败处理

- 如果任务成功但 artifact 不存在，优先检查 route 是否在保存 artifact 后再 finish job。
- 如果任务失败时没有落库，优先检查 catch 分支是否调用 `failGenerationJob`。
- 如果跨 actor 能看到任务，优先检查 `getGenerationJobs` 是否先执行项目访问判断。
- 如果 Stage27 失败，优先确认 route 响应仍包含既有 `artifact` 字段。
