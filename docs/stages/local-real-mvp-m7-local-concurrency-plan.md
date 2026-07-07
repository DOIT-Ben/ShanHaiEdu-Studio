# Local Real MVP M7 Local Concurrency Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M7 的核心需求是验证本地 MVP 在 1-2 人试用规模下不会串项目、串消息、串节点状态或串产物。M7 不做完整账号系统，不做权限隔离，也不把本地 SQLite 试用能力包装成生产级多人协作。

M7 最小闭环为：

```text
浏览器上下文 A 新建项目并输入需求 A
浏览器上下文 B 新建项目并输入需求 B
两个项目同时存在
A 只看到 A 的消息和产物
B 只看到 B 的消息和产物
分别刷新后仍保持各自当前项目
```

## 2. 可复用方案调研

当前主线已有可复用能力：

- `WorkflowRepository` 所有项目、消息、节点、产物均带 `projectId`。
- Stage 6 后端测试已覆盖 artifact 版本计数按项目隔离、重复 finish 冲突和 stale regenerate。
- Playwright 已支持创建独立 browser context。
- Stage 2 E2E 已验证单上下文完整 M1-M5 路径。
- E2E runner 已使用独立 SQLite 数据库 `test-results/stage2-e2e.db`，不会污染 `dev.db`。

不做：

- 不新增账号、登录、角色权限。
- 不做 WebSocket/实时协作。
- 不引入 PostgreSQL；SQLite 是否足够先由本阶段证据判断。

## 3. 复用、适配和必要自研

复用：

- 复用现有 `POST /projects`、`POST /messages`、`GET /snapshot` 路径。
- 复用左侧项目列表和当前项目恢复能力。
- 复用 Playwright browser context 作为本地两个用户或两个浏览器上下文近似。

适配：

- 新增 M7 E2E：两个 browser context 分别创建项目并发送不同需求。
- 验证两个上下文刷新后不会互相覆盖当前项目。
- 验证可见文本中不出现对方需求。
- 验证两个项目都能进入需求规格待确认状态。

必要自研：

- 新增 `tests\e2e\stage7-local-concurrency.spec.ts`。
- 新增 `scripts\run-stage7-e2e.mjs`，复用 Stage 2 runner 的独立数据库和 dev server 模式，但只运行 M7 测试。
- 增加 package script 方便集中验收。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M7 阶段规划和测试定义。
2. 写失败测试：两个 browser context 创建不同项目并刷新恢复后互不串数据。
3. 若测试失败，定位是前端 current project 状态、localStorage key、后端项目列表排序还是 API 过滤问题。
4. 做最小修复。
5. 集中验收：`npm test`、`npm run build`、`npm run test:e2e:stage2`、`npm run test:e2e:stage7`、worker 残留检查。
6. 写 M7 report 并提交。

主要风险：

- 当前无账号系统，两个上下文共享同一个项目列表是预期；M7 只验证“当前项目和产物不串”，不验证权限隔离。
- SQLite 只能证明本地 1-2 人试用规模，不代表生产并发能力。
- 如果当前项目选择保存在浏览器 localStorage，全局 key 可能导致同浏览器不同 tab 互相覆盖；两个独立 context 应保持隔离。

验证标准：

- 两个浏览器上下文各自创建项目后，刷新仍保留自己的当前项目。
- A 页面不可见 B 的原始需求；B 页面不可见 A 的原始需求。
- A/B 各自需求规格产物可见且状态正确。
- 后端项目、消息、产物按项目隔离。
- 如果 SQLite 支撑本地试用，没有锁冲突或数据串写，则记录继续使用 SQLite；若出现锁冲突，记录迁移 PostgreSQL 条件。
