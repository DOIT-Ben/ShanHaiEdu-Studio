# Local Real MVP M42 部署演示准备测试定义

日期：2026-07-08

## 1. 行为红线

M42 必须证明：

- 有一条命令可以执行部署演示前生产门禁。
- 该命令使用生产构建产物启动服务，而不是 `next dev`。
- 该命令可以生成可交接报告。
- 输出不展示 `.env`、密钥、凭据、私有端点或 provider 原始响应。
- M42 不宣称公网已上线。

## 2. 红灯测试

### 2.1 `tests\deploy-demo-preflight.test.mjs`

覆盖：

- `package.json` 暴露 `preflight:deploy-demo`。
- `scripts\deploy-demo-preflight.mjs` 存在。
- 脚本包含：
  - `preflight:production`
  - `db:init`
  - `build`
  - `.next\standalone\server.js`
  - `deploy-demo-preflight-report.json`
  - `deploy-demo-preflight-report.md`
  - `mode: "deploy-demo-readiness"`
- 脚本不直接打印 `process.env` 或读取 `.env` 内容。

命令：

```powershell
node --test tests\deploy-demo-preflight.test.mjs
```

## 3. 部署演示预检验收

命令：

```powershell
npm run preflight:deploy-demo
```

通过标准：

- exit 0。
- stdout JSON 中 `ok=true`。
- 报告 JSON 与 Markdown 存在。
- HTTP smoke 至少覆盖 `/` 与 `/api/workbench/projects`。

## 4. 集中验收

```powershell
node --test tests\deploy-demo-preflight.test.mjs
npm run preflight:deploy-demo
npm run demo:e2e:delivery
npm test
npm run build
git diff --check
```
