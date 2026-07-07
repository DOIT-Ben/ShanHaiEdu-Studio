# Backend Workflow Lite Stage 1 Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

Backend Workflow Lite 的主线价值是先建立真实 MVP 状态真源，让前端和 Runtime 不再各自依赖 mock。Stage 1 只做后端状态真源与 API 合同骨架，成功后其他主线可以稳定依赖同一批数据形状。

本阶段必须回答四个问题：

- 项目、消息、节点、产物、运行记录保存在哪里。
- 前端如何读取一个项目的完整 snapshot。
- Runtime 如何把生成结果写回消息、节点和 artifact。
- 如何证明两个项目不会串数据。

Stage 1 不追求完整 Workflow Lite 推进规则；approve/regenerate 的完整版本守卫、上游变更后下游 stale、并发覆盖防护放到后续阶段。

## 2. 全主线阶段拆分

原则：每阶段都按“阶段规划文档 -> 阶段测试文档 -> 集中开发 -> 集中测试 -> 修复复测 -> 阶段收尾 -> 提交”推进；阶段完成不等于主线完成。

| 阶段 | 目标 | 主要交付 | 验收重点 |
| --- | --- | --- | --- |
| Stage 1 | 数据模型与 API 合同骨架 | Prisma schema、状态真源 repository、项目/消息/artifact/snapshot API、contract tests | 创建项目、保存读取消息和 artifact、snapshot、双项目隔离 |
| Stage 2 | Workflow Lite 节点推进 | 节点初始化、状态推进、确认动作、基础下游输入选择 | approved artifact 能作为下游输入 |
| Stage 3 | Regenerate 与版本规则 | artifact 版本、旧版本保留、当前版本指针、重做记录 | regenerate 不覆盖旧内容，approve 只批准目标版本 |
| Stage 4 | 上游变更与 stale 传播 | upstream keys、staleReason、下游需重审规则 | 上游变更后下游保留内容并标记需重审 |
| Stage 5 | 失败恢复与 AgentRun | AgentRun 写入、失败状态、教师可理解错误映射 | 失败不丢旧内容，snapshot 能恢复失败态 |
| Stage 6 | 并发与隔离强化 | projectId 全链路隔离、版本 guard、并发 contract tests | 两个项目/两个会话互不覆盖 |
| Stage 7 | 主线收尾与集成合同 | API 合同冻结、交接文档、前端/Runtime 对接说明 | build/test 全绿，可给合并结论 |

## 3. 可复用方案调研

### Next.js Route Handlers

官方 Route Handlers 支持在 `app` 目录通过 `route.ts` 定义 HTTP methods，适合本项目 MVP 先在 Next.js 单体里提供 BFF/API 层。Stage 1 使用 `/api/workbench/.../route.ts`，避免把业务持久化逻辑放进 React 组件。

参考：<https://nextjs.org/docs/app/api-reference/file-conventions/route>

### Prisma

Prisma 提供 schema-first 数据模型、类型化 client 和 migration 流程，适合当前 TypeScript/Next.js 栈。Stage 1 使用 Prisma schema 表达 `Project`、`ConversationMessage`、`WorkflowNode`、`Artifact`、`AgentRun`，后续通过 repository 隔离 Prisma 细节。

参考：

- <https://www.prisma.io/docs/orm/prisma-schema/data-model/models>
- <https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production>

### SQLite / Postgres 开发期方案

开发期先用 SQLite 降低本地启动门槛，schema 字段避免 SQLite 专属能力；生产/试运行切换 Postgres 时通过 Prisma datasource 与 migration 重新生成。业务代码只依赖 repository 和 `DATABASE_URL`，不硬编码数据库路径。

参考：

- <https://www.prisma.io/docs/orm/overview/databases/sqlite>
- <https://www.prisma.io/docs/orm/overview/databases/postgresql>

## 4. 复用、适配与必要自研

复用：

- 复用 Next.js App Router API 约定承载路由。
- 复用 Prisma schema/client 承载数据访问和迁移。
- 复用项目现有 `ArtifactKind`、`ArtifactStatus`、`ProjectStatus` 命名方向，避免前端后端概念分裂。

适配：

- 后端 API 返回前端友好的 `snapshot`，但内部保留数据库字段，不把 `node_id`、`storage`、`provider` 等工程词暴露给普通界面。
- Stage 1 artifact 先保存 Markdown 和结构化 JSON；文件存储接口留到后续阶段，不在业务组件中写死本地路径。

自研：

- `WorkflowRepository`：统一 Project/Message/Node/Artifact/AgentRun 读写边界。
- `WorkbenchService`：把 repository 输出组装成 API contract，避免 route handler 变成业务大文件。
- `createProjectSnapshot`：按 projectId 聚合项目、消息、节点、产物，作为刷新恢复真源。

## 5. Stage 1 开发方案

### 数据模型

新增 Prisma 模型：

- `Project`：项目标题、状态、当前节点、课程字段、创建/更新时间。
- `ConversationMessage`：项目消息、角色、正文、关联 artifact refs。
- `WorkflowNode`：节点 key、标题、状态、已确认 artifact、stale 原因。
- `Artifact`：节点产物、类型、状态、摘要、Markdown、结构化内容、版本、确认状态。
- `AgentRun`：运行记录、runtime、节点、状态、错误摘要、起止时间。

### API 合同

Stage 1 提供最小合同：

| Method | Path | 能力 |
| --- | --- | --- |
| `GET` | `/api/workbench/projects` | 读取项目列表 |
| `POST` | `/api/workbench/projects` | 新建项目并初始化节点 |
| `GET` | `/api/workbench/projects/[projectId]` | 读取项目基础信息 |
| `GET` | `/api/workbench/projects/[projectId]/messages` | 读取项目消息 |
| `POST` | `/api/workbench/projects/[projectId]/messages` | 保存消息 |
| `GET` | `/api/workbench/projects/[projectId]/artifacts` | 读取项目 artifact 列表 |
| `POST` | `/api/workbench/projects/[projectId]/artifacts` | 保存 artifact 草稿 |
| `GET` | `/api/workbench/projects/[projectId]/snapshot` | 读取恢复 snapshot |

approve/regenerate 路由只在 Stage 1 规划合同中保留，不在本阶段伪装实现；Stage 2/3 再交付真实闭环。

### 文件结构

新增或修改：

- `prisma/schema.prisma`：数据库模型。
- `src/server/db/client.ts`：Prisma client 单例。
- `src/server/workbench/types.ts`：后端合同类型。
- `src/server/workbench/workflow-defaults.ts`：默认节点定义。
- `src/server/workbench/repository.ts`：Prisma repository。
- `src/server/workbench/service.ts`：业务服务和 snapshot 组装。
- `src/app/api/workbench/**/route.ts`：Route Handlers。
- `src/server/workbench/__tests__/stage1-contract.test.ts`：Stage 1 contract/service tests。
- `vitest.config.ts`：资源受控测试配置。

### 风险与回退

| 风险 | 控制方式 | 回退方式 |
| --- | --- | --- |
| Prisma 版本与 Next 16 环境不匹配 | 先跑最小 contract test 和 build | 固定 Prisma 版本或降级到稳定版本 |
| SQLite 与 Postgres 类型差异 | Stage 1 不用数据库专属字段和复杂索引 | 切换前补 Postgres migration 验证 |
| route handler 变胖 | route 只做参数解析和响应包装 | 业务逻辑下沉到 service/repository |
| 测试污染本地数据库 | 测试使用独立 `DATABASE_URL` | 测试前后清理 Stage 1 数据 |

## 6. Stage 1 验证标准

集中验收必须包含：

- `npm run test:stage1` 通过，覆盖创建项目、消息、artifact、snapshot、双项目隔离。
- `npm run build` 通过。
- `git diff --check` 通过。
- `git status --short` 只包含本阶段授权范围内改动。
- 文档与实现一致：Stage 1 不声称 approve/regenerate 已完成。
