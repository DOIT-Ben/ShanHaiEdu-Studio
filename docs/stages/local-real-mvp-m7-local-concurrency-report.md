# Local Real MVP M7 Local Concurrency Report

日期：2026-07-07

## 1. 阶段目标

M7 目标是验证本地 1-2 人试用规模下，两个浏览器上下文不会串项目、串消息、串产物或串当前项目状态。本阶段不做账号系统、不做权限隔离、不做生产级数据库迁移。

## 2. 本轮实现

### 2.1 双上下文浏览器测试

新增 `tests\e2e\stage7-local-concurrency.spec.ts`：

- 创建两个独立 browser context。
- A 上下文创建项目并发送 A 需求。
- B 上下文创建项目并发送 B 需求。
- 验证 A 只看到 A 的消息和需求规格产物。
- 验证 B 只看到 B 的消息和需求规格产物。
- 两个上下文刷新后再次验证各自项目恢复。

### 2.2 Stage 7 E2E runner

新增 `scripts\run-stage7-e2e.mjs`：

- 使用独立 SQLite 测试库 `test-results/stage7-e2e.db`。
- 初始化 schema 后只运行 M7 双上下文隔离测试。
- 复用 API-backed 工作台路径，不污染 `dev.db`。

新增 package script：

- `npm run test:e2e:stage7`

### 2.3 当前项目恢复修复

更新 `src\hooks\useWorkbenchController.ts`：

- 在 `applySnapshot` 时把当前 project id 写入浏览器 localStorage。
- 初始加载项目列表时，优先恢复当前 context 存储的 project id。
- 若存储的 project id 已不存在，则回退到项目列表第一项。
- 若没有项目，则清理存储值。

## 3. TDD 与调试记录

红灯 1：

- Stage 7 首次失败是测试选择器严格模式冲突。
- 原因是同一需求文本同时出现在项目列表摘要和对话气泡中。
- 修复为使用精确对话气泡 locator，不改业务代码。

红灯 2：

- 修正 locator 后，A 上下文刷新后无法看到 A 需求。
- WebServer 日志显示 A 刷新后请求了 B 项目的 snapshot。
- 根因是初始加载默认打开项目列表第一项，未按浏览器上下文恢复当前项目。

绿灯：

- 增加 localStorage 当前项目恢复后，Stage 7 E2E 通过。

## 4. 验收记录

| 命令 | 结果 | 关键证据 |
| --- | --- | --- |
| `npm run test:e2e:stage7` | 红灯后绿灯 | 修复前 A 刷新后打开 B 项目；localStorage 恢复后 Chromium desktop 1 passed |
| `npm test` | 通过 | Node 10 tests passed；Vitest 15 files / 68 tests passed |
| `npm run build` | 通过 | Prisma Client 生成成功；Next.js 编译、TypeScript、静态页面生成均通过 |
| `npm run test:e2e:stage2` | 通过 | Chromium desktop 1 passed；M1-M5 单项目主链路未回归 |
| `npm run test:e2e:stage7` | 通过 | 两个 browser context 分别刷新后仍保持各自项目 |
| worker 残留检查 | 通过 | 未发现 Vitest、Jest 或 Playwright 残留 Node 进程 |
| `git diff --check` | 通过 | 无空白错误；仅有工作区换行提示 |
| M7 变更敏感信息扫描 | 通过 | 未命中密钥、token 或私钥文件特征 |

## 5. SQLite 试用结论

本轮双上下文 E2E 使用独立 SQLite 测试库完成两个项目的创建、消息写入、需求规格生成和刷新恢复，未出现锁冲突或串写。SQLite 可继续支撑当前本地 1-2 人 MVP 试用。

后续迁移 PostgreSQL 的触发条件：

- 多人同时长任务写入出现锁冲突。
- 需要账号级权限隔离。
- 需要远程部署或跨设备共享数据。
- 需要长任务队列、重试和审计日志达到生产级别。

## 6. 风险与边界

- 两个上下文仍共享项目列表，这是无账号本地工作台的预期行为。
- M7 只验证当前项目、消息和产物不串，不提供权限隔离。
- 当前只覆盖 Chromium desktop；窄屏和多浏览器仍待后续专项验证。
- M6 live OpenAI smoke 仍因缺少 `OPENAI_API_KEY` 未通过。

## 7. 审查结论

M7 通过。当前主线已完成本地真实可用 MVP 的 M0-M5 文本主链路、M6 OpenAI smoke 门禁 readiness，以及 M7 本地双上下文隔离验证。M6 live smoke 仍需要真实 OpenAI 凭据后补验。
