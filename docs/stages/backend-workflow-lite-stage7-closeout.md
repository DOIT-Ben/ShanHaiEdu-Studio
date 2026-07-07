# Backend Workflow Lite Stage 7 Closeout

日期：2026-07-07

## 1. 阶段目标

Stage 7 目标是完成 Backend Workflow Lite 主线收束：把 Stage 1-6 已实现的真实状态真源整理成稳定 API 合同，并用 contract regression 和全阶段回归证明可交给前端、Runtime 和 E2E 主线接入。

## 2. 已完成内容

- 新增 `docs/contracts/backend-workflow-lite-api.md`：
  - 状态与节点字典。
  - endpoint 清单。
  - request / response envelope。
  - 400 / 404 / 409 错误合同。
  - Runtime 接入顺序。
  - 前端接入边界。
  - 未完成能力边界。
- 新增 `src/server/workbench/__tests__/stage7-mainline-contract.test.ts`：
  - 主线 happy path route envelope。
  - duplicate finish / stale regenerate 409 冲突合同。
  - project snapshot 隔离。
- 新增 `npm run test:stage7`。

## 3. 集中验收

```text
npm run test:stage1
结果：通过，1 个测试文件，4 个用例，失败数 0。

npm run test:stage2
结果：通过，1 个测试文件，6 个用例，失败数 0。

npm run test:stage3
结果：通过，1 个测试文件，7 个用例，失败数 0。

npm run test:stage4
结果：通过，1 个测试文件，6 个用例，失败数 0。

npm run test:stage5
结果：通过，1 个测试文件，7 个用例，失败数 0。

npm run test:stage6
结果：通过，1 个测试文件，5 个用例，失败数 0。

npm run test:stage7
结果：通过，1 个测试文件，3 个用例，失败数 0。

npm run build
结果：通过，Next.js production build exit 0。

git diff --check
结果：通过，exit 0。

真实 API smoke
结果：通过。
验证：POST project -> POST message -> GET snapshot。
返回：messageCount=1，nodeCount=8，artifactCount=0，agentRunCount=0。
```

## 4. 主线目标完成核对

| 主线目标 | 结果 | 证据 |
| --- | --- | --- |
| Project 状态真源 | 完成 | Stage 1 / Stage 7 |
| ConversationMessage 状态真源 | 完成 | Stage 1 / Stage 7 |
| WorkflowNode 状态真源 | 完成 | Stage 1-6 |
| Artifact 状态真源 | 完成 | Stage 1-4 / Stage 6 |
| AgentRun 状态真源 | 完成 | Stage 5-7 |
| 保存、读取、恢复 | 完成 | snapshot / messages / artifacts / agentRuns |
| artifact approve | 完成 | Stage 2-4 |
| artifact regenerate | 完成 | Stage 3 / Stage 6 |
| 两项目不串数据 | 完成 | Stage 1 / Stage 3 / Stage 5 / Stage 6 / Stage 7 |
| 前端和 Runtime 稳定 API 合同 | 完成 | `docs/contracts/backend-workflow-lite-api.md` / Stage 7 contract test |

## 5. 审查与风险

自审结论：

- 本主线没有接 OpenAI，没有伪装真实 provider 输出。
- 本主线没有修改前端视觉。
- 本主线没有做 PPTX、图片、视频生成。
- 数据库路径、密钥和本地文件路径没有写进业务组件。
- `dev.db`、`.env`、`src/generated/prisma` 仍保持忽略，不提交。
- `SHANHAIEDU_LEGACY_RETROSPECTIVE.md` 不属于本主线；本阶段没有新增、修改或提交该文件。

剩余风险：

- 当前开发期使用 SQLite + `prisma db push`，生产级唯一约束和 migration 需要后续 Postgres / migration 阶段处理。
- 没有真实多进程并发压测；Stage 6 已做应用层旧 run / repeated finish / expected version guard。
- 没有用户认证和租户边界；当前隔离粒度是 projectId。
- `GET /api/workbench/projects/[projectId]` 对不存在项目返回 `200 { "project": null }`，已在合同文档中照实记录；若前端需要 404，可后续单独变更合同。
- 远程历史中已有非本主线提交 `9d74a27 docs: 同步初代项目复盘文档 | v0.4.8 | 2026-07-07 04:45`，包含 `SHANHAIEDU_LEGACY_RETROSPECTIVE.md`；这不是本主线阶段产物，但已存在于远程分支历史。

## 6. 可合并判断

Backend Workflow Lite 主线已达到 backend contract skeleton 的可合并候选标准：

- 状态真源覆盖 Project、ConversationMessage、WorkflowNode、Artifact、AgentRun。
- API 合同覆盖前端和 Runtime 的最小接入。
- approve / regenerate / snapshot / failure recovery / conflict guard 已有测试。
- Stage 1-7、build、diff check、HTTP smoke 均通过。

合并 `main` 前建议在集成线程做一次跨主线检查：

- 与 Frontend API-backed Workbench 对齐 `docs/contracts/backend-workflow-lite-api.md`。
- 与 Agent Runtime Adapter 对齐 run/artifact 写入顺序。
- 与 E2E Verification 对齐 snapshot 和 conflict 断言。
