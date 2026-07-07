# Local Real MVP M43 真实环境部署演示交接测试定义

日期：2026-07-08

## 1. 行为红线

M43 必须证明仓库内有一份可交接的真实部署演示 runbook，并且不会把 M41/M42 的本地准备误写成已经公网 live。

## 2. 合同测试

### 2.1 `tests\live-deploy-handoff.test.mjs`

覆盖：

- `docs\runbooks\live-deployment-demo-handoff.md` 存在。
- runbook 包含：
  - live target 信息清单。
  - `npm run preflight:deploy-demo`。
  - `npm run demo:e2e:delivery`。
  - nginx 或 reverse proxy 检查。
  - HTTPS 检查。
  - provider smoke 检查。
  - public URL 验收。
  - rollback 回滚。
  - 明确 `deploy-demo-readiness` 不等于公网 live。

命令：

```powershell
node --test tests\live-deploy-handoff.test.mjs
```

## 3. 复验命令

```powershell
npm run preflight:deploy-demo
npm run demo:e2e:delivery
```

通过标准：

- 两条命令 exit 0。
- `preflight:deploy-demo` 输出 `ok=true`。
- `demo:e2e:delivery` 输出 `ok=true`，材料包包含 Markdown、PPTX、图片和视频。
