# E2E Verification Stage 2 Blocker Report

日期：2026-07-07

## 1. 阶段结论

Stage 2 当前阻塞，不能开发或宣称 deterministic browser E2E 通过。

## 2. 已知事实

- 当前 E2E 分支已完成 Stage 1 并提交。
- 当前 E2E 分支仍是前端 mock 原型代码，`MediaWorkbench` 和 `useWorkbenchController` 仍从 `@/lib/mock-data` 读取状态。
- 当前 E2E 分支没有 `src\app\api\workbench`。
- 当前 E2E 分支没有服务端 `src\server\agent-runtime`。
- 其他 worktree 有相关未提交或未集成进 E2E 分支的工作，不能作为当前分支验收依据。
- 只读审计显示：`backend-workflow-lite` worktree 目前有未提交的 `src\app\api\workbench`、`src\server\workbench`、Prisma 和 contract test 文件，但其 Stage 1 closeout 明确把 `approve/regenerate` 放到后续阶段。
- 只读审计显示：`frontend-api-backed-workbench` worktree 目前有未提交的 `src\lib\workbench-api.ts` 和 API-backed controller 改动，但 Stage 1 仍使用开发态 adapter，尚未证明真实后端 snapshot 接入。
- 只读审计显示：`agent-runtime-adapter` worktree 有本地提交到 Stage 4 closeout，但这些提交尚未合入 E2E 分支。

## 3. 阻塞项

| 阻塞项 | 归属主线 | 需要的输入 |
| --- | --- | --- |
| 缺 workbench API | Backend Workflow Lite | 项目、消息、artifact、snapshot、approve/regenerate API |
| 缺 API-backed shell | Frontend API-backed Workbench | 前端从 API snapshot 获取项目、消息、节点和产物 |
| 缺 deterministic runtime 集成 | Agent Runtime Adapter | 服务端 DeterministicRuntime 可由工作流调用并生成 artifact |
| 缺 snapshot contract | Backend + Frontend | 刷新恢复所需的项目状态合同 |
| 缺 artifact approve 合同 | Backend + Frontend | 用户确认动作必须经真实 route 或 API-backed client contract 返回更新后的 snapshot |

## 4. 尝试与结果

已新增并运行 Stage 2 preflight。该检测只读当前分支，不修改业务代码；失败即阻止 browser E2E 继续执行，防止 mock 假阳性。

## 5. 下一步最小动作

等待或集成以下已提交主线输入后重跑：

```powershell
npm run test:e2e:stage2:preflight
```

preflight exit 0 后，再开发并运行 Stage 2 browser E2E。
