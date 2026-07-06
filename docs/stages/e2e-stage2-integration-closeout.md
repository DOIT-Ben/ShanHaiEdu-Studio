# E2E Verification Stage 2 Integration Closeout

日期：2026-07-07

## 1. 集成目标

为 Stage 2 deterministic E2E 准备真实输入，集成以下主线能力到 `feature/mvp-e2e-verification`：

- `origin/main`：阶段循环推进规则和最新治理文档。
- `feature/mvp-backend-workflow-lite`：Workbench API、Prisma schema、snapshot、消息与 artifact 状态真源。
- `origin/feature/mvp-frontend-api-backed-workbench`：API-backed data source、controller 加载/发送/确认/重做骨架。
- `feature/mvp-agent-runtime-adapter`：`DeterministicRuntime`、`OpenAIRuntime` 服务端边界和 runtime tests。

## 2. 冲突解决

### `.gitignore`

保留双方忽略项：

- E2E：`test-results\`、`playwright-report\`、`blob-report\`。
- Backend：`.env`、`dev.db`、`dev.db-journal`、`prisma\*.db`、`prisma\*.db-journal`、`src\generated\prisma`。
- Frontend：`*.tsbuildinfo`、`output\playwright\`。

### `package.json`

保留并合并：

- E2E：Playwright 脚本、Stage 1/Stage 2 preflight、报告脚本。
- Backend：`prisma generate && next build`、`db:generate`、`db:push`、后端 Stage 1 Vitest。
- Frontend：`node --test tests\*.test.mjs`。
- Runtime：`openai` 依赖、`vitest run tests\agent-runtime`。

最终 `test` 脚本为：

```powershell
node --test tests/*.test.mjs && vitest run tests/agent-runtime
```

### `package-lock.json`

未手工拼接。每次解决 `package.json` 后均通过 `npm install` 机械再生成。

## 3. 集中验证

```powershell
npm run build
npm run test:e2e:stage2:preflight
```

结果：

- `npm run build`：通过；Prisma Client 生成成功，Next build 成功，Workbench API routes 出现在构建路由表。
- `npm run test:e2e:stage2:preflight`：通过；5 项检查全部 `ok=true`，`blockers=[]`。

## 4. 剩余风险

- Stage 2 目前只完成前置输入集成和 preflight 通过，还未完成 browser E2E 主路径。
- 后端 Stage 1 文档仍说明完整 approve/regenerate 版本守卫在后续阶段；当前 Stage 2 只能验证基础确认入口，不宣称完整版本守卫完成。
- OpenAI Runtime 不进入 Stage 2 真实调用，Stage 2 只允许 deterministic 验收。
