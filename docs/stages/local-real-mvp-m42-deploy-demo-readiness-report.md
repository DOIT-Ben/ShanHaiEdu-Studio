# Local Real MVP M42 部署演示准备验收报告

日期：2026-07-08

## 1. 阶段目标

M42 目标是在 M41 已证明本地自动交付演示可端到端跑通后，补齐部署演示前的生产门禁：

```powershell
npm run preflight:deploy-demo
```

该命令必须使用生产构建产物启动服务，而不是开发服务器，并输出可交接的部署演示准备报告。

## 2. 实现结果

- 新增 `preflight:deploy-demo`。
- 新增 `scripts\deploy-demo-preflight.mjs`：
  - 加载本地运行配置。
  - 运行 `preflight:production`。
  - 运行 `db:init`。
  - 运行 `build`。
  - 启动 `.next\standalone\server.js`。
  - smoke `/` 与 `/api/workbench/projects`。
  - 输出 JSON/Markdown 报告。
- 新增 `tests\deploy-demo-preflight.test.mjs`，固定命令、报告、standalone 启动和脱敏约束。
- 更新 `docs\runbooks\local-real-mvp-production-readiness.md`，加入部署演示前一键门禁。

## 3. 排障记录

首次运行 `preflight:deploy-demo` 时，生产预检、DB 初始化和构建均通过，但 `/api/workbench/projects` 返回 500。

根因：

- `.env` 中 SQLite 使用相对 `file:` 路径。
- `db:init` 在项目根目录初始化数据库。
- standalone 服务运行时会在不同目录解析相对数据库路径，导致运行时数据库目录不存在。

修复：

- `scripts\deploy-demo-preflight.mjs` 在启动 standalone 前将相对 SQLite `file:` 路径规范为项目绝对路径。
- 生产预检、DB 初始化和 standalone 服务使用同一个规范化后的 `DATABASE_URL`。

## 4. 本次验收证据

已执行：

```powershell
node --test tests\deploy-demo-preflight.test.mjs
npm run preflight:deploy-demo
npm run demo:e2e:delivery
npm test
npm run build
```

当前已确认：

- `node --test tests\deploy-demo-preflight.test.mjs`：通过，1/1。
- `npm run preflight:deploy-demo`：通过，`ok=true`。
- `npm run demo:e2e:delivery`：通过，Chromium desktop 1/1，材料包包含 Markdown、PPTX、图片和视频。
- `npm test`：通过，Node 93/93，Vitest 24 files / 92 tests。
- `npm run build`：通过，Next.js 生产构建、TypeScript 与页面生成均成功。

`preflight:deploy-demo` 报告关键结果：

- `mode=deploy-demo-readiness`
- `production-preflight=true`
- `database-init=true`
- `production-build=true`
- `http-root=true`
- `http-project-list=true`

## 5. 边界说明

- M42 证明当前工作树具备真实环境部署演示前准备。
- M42 不代表已经完成公网部署、域名、HTTPS、反向代理、远程服务器进程守护或正式监控。
- M42 不替代真实 provider live smoke；provider 配置存在已由生产预检确认，实时调用健康仍需单独 smoke。
- 对外演示前，推荐先运行：

```powershell
npm run preflight:deploy-demo
npm run demo:e2e:delivery
```
