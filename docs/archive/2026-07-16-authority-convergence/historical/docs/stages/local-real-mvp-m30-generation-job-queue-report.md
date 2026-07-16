# Local Real MVP M30 Generation Job Queue Report

日期：2026-07-07

## 1. 阶段目标

M30 目标是把 PPTX、图片和视频真实生成从单次 route 内的临时执行，推进到有持久化任务记录、状态恢复、失败记录和后续 worker 接管边界的本地长任务队列基础。

本阶段不引入 Redis、BullMQ、后台守护进程或分布式队列。当前实现仍保持 inline 执行 provider，以维持 M27 已验证的教师浏览器联动体验；新增的是持久化 job 状态机和读取接口。

## 2. 本阶段变更

数据模型：

- 新增 `GenerationJob` 模型。
- `Project` 新增 `generationJobs` 关系。
- `scripts\init-sqlite-schema.mjs` 新增 `GenerationJob` 表和索引初始化。

服务层：

- 新增 generation job 类型、状态和记录结构。
- `ProjectSnapshot` 增加 `generationJobs`。
- repository/service 新增 `createGenerationJob`、`startGenerationJob`、`finishGenerationJob`、`failGenerationJob`、`getGenerationJobs`。
- `getProjectSnapshot` 返回当前项目任务列表，支持刷新后恢复状态。
- 任务读取和状态更新继续经过 M29 actor 项目访问边界。

Route：

- 新增 `GET /api/workbench/projects/[projectId]/generation-jobs`。
- `POST /coze-ppt`、`POST /image`、`POST /video` 改为创建 job、启动 job、调用真实生成 adapter、保存 artifact、完成或失败 job。
- route 成功响应保留既有 `artifact` 字段，同时返回 `job`，避免破坏浏览器联动。

## 3. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage30-generation-job-queue.test.ts --maxWorkers=1` | 通过；1 file passed；4 tests passed |
| `npm test` | 通过；Node 45 tests passed；Vitest 23 files / 88 tests passed |
| `npm run build` | 通过；Prisma generate、Next 编译、TypeScript 和静态页面生成均通过；仍有 1 条既有 Turbopack output tracing warning |
| `npm run test:e2e:stage7` | 通过；Chromium desktop 1 passed，两个 browser context 刷新后保持各自项目 |
| `node scripts\run-stage27-e2e.mjs` | 通过；Chromium desktop 1 passed，真实生成入口、下载和材料包联动不回归 |

## 4. 审查结论

M30 已完成本地真实生成任务队列基础：

- PPTX、图片和视频真实生成都会写入持久化任务。
- 任务具备 `queued -> running -> succeeded/failed` 状态推进。
- 成功任务记录结果 artifact。
- 失败任务记录错误摘要、尝试次数和完成时间。
- snapshot 和 generation-jobs route 可读取任务列表。
- 跨 actor 不能读取他人项目任务。
- M27 浏览器真实生成联动未被破坏。

当前不能表述为：

- 已具备独立后台 worker。
- 已接入 Redis、BullMQ、云队列或分布式锁。
- 已具备生产级任务调度、退避重试、任务取消、并发限流或队列监控。
- 已完成用户可见进度条、失败重试按钮或任务详情 UI。

## 5. 剩余风险

- 当前 route 仍 inline 执行 provider，长视频或慢速 PPT 生成仍受单次 HTTP 请求生命周期影响。
- job 与 artifact 保存暂未做跨表强事务编排，极端异常下可能需要后续 repair 或 worker reconcile。
- 失败摘要只保留脱敏错误信息，不保留完整 provider 响应；这符合安全边界，但排障时可能需要服务端临时受控日志。
- 生产部署前仍需补环境检查、启动 runbook、任务重试策略和正式认证边界。

## 6. 下一阶段建议

优先进入生产部署准备阶段：

- 补本地到上线前的环境检查脚本和 runbook。
- 明确 `ARTIFACT_STORAGE_ROOT`、SQLite/数据库、provider env、端口、构建 warning 和回滚策略。
- 再规划公网认证升级和 WebKit/客户端 exe 验证。
