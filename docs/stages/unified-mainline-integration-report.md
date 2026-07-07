# 统一主线集成验收报告

## 目标

把四条 MVP 支线合入 `integration/unified-mainline`，形成可验证、可回看、可合并到 `main` 的统一候选分支。

## 合入顺序

1. `origin/feature/mvp-agent-runtime-adapter`
2. `origin/feature/mvp-backend-workflow-lite`
3. `origin/feature/mvp-frontend-api-backed-workbench`
4. `origin/feature/mvp-e2e-verification`

## 集成决策

- 不直接修改 `main`，所有合并先进入 `integration/unified-mainline`。
- 后端产物动作合同以 `artifactId` 为准，前端通过 action resolver 把节点动作解析到真实产物。
- 删除 E2E 合入带来的 `[artifactKey]` 动态路由形态，避免与 `[artifactId]` 双动态段冲突。
- `deterministic_draft` 只作为开发态草稿，不伪装成真实模型产物。
- 总测试使用独立 SQLite 测试库 `.tmp/test-workbench.db`，不污染 `dev.db`。
- `graphify-out/` 和 `.tmp/` 作为本地生成物忽略，不纳入提交。

## 本阶段修复

- `package.json` 的 `test` 改为统一测试编排脚本。
- 新增 `scripts/run-tests.mjs`，串联 Prisma generate、SQLite schema 初始化、Node 测试和 Vitest，并将 Vitest worker 限制为 1。
- 修正 Stage 1 测试：确认产物时使用真实 `artifact.id`。
- 修正 Stage 7 测试：对齐消息接口会生成 assistant 草稿回复、需求草稿会产生版本递增的事实。
- 补齐前端 mapper 对 `ppt_outline` 和 `final_delivery_checklist` 的标题映射。
- `.gitignore` 补充 `.tmp/` 与 `graphify-out/`。

## 验证记录

| 命令 | 结果 |
| --- | --- |
| `npm test` | 通过；Node 9 tests passed；Vitest 11 files / 63 tests passed |
| `npm run build` | 通过；Next.js 编译、TypeScript、静态页面生成均通过 |
| `npm run test:e2e:stage2:preflight` | 通过；5 项检查全部 `ok=true` |
| `git diff --check` | 通过；无空白错误 |
| `graphify update .` | 通过；生成 208 nodes / 163 edges / 86 communities |
| 测试 worker 残留检查 | 通过；未发现 Vitest/Jest/Playwright 残留 Node 进程 |

## 风险与边界

- 本阶段没有运行真实 OpenAI / Coze / 视频 / PPT provider，只验证确定性运行时和本地 API-backed 主链路。
- 浏览器 Playwright 真跑尚未执行；当前只通过 Stage 2 preflight。
- `integration/unified-mainline` 当前仍是集成候选分支，合并 `main` 前建议再做一次本地浏览器关键流程检查。

## 合并建议

当前集成候选分支已经具备合回 `main` 的测试基础。建议下一步：

1. 推送 `integration/unified-mainline`。
2. 在远端开 PR 或本地做最终浏览器验收。
3. 验收通过后合并到 `main`。
4. `main` 与远端同步后，再归档或清理四条支线 worktree。
