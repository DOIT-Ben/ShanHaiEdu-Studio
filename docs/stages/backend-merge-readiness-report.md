# Backend Merge Readiness Report

日期：2026-07-07

## 1. 只读核对结论

工作目录：

```text
E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\backend-workflow-lite
```

当前分支：

```text
feature/mvp-backend-workflow-lite
```

只读核对命令：

```powershell
git fetch origin
git status --short --branch
git branch -vv
```

核对结果：

- 本地分支与 `origin/feature/mvp-backend-workflow-lite` 对齐。
- 当前 HEAD：`220a1bb docs: 收束后端工作流API合同 | v0.7.0 | 2026-07-07 05:43`
- 工作区在核对时为干净状态。
- `origin/main` 当前为 `975001c docs: 补充智能体运行时治理主线 | v0.4.7 | 2026-07-07 04:35`

## 2. Backend Workflow Lite 完成范围

已完成并可作为合并候选的后端能力：

- Project 保存、列表、读取、snapshot 恢复。
- ConversationMessage 保存与读取。
- WorkflowNode 初始化、状态推进、stale、failed。
- Artifact 保存、读取、approve、regenerate、版本保留。
- Approved upstream inputs 读取。
- AgentRun start / finish / failed recovery。
- duplicate finish 与 stale regenerate 的 409 冲突合同。
- projectId 维度隔离测试。
- API 合同文档：`docs/contracts/backend-workflow-lite-api.md`

明确未完成且不应误判为完成：

- 真实 OpenAI 或 provider 调用。
- PPTX、图片、视频文件生成。
- 生产认证、租户、权限、计费。
- Postgres migration 和生产数据库约束。
- 真正长任务队列和 worker。

## 3. API 合同关注点

合并前必须重点关注以下合同：

| 合同点 | 当前状态 | 合并前判断 |
| --- | --- | --- |
| `GET /api/workbench/projects` | 返回 `{ projects }` | 可合并 |
| `POST /api/workbench/projects` | 创建项目并初始化 8 个节点 | 可合并 |
| `GET /api/workbench/projects/[projectId]` | 不存在时返回 `200 { project: null }` | 可合并但需前端知情 |
| `GET /api/workbench/projects/[projectId]/snapshot` | 恢复 project/messages/nodes/artifacts/agentRuns | 可合并 |
| `POST /messages` | 保存 teacher/assistant/system 消息 | 可合并 |
| `POST /artifacts` | Runtime 可写 artifact draft | 可合并 |
| `POST /artifacts/[artifactId]/approve` | 切换 approved 指针并传播 stale | 可合并 |
| `POST /artifacts/[artifactId]/regenerate` | 创建新版本，可选 expectedLatestVersion | 可合并 |
| `GET /approved-inputs` | 返回目标节点已确认上游 artifacts | 可合并 |
| `POST /agent-runs` | 创建 running run，node in_progress | 可合并 |
| `POST /agent-runs/[runId]/finish` | succeeded/failed，重复 finish 409 | 可合并 |

需要主 Codex 集成时确认：

- 前端是否接受 `GET project` 的 null 语义，还是要统一改成 404。
- Runtime 是否统一传 `expectedLatestVersion`，避免过期 regenerate。
- 用户界面不得直显 `nodeKey`、`status`、`projectId` 等工程字段。

## 4. 数据库与 Prisma 风险

当前状态：

- Prisma datasource 是 SQLite。
- 测试与开发脚本使用 `prisma db push`。
- `Artifact` 有 `@@index([projectId, nodeKey, version])`，没有数据库级唯一约束。
- `WorkflowNode` 有 `@@unique([projectId, key])`。
- `ConversationMessage`、`Artifact`、`AgentRun` 均有 projectId 相关 index。

合并前风险：

| 风险 | 影响 | 建议 |
| --- | --- | --- |
| SQLite + db push 是开发态 | 不等于生产 migration | 合并可接受，但下一主线必须处理 Postgres/migrations |
| artifact version 仅应用层 guard | 并发写入极端情况下仍需数据库唯一约束 | 下一主线 Stage 2 下沉约束 |
| 无 User/ownerId | 当前只有 projectId 隔离，没有用户隔离 | 下一主线 Stage 3 建 User/membership |
| 无 queue table | AgentRun 是运行记录，不是 durable queue | 下一主线 Stage 4 做 queued 状态 |

合并前不建议做的事：

- 不在此阶段强行把 SQLite 改 Postgres。
- 不用 `--accept-data-loss` 作为常规验收手段。
- 不把真实 provider key 写入 `.env` 示例或文档。

## 5. 测试与构建关注点

当前测试脚本：

```text
npm run test:stage1
npm run test:stage2
npm run test:stage3
npm run test:stage4
npm run test:stage5
npm run test:stage6
npm run test:stage7
npm run build
```

Backend Workflow Lite 完成时已有验证记录：

- Stage 1-7 全部通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- HTTP smoke 通过。

合并前建议主 Codex 统一重跑：

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

## 6. Lint 风险

当前 `package.json` 中存在：

```text
"lint": "next lint"
```

风险：

- 当前项目使用 Next.js 16。`next lint` 在较新 Next 版本中可能不再是推荐或可用路径。
- Backend Workflow Lite 主线验收以 stage tests、build、diff check 和 HTTP smoke 为门禁，未把 lint 作为已通过结论写入主线完成声明。

合并前建议：

- 主 Codex 集成前单独运行 `npm run lint`。
- 如果 `next lint` 不可用，应在单独配置阶段改成 ESLint CLI 或移除无效脚本。
- 不要把 lint 未核验包装成已通过。

## 7. Legacy 与敏感文件风险

当前树中存在：

```text
SHANHAIEDU_LEGACY_RETROSPECTIVE.md
docs/private-api-ledger.md
```

来源与风险：

- `SHANHAIEDU_LEGACY_RETROSPECTIVE.md` 来自历史提交 `9d74a27 docs: 同步初代项目复盘文档 | v0.4.8 | 2026-07-07 04:45`。
- 该文件不是 Backend Workflow Lite 阶段产物，但已经存在于当前分支树中。
- `docs/private-api-ledger.md` 名称显示为私有 API 台账；本报告未读取或摘录其中内容。

合并前必须由主 Codex 判断：

- 是否允许 `SHANHAIEDU_LEGACY_RETROSPECTIVE.md` 进入 `main`。
- 是否允许 `docs/private-api-ledger.md` 进入 `main`，或是否需要脱敏/移动到私有区。
- 若需要移除或迁移，必须在单独授权后操作；本阶段不删除文件。

## 8. Main 合并前建议 Gate

建议 gate：

```powershell
git fetch origin
git status --short --branch
git diff --name-status origin/main..HEAD
$env:VITEST_MAX_WORKERS="2"; npm run test:stage1
$env:VITEST_MAX_WORKERS="2"; npm run test:stage2
$env:VITEST_MAX_WORKERS="2"; npm run test:stage3
$env:VITEST_MAX_WORKERS="2"; npm run test:stage4
$env:VITEST_MAX_WORKERS="2"; npm run test:stage5
$env:VITEST_MAX_WORKERS="2"; npm run test:stage6
$env:VITEST_MAX_WORKERS="2"; npm run test:stage7
npm run build
npm run lint
git diff --check
```

敏感文件 gate：

```powershell
git ls-tree -r --name-only HEAD | rg "PRIVATE|private|secret|ledger|\\.env|dev\\.db|src/generated"
```

注意：若运行敏感扫描，不要在日志或报告中打印任何密钥值。

## 9. 下一后端主线规划

建议主线名称：

```text
Production Backend Foundation
```

建议目标：

把 MVP 后端从本地 SQLite/API contract skeleton 推进到可试运行生产基础，覆盖生产数据库迁移、多用户隔离、运行队列和真实 runtime 调用入口。

阶段拆分不超过 10 个：

| 阶段 | 名称 | 核心交付 | 验收 |
| --- | --- | --- | --- |
| 1 | 生产数据库迁移计划与迁移骨架 | Postgres/Prisma migration 方案、回滚 runbook | 空库初始化通过 |
| 2 | 数据库约束与完整性 | artifact version 唯一约束、run 状态约束 | 重复版本被拒绝 |
| 3 | 多用户隔离模型 | User/ownerId/membership | 用户间 snapshot 隔离 |
| 4 | 运行队列最小模型 | queued/running/succeeded/failed、超时字段 | queued run 可恢复 |
| 5 | Runtime 调用入口边界 | AgentRuntime interface、deterministic test runtime | 无 key 仍可测试 |
| 6 | 真实 runtime server adapter 入口 | provider adapter server-only skeleton | 不进 React，不泄密 |
| 7 | 事件与轮询合同 | snapshot + run polling/events | 断线恢复可用 |
| 8 | 配置与密钥治理 | env 白名单、配置示例、日志脱敏 | 敏感扫描通过 |
| 9 | 集成验收与合并准备 | Postgres smoke、多用户 smoke、queue smoke | 可合并判断 |

## 10. 结论

Backend Workflow Lite 作为 MVP 后端状态真源和 API contract skeleton 已具备合并候选条件。

合并 `main` 前必须由主 Codex 统一决策两类问题：

- legacy / private 文件是否允许进入 `main`。
- lint 脚本是否可用，或是否需要单独修正。

下一后端主线应从生产数据库迁移和多用户隔离开始，不应在当前 MVP 分支继续叠加真实 provider 或队列实现。
