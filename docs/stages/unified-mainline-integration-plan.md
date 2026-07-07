# 统一主线集成规划

## 目标

把四条已完成并推送的 MVP 支线合入统一集成分支 `integration/unified-mainline`，形成可用于后续合并 `main` 的候选状态。

## 范围

- 合入 `origin/feature/mvp-agent-runtime-adapter`
- 合入 `origin/feature/mvp-backend-workflow-lite`
- 合入 `origin/feature/mvp-frontend-api-backed-workbench`
- 合入 `origin/feature/mvp-e2e-verification`
- 解决共享脚本、依赖、忽略规则和 workbench artifact 合同冲突
- 运行集成验证并产出收尾报告

## 集成顺序

1. Runtime：先提供服务端运行时边界。
2. Backend：再提供项目、消息、节点、产物、AgentRun 状态真源。
3. Frontend：接入 API-backed controller 和交互回归。
4. E2E：最后合入集成验收资产与浏览器路径。

## 关键假设

- 不直接修改 `main`。
- 不运行真实 provider。
- 不删除支线 worktree。
- `deterministic_draft` 仍为演示/开发态，不伪装成真实模型产物。
- `artifactId` 和 `artifactKey` 冲突以可验证后端合同为准，前端/E2E 通过明确动作 key 适配。

## 验证标准

- Git 合并后无冲突标记。
- `npm run build` 通过。
- 前端 Node 测试、Runtime Vitest、Backend stage tests 至少关键阶段通过。
- E2E preflight 通过；若浏览器 E2E 因环境限制失败，必须记录真实原因。
- 用户可见文本不出现工程词。
- 不提交私有 API 台账、`.env`、本地数据库、临时截图或 legacy 误落文件。

## 回退方式

- 集成分支独立于 `main`，失败时可删除 `integration-unified-mainline` worktree 和本地分支后重建。
- 合并 `main` 前不清理任何支线 worktree。
