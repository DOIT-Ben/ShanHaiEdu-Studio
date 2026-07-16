# Local Real MVP M42 部署演示准备规划

日期：2026-07-08

## 1. 第一性原理

用户现在要把 ShanHaiEdu 拿去部署并演示给别人看。此阶段的核心不是再证明开发态页面能跑，而是建立“演示前最后一道闸门”：

```text
生产配置预检
-> 初始化真实环境数据库 schema
-> 生产构建
-> 启动生产服务
-> HTTP smoke
-> 输出部署演示准备报告
```

M42 必须明确区分三件事：

- M41 已证明本地自动交付演示可端到端跑通。
- M42 证明当前工作树具备真实环境部署演示前的生产启动准备。
- 只有完成 live target、域名/HTTPS、真实 provider health 和用户可访问 URL 后，才能称为“已上线”。

## 2. 可复用方案调研

项目内已验证资产：

- `npm run preflight:production`：检查 build/start、Next standalone、SQLite、素材存储根目录和 provider 配置类别。
- `npm run build`：生产构建并生成 standalone 输出。
- `scripts\init-sqlite-schema.mjs`：初始化 SQLite schema。
- `docs\runbooks\local-real-mvp-production-readiness.md`：已有本机生产准备 runbook。
- M41 的 `npm run demo:e2e:delivery`：证明自动交付演示链路。

成熟部署方法论：

- 演示前门禁应使用真实生产构建产物，而不是 `next dev`。
- smoke 应只输出状态、端口、HTTP 结果和报告路径，不输出 `.env`、密钥、私有端点或 provider 原始响应。
- 无明确服务器/域名授权时，不执行远程部署；只准备可交接的部署门禁和 runbook。

## 3. 复用与适配方式

M42 复用 M31 生产预检，但补一层更贴近真实演示的命令：

```powershell
npm run preflight:deploy-demo
```

该命令执行：

1. `npm run preflight:production`
2. `npm run db:init`
3. `npm run build`
4. 用 `.next\standalone\server.js` 启动生产服务
5. 请求 `/` 与 `/api/workbench/projects`
6. 写入 `test-results\deploy-demo-preflight-report.json`
7. 写入 `test-results\deploy-demo-preflight-report.md`

## 4. 开发方案

新增文件：

- `scripts\deploy-demo-preflight.mjs`
  - 编排生产预检、DB 初始化、构建、standalone server smoke。
- `tests\deploy-demo-preflight.test.mjs`
  - 固定 package 命令、报告路径、standalone 启动和脱敏约束。
- `docs\stages\local-real-mvp-m42-deploy-demo-readiness-test-plan.md`
  - 测试定义。
- `docs\stages\local-real-mvp-m42-deploy-demo-readiness-report.md`
  - 阶段验收报告。

更新文件：

- `package.json`
  - 增加 `preflight:deploy-demo`。
- `docs\runbooks\local-real-mvp-production-readiness.md`
  - 增加部署演示前一键门禁说明。

## 5. 风险与回退

- 风险：生产预检失败。回退：不启动服务，按 `missing` 字段补本机或服务器环境配置。
- 风险：生产构建失败。回退：先跑 `npm test` 判断是否代码回归，再修构建错误。
- 风险：standalone 服务启动失败。回退：检查 `.next\standalone\server.js`、`DATABASE_URL`、`ARTIFACT_STORAGE_ROOT` 和端口占用。
- 风险：被误认为已上线。回退：报告中明确 `mode=deploy-demo-readiness`，只代表部署演示准备，不代表公网 live。

## 6. 验收标准

- `node --test tests\deploy-demo-preflight.test.mjs` 通过。
- `npm run preflight:deploy-demo` 通过并输出 `ok=true`。
- `npm run demo:e2e:delivery` 通过，证明自动交付演示仍可端到端跑。
- `npm test` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- 不提交 `.env`、数据库、素材、构建产物、测试报告或 provider 响应。
