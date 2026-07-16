# Backend Merge Readiness Plan

日期：2026-07-07

## 1. 当前阶段目标

本阶段不是继续开发 `Backend Workflow Lite`，而是在该主线已完成并推送后，做合并前收口与下一条后端主线规划。

本阶段只做：

- 只读核对当前分支、本地工作区和远端对齐状态。
- 对照 `docs/contracts/backend-workflow-lite-api.md` 梳理 main 合并前关注点。
- 输出合并前 readiness report。
- 规划下一条后端主线，覆盖生产数据库迁移、多用户隔离、运行队列和真实 runtime 调用入口。
- 提交并 push 文档到当前分支。

本阶段不做：

- 不合并 `main`。
- 不改其他 worktree。
- 不运行真实 provider。
- 不删除文件。
- 不重复 Backend Workflow Lite 已完成实现。

## 2. 可复用依据

复用当前分支已经形成的权威材料：

- API 合同：`docs/contracts/backend-workflow-lite-api.md`
- Stage 1-7 收尾证据：`docs/stages/backend-workflow-lite-stage*-closeout.md`
- Prisma schema：`prisma/schema.prisma`
- 测试脚本：`package.json`
- API routes：`src/app/api/workbench/projects/**`

复用工程方法：

- 合并前先查分支状态和远端状态，不凭旧聊天判断。
- 合同、数据库、测试、lint、legacy 文件风险分开列。
- 下一主线按阶段拆，不把生产数据库、队列、真实 runtime 和多用户隔离混成一个大任务。

## 3. 合并前核对方案

### 3.1 分支与工作区

执行：

```powershell
git fetch origin
git status --short --branch
git branch -vv
git log --oneline origin/main..HEAD
git diff --name-status origin/main..HEAD
```

目标：

- 当前分支与 `origin/feature/mvp-backend-workflow-lite` 对齐。
- 工作区无未提交改动。
- 明确本分支相对 `origin/main` 的提交和文件范围。

### 3.2 API 合同

核对：

- `docs/contracts/backend-workflow-lite-api.md` 是否覆盖全部 workbench route。
- `GET /snapshot` 是否仍是前端刷新恢复主入口。
- `GET /approved-inputs` 是否仍是 Runtime 读取上游确认输入的主入口。
- `POST /agent-runs` 和 `POST /agent-runs/[runId]/finish` 是否仍提供运行状态真源。
- 409 冲突合同是否包含 duplicate finish 与 stale regenerate。

### 3.3 数据库与 Prisma

核对：

- 当前 datasource 是 SQLite。
- 当前使用 `prisma db push`，不是 migration。
- `Artifact` 目前只有 `@@index([projectId, nodeKey, version])`，没有数据库级唯一约束。
- `.env`、`dev.db`、`src/generated/prisma` 不进入提交。

### 3.4 测试与 lint

核对：

- Stage 1-7 测试脚本是否存在。
- `npm run build` 是否仍是构建门禁。
- `npm run lint` 当前脚本是否可用，或是否需要在合并前修正。

### 3.5 Legacy 与敏感文件

核对：

- `SHANHAIEDU_LEGACY_RETROSPECTIVE.md` 是否在当前树中。
- `docs/private-api-ledger.md` 是否在当前树中。
- 合并前必须由主 Codex 判断这些文件是否允许进入 `main`。
- 不在本文档中摘录任何私密台账内容。

## 4. 下一条后端主线建议

建议主线名称：

```text
Production Backend Foundation
```

建议分支：

```text
feature/production-backend-foundation
```

目标：

把当前 Backend Workflow Lite 从 MVP 本地状态真源推进到可试运行的生产后端基础，覆盖生产数据库迁移、多用户隔离、运行队列和真实 runtime 调用入口，但仍不在前端组件中硬接 provider。

## 5. 下一后端主线阶段拆分

### Stage 1：生产数据库迁移计划与迁移骨架

交付：

- Postgres 迁移方案。
- Prisma migration 策略。
- SQLite 开发态与 Postgres 试运行态差异表。
- 数据备份和回滚 runbook。

验收：

- migration 能在空库初始化。
- 不再依赖破坏性 `prisma db push` 作为合并门禁。

### Stage 2：数据库约束与数据完整性

交付：

- `(projectId,nodeKey,version)` 数据库级唯一约束。
- AgentRun 状态枚举约束或等价 guard。
- projectId 外键和级联策略复核。

验收：

- 重复 artifact version 写入被数据库拒绝。
- 跨项目 artifact/run 操作继续 404。

### Stage 3：多用户隔离模型

交付：

- User / ownerId / membership 最小模型。
- Project 按 owner 或 member 隔离。
- API 层隔离策略文档。

验收：

- 用户 A 无法读取用户 B 项目 snapshot。
- 单用户本地开发仍可通过 dev identity 运行。

### Stage 4：运行队列最小模型

交付：

- AgentRun 从同步记录扩展为 queued / running / succeeded / failed。
- 最小 job queue 接口，不绑定具体 provider。
- 重试次数、取消和超时字段设计。

验收：

- queued run 可恢复。
- 超时 run 可进入 failed 或 timeout 状态。

### Stage 5：Runtime 调用入口边界

交付：

- `AgentRuntime` server-side interface。
- Deterministic runtime 保留为测试实现。
- 真实 runtime adapter 入口只接服务端，不进 React 组件。

验收：

- 无真实 provider key 时测试仍稳定。
- Runtime 成功写 artifact + finish run succeeded。
- Runtime 失败 finish run failed。

### Stage 6：事件与轮询合同

交付：

- `GET snapshot` 继续作为恢复真源。
- 运行态轮询 endpoint 或事件 endpoint 设计。
- 前端刷新和运行中状态同步合同。

验收：

- 前端可通过轮询恢复 run 状态。
- 断线后 snapshot 仍可恢复完整状态。

### Stage 7：生产配置与密钥边界

交付：

- 环境变量白名单。
- 本地、测试、试运行配置示例。
- 密钥读取只在 server/runtime 层。

验收：

- 敏感值不进入日志、文档、commit。
- 无密钥时 deterministic path 可用。

### Stage 8：集成验收与合并准备

交付：

- Postgres 初始化验证。
- 多用户隔离 smoke。
- Runtime queue smoke。
- 主线 closeout 和 merge readiness report。

验收：

- 测试、构建、敏感扫描、diff check 通过。
- 明确可否合并 main。

## 6. 成功标准

本阶段成功标准：

- 两份指定文档已产出。
- 文档覆盖 API 合同、数据库/Prisma、测试、lint、legacy 文件风险。
- 下一后端主线不超过 10 个阶段。
- 当前分支提交并 push。
- 不合并 main，不改其他 worktree，不运行 provider，不删除文件。
