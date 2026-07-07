# Local Real MVP M30 Generation Job Queue Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M30 的核心需求是把 PPTX、图片和视频真实生成从“单次 HTTP route 内直接执行”推进到“有持久化任务状态、可刷新恢复、可失败记录、可重试/worker 接管”的本地长任务队列准备状态。

本阶段不是完整生产队列系统，不引入 Redis、BullMQ、云队列、分布式锁或后台进程守护。当前最小成功标准是：

- 每次真实生成动作先创建 `GenerationJob` 持久化任务。
- 任务记录包含项目、源 artifact、任务类型、状态、尝试次数、最大尝试次数、结果 artifact、错误摘要、时间戳。
- route 默认仍保持本地 inline 体验：点击后可直接得到生成后的 artifact，不破坏 M27 浏览器联动。
- route 执行时必须更新任务状态：`queued -> running -> succeeded/failed`。
- 任务失败必须保留错误摘要和尝试次数，不能只返回临时错误。
- snapshot 或 API 能读取项目任务列表，用于刷新后恢复状态。
- 后续独立 worker 可复用同一套 service 方法处理 pending job。
- 任务仍受 M29 actor 项目权限边界保护。

## 2. 可复用方案调研

项目内可复用资产：

- `AgentRun` 已提供运行状态记录思路，但它绑定 workflow node 和文本 runtime，不适合直接承载 PPTX/图片/视频真实素材任务。
- M17/M19/M21 的真实生成 adapter 已封装 provider 调用。
- M26/M27 的教师入口和浏览器联动已能触发真实生成 route。
- M29 的 actor service 边界已可保护所有项目 API。

成熟方案参考：

- BullMQ 官方文档提供 job、retry、backoff、worker 的成熟模型：https://docs.bullmq.io/
- Prisma 官方事务文档说明可用事务保持多表状态一致：https://www.prisma.io/docs/orm/prisma-client/queries/transactions
- Next.js Route Handlers 官方文档说明 route 可返回自定义 Response，但长任务生产化不应长期绑定单次请求生命周期：https://nextjs.org/docs/app/getting-started/route-handlers

本阶段取舍：

- 不引入 BullMQ/Redis。当前目标是本地可用和上线前准备，SQLite 持久化任务表足够支撑单机 MVP 和测试。
- 任务抽象按 BullMQ 的 job/status/retry 思路设计，保留未来替换为 Redis worker 的边界。
- provider 调用仍复用现有 adapter，不重写真实 API 接入。

## 3. 复用、适配和必要自研

复用：

- 继续使用 Prisma/SQLite。
- 继续使用 M29 `createWorkbenchService(..., actor)` 权限边界。
- 继续复用 `generateCozePptFromArtifact`、`generateImageFromArtifact`、`generateVideoFromArtifact`。

适配：

- 新增 `GenerationJob` Prisma 模型。
- `ProjectSnapshot` 增加 `generationJobs`。
- repository/service 增加 `createGenerationJob`、`startGenerationJob`、`finishGenerationJob`、`failGenerationJob`、`getGenerationJobs`。
- 真实生成 route 在 provider 调用前创建 job，成功/失败后更新 job。
- 新增 `GET /api/workbench/projects/[projectId]/generation-jobs` 读取任务状态。

必要自研：

- 任务类型枚举：`pptx`、`image`、`video`。
- 任务状态：`queued`、`running`、`succeeded`、`failed`。
- 任务结果字段和错误摘要字段。
- worker-ready 的最小状态机，禁止重复 finish running 之外的任务。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M30 阶段规划和测试定义。
2. 写红灯测试：service 可创建任务、启动任务、成功任务、失败任务、列表恢复任务，并阻断跨 actor 读取。
3. 写红灯 route 测试：真实生成 route 成功后返回 `job` 与 `artifact`；失败后可从 generation-jobs route 读取 failed job。
4. 修改 Prisma schema 和 SQLite 初始化脚本。
5. 实现 repository/service 任务状态机。
6. 改造 PPTX、图片、视频真实生成 route。
7. 新增 generation-jobs route。
8. 跑 M30 目标测试、全量测试、构建、Stage7、Stage27。
9. 更新 M30 报告和当前状态审计。
10. 提交 M30，不 push。

主要风险：

- route 继续 inline 执行，不等于已经有独立后台 worker；报告必须明确这是队列准备和状态恢复基础。
- 如果任务创建和 artifact 保存不在同一事务，极端情况下可能出现 job succeeded 但 artifact 保存失败；本阶段先以服务层顺序更新和测试覆盖降低风险，生产化再做更强事务编排。
- snapshot 增加字段可能影响前端 mapper，必须保持兼容。
- 真实 provider 错误不能泄露 token、私有端点、签名 URL 或完整响应。

验证标准：

- `node scripts\init-sqlite-schema.mjs; npx vitest run src/server/workbench/__tests__/stage30-generation-job-queue.test.ts --maxWorkers=1` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- `npm run test:e2e:stage7` 通过。
- `node scripts\run-stage27-e2e.mjs` 通过。
- `git diff --check`、`.env/.tmp` ignore 检查、严格脱敏扫描和残留进程检查通过。
