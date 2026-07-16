# Local Real MVP M43 真实环境部署演示交接规划

日期：2026-07-08

## 1. 第一性原理

M41 已证明自动化跑完整交付，M42 已证明本机生产构建与 standalone 服务 smoke 可通过。用户下一步要“部署，演示给别人看”，因此 M43 的核心是把真实环境上线演示前的剩余信息、操作顺序、验收口径和回滚方式沉淀成可交接材料。

本阶段不直接远程部署，因为当前对话尚未提供或授权具体 live target、域名、服务器登录方式和公网反向代理改动。没有这些信息时，贸然声称已上线会把本地准备误报成真实发布。

## 2. 可复用方案调研

已复用项目内资产：

- `npm run demo:e2e:delivery`：自动交付演示闭环。
- `npm run preflight:deploy-demo`：部署演示前生产门禁。
- `npm run preflight:production`：生产配置类别检查。
- `docs\runbooks\local-real-mvp-production-readiness.md`：本地生产准备 runbook。
- M40-D 账号权限/CSRF 闭环报告：作为公网演示安全边界基础。

部署成熟做法：

- 先准备 release bundle 与环境变量清单，再部署到远程。
- 远程验收必须包含 HTTP、浏览器可见页面、API health、日志和回滚点。
- provider health 与演示替身模式必须分开表述。

## 3. 复用与适配方式

M43 只补齐真实部署演示交接包：

- 明确 live target 信息缺口。
- 给出服务器部署顺序。
- 给出 nginx/HTTPS/进程守护检查点。
- 给出 provider smoke 与 M41 本地演示的区别。
- 给出对外演示当天的 run order。

## 4. 开发方案

新增：

- `docs\runbooks\live-deployment-demo-handoff.md`
  - 真实环境部署演示交接包。
- `tests\live-deploy-handoff.test.mjs`
  - 验证交接包包含 live target、反向代理、HTTPS、provider smoke、回滚、M41/M42 命令和公网验收。
- `docs\stages\local-real-mvp-m43-live-deploy-handoff-test-plan.md`
  - 测试定义。
- `docs\stages\local-real-mvp-m43-live-deploy-handoff-report.md`
  - 验收报告。

## 5. 风险与回退

- 风险：把本地准备误说成真实上线。回退：所有文档显式区分 `deploy-demo-readiness` 与公网 live。
- 风险：远程服务器状态已变。回退：实际部署前必须重新执行 SSH/nginx/curl/browser 检查。
- 风险：真实 provider 配置存在但实时调用失败。回退：演示时保留 M41 local-substitute 路线作为备选，但不得称为 live provider 成功。
- 风险：SQLite 不适合多人长期公网使用。回退：演示期可用，生产化需迁移 PostgreSQL 或等价托管数据库。

## 6. 验收标准

- `node --test tests\live-deploy-handoff.test.mjs` 通过。
- `npm run preflight:deploy-demo` 通过。
- `npm run demo:e2e:delivery` 通过。
- `git diff --check` 通过。
- 文档不包含真实密钥、私有端点或个人账号。
