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
npm test
npm run test:stage1
npm run build
npm run test:e2e:stage2:preflight
npm run test:e2e:stage2
```

结果：

- `npm test`：通过；`node --test tests/*.test.mjs` 3/3，`vitest run tests/agent-runtime` 4 个文件、23 个测试通过。
- `npm run test:stage1`：通过；Prisma Client 生成成功，SQLite schema 初始化成功，后端 Stage 1 contract 5/5。
- `npm run build`：通过；Prisma Client 生成成功，Next build 成功，Workbench API routes 出现在构建路由表，包含 approve/regenerate route。
- `npm run test:e2e:stage2:preflight`：通过；5 项检查全部 `ok=true`，`blockers=[]`。
- `npm run test:e2e:stage2`：通过；Chromium desktop 1/1，覆盖新建项目、输入需求、需求规格 artifact、右侧节点、详情、确认、刷新恢复和用户可见工程词扫描。

## 4. 本轮 Stage 2 补齐内容

- 前端 API client 归一化后端 `{ projects }`、snapshot、message、artifact 响应，避免把 server shape 直接泄漏给 UI。
- 后端消息 POST 在 Stage 2 使用 `DeterministicRuntime` 生成 `requirement_spec` 草稿，保存 teacher message、assistant message 和 artifact。
- 新增 artifact approve/regenerate API route；approve 持久化 artifact `approved` / `isApproved=true` 并同步节点 `approvedArtifactId`。
- 修复确认后详情抽屉仍显示旧状态的问题：应用新 snapshot 时同步当前打开的详情和侧栏对象。
- 新增 `scripts\init-sqlite-schema.mjs` 和 `scripts\run-stage2-e2e.mjs`，Stage 2 浏览器验收使用独立 `test-results\stage2-e2e.db`，并强制 API 数据源。
- 过滤前端 artifact 可见内容中的内部生成字段，避免 `deterministic` 等工程词出现在教师界面。

## 5. 冲突解决收尾结论

- 先前 `.gitignore`、`package.json`、`package-lock.json` 冲突已解决；当前验证基于冲突解决后的工作树。
- `package-lock.json` 未手工拼接；本轮未新增依赖，不需要重新生成 lock。
- `prisma db push` 在当前 Prisma 7 / Windows 环境下仍会出现空 `Schema engine error`。本阶段不伪造其通过，改用同一 schema 对应的本地 SQLite 初始化脚本支撑测试和 E2E；`prisma validate` 与 `prisma migrate diff --from-empty --to-schema prisma\schema.prisma --script` 可正常运行。

## 6. 剩余风险

- 后端 Stage 1 文档仍说明完整 approve/regenerate 版本守卫在后续阶段；当前 Stage 2 只能验证基础确认入口，不宣称完整版本守卫完成。
- OpenAI Runtime 不进入 Stage 2 真实调用，Stage 2 只允许 deterministic 验收。
- Stage 2 只覆盖需求规格这一条 deterministic 最小路径；教材证据、教案、PPT 大纲、导入视频方案和最终交付清单进入 Stage 3。

## 7. 自审结论

- 范围：本轮只为 Stage 2 E2E 补齐真实 API-backed deterministic 最小闭环和测试基础设施；未接入真实 provider，未宣称 OpenAI 生成完成。
- 敏感信息：提交前扫描未发现密钥、token、私钥或明文账号；测试库位于忽略目录 `test-results\`。
- 质量：确认后详情抽屉状态同步已纳入浏览器 E2E；教师可见工程词扫描已包含在 Stage 2 用例。
- 合并建议：Stage 2 可作为 E2E 主线阶段提交并推送；整条 E2E 主线尚未封板，需自动进入 Stage 3。
