# E2E Verification Stage 2 Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

Stage 2 的目标是验证 deterministic 基础用户路径，而不是继续验证静态前端原型。可通过的路径必须具备真实项目状态、后端 API-backed shell、确定性运行时和刷新恢复合同。没有这些输入时，E2E 主线只能输出阻塞证据，不能把当前 mock UI 当作真实 MVP。

Stage 2 应覆盖：

- 新建项目。
- 输入一句自然语言需求。
- DeterministicRuntime 生成需求规格 artifact。
- 右侧节点显示 artifact。
- 打开详情。
- 用户确认。
- 刷新后恢复当前项目、消息、节点和确认状态。

## 2. 可复用方案调研

已复用 Stage 1 的 Playwright 配置、报告、截图和红线扫描能力。Stage 2 还依赖其他主线交付：

- Backend Workflow Lite：`src\app\api\workbench`、项目 snapshot、artifact approve/regenerate。
- Frontend API-backed Workbench：工作台从 API snapshot 读取，不再默认从 `mock-data` 取状态。
- Agent Runtime Adapter：服务端 deterministic runtime，且输出明确标记为测试/演示运行时，不伪装真实模型。

当前只读核对结果：

- `backend-workflow-lite` worktree 有未提交 API/Prisma 相关文件，但当前 E2E 分支尚未拥有这些输入。
- `frontend-api-backed-workbench` worktree 有未提交 API-backed 相关文件，但当前 E2E 分支尚未拥有这些输入。
- `agent-runtime-adapter` 本地分支有 2 个未推送提交，但当前 E2E 分支尚未集成。

## 3. 复用、适配和必要自研

复用：

- 继续使用 Playwright Chromium desktop 作为 Stage 2 首个浏览器目标。
- 复用 Stage 1 红线扫描，确保 deterministic 文案不暴露工程词。
- 复用 JSON/HTML 报告路径。

适配：

- 在真实 E2E 用例前增加 `test:e2e:stage2:preflight`，只读检查当前分支是否具备后端 API、确定性运行时、API-backed 前端和 snapshot contract。
- preflight 失败时不执行浏览器主路径，避免把当前 mock 页面误判为 Stage 2 通过。

必要自研：

- `scripts\e2e-stage2-preflight.mjs`：输出 JSON 阻塞证据，包含缺失项、归属主线和下一步要求。

## 4. 开发方案、风险和验证标准

本阶段当前执行方式：

1. 写 Stage 2 规划和测试计划。
2. 增加 Stage 2 preflight 脚本和 npm 命令。
3. 运行 `npm run test:e2e:stage2:preflight`。
4. 若 preflight 通过，再开发真实 browser E2E；若不通过，生成阻塞报告并停止 Stage 2 实现。

当前风险：

- 后端、前端和 runtime 主线尚未通过提交集成到 E2E 分支。
- 当前页面仍从 `mock-data` 取项目、消息和产物，刷新恢复无法代表真实保存。
- 如果跳过 preflight，Stage 2 很容易出现“测试跑绿但验证了 mock”的假阳性。

Stage 2 通过标准：

- `npm run test:e2e:stage2:preflight` exit 0。
- `npm run test:e2e:stage2` 覆盖新建项目、输入需求、artifact 生成、节点显示、详情、确认、刷新恢复。
- 不出现用户可见工程词。
- 报告能定位失败属于前端、后端、runtime 还是测试设施。

当前结论：Stage 2 preflight 未通过前，不能进入真实 browser E2E 实现。
