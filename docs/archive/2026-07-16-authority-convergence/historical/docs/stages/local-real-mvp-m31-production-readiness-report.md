# Local Real MVP M31 Production Readiness Report

日期：2026-07-07

## 1. 阶段目标

M31 目标是完成本地真实 MVP 的生产部署准备基础：先不上线，但提供可重复运行的生产预检命令、Next standalone 构建准备、本机生产 SQLite 和素材存储配置检查，以及上线前 runbook。

本阶段不做公网发布、不 push、不配置域名/HTTPS、不引入正式账号体系、不替换 SQLite、不引入对象存储或独立 worker。

## 2. 本阶段变更

配置：

- `next.config.ts` 增加 `output: "standalone"`。
- `package.json` 增加 `preflight:production`。
- `.gitignore` 忽略 `data\` 和 `artifact-storage-root\`，防止本地生产数据和素材进入提交。

脚本：

- 新增 `scripts\production-preflight.mjs`。
- 脚本检查 package build/start、Next standalone、`DATABASE_URL`、`ARTIFACT_STORAGE_ROOT`、OpenAI-compatible、Coze PPT、图片和视频 env。
- 脚本输出 JSON，只显示检查项、present/missing、source 和安全摘要，不打印真实值。
- `scripts\init-sqlite-schema.mjs` 默认加载 `.env`，确保 runbook 中 `npm run db:init` 能初始化本地生产准备数据库，而不是回落到 `dev.db`。

文档：

- 新增 `docs\runbooks\local-real-mvp-production-readiness.md`。
- 新增 M31 规划、测试定义和阶段报告。

本地配置：

- 已在 ignored 的 `.env` 中补齐本机生产准备所需非提交配置项。
- 已创建本地生产准备数据目录和素材目录。
- 未在 git 中提交 `.env`、数据库文件或素材文件。

## 3. 验收记录

| 命令 | 结果 |
| --- | --- |
| `node --test tests\production-preflight.test.mjs tests\sqlite-init-dotenv.test.mjs` | 红灯后绿灯；5 tests passed |
| `npm run preflight:production` | 通过；`ok=true`；所有 8 个检查项通过 |
| `npm run db:init` | 通过；初始化 `.env` 指定的本地生产准备 SQLite 路径 |
| `npm test` | 通过；Node 50 tests passed；Vitest 23 files / 88 tests passed |
| `npm run build` | 通过；仍有 1 条既有 Turbopack output tracing warning |
| `npm run test:e2e:stage7` | 通过；Chromium desktop 1 passed |
| `node scripts\run-stage27-e2e.mjs` | 通过；Chromium desktop 1 passed |

## 4. 审查结论

M31 已完成本地生产准备基础：

- 上线前配置可以通过固定命令检查。
- Next standalone 输出已配置。
- 本地生产 SQLite 路径和素材存储根目录已从 `.env` 显式配置。
- `npm run db:init` 已能读取 `.env` 中的 `DATABASE_URL`。
- OpenAI-compatible、Coze PPT、图片和视频 provider env 均可通过预检定位为 present。
- 预检输出不包含真实 key、token、私有端点或 `.env` 内容。
- 本地生产数据目录和素材目录已加入 ignore。

当前不能表述为：

- 已完成公网部署。
- 已具备公网正式账号系统。
- 已完成生产数据库迁移。
- 已完成对象存储、CDN、备份、监控或自动清理。
- 已完成独立 worker 和生产队列。

## 5. 剩余风险

- `npm run preflight:production` 证明配置存在，不代表 provider 当前 live 可用；真实可用性仍需 smoke 脚本证明。
- SQLite 仍只适合当前本地 MVP 和小规模试用，不应包装为公网生产数据库方案。
- `output: "standalone"` 已配置，但仍需在最终部署目标上实测运行包。
- 既有 Turbopack tracing warning 仍需在 `npm run build` 验收中记录。

## 6. 下一阶段建议

优先进入 M32 公网认证升级规划或客户端 exe 验证准备：

- 公网认证升级：密码/OAuth/SSO、CSRF、管理员、共享协作和审计日志。
- 客户端 exe 验证准备：确认浏览器站点在封装容器内的路径、下载、素材目录和本地会话行为。
