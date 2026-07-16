# Local Real MVP M31 Production Readiness Plan

日期：2026-07-07

## 1. 第一性原理：当前阶段核心需求

M31 的核心需求是让 ShanHaiEdu 本地真实 MVP 具备上线前的本机生产准备能力：先不上线、不 push、不部署，但能用脚本和文档明确回答“这台机器是否已经具备生产构建和生产启动前置条件”。

当前最小成功标准：

- 有固定命令检查生产准备状态。
- 检查项覆盖构建脚本、生产启动脚本、Next standalone 输出、SQLite 数据库地址、本地素材存储根目录、OpenAI-compatible、Coze PPT、图片、视频 provider env。
- 检查输出只显示 present/missing 和安全摘要，不打印密钥、token、私有端点、签名 URL、完整 `.env` 或 task id。
- 生产构建仍通过 `npm run build`，并记录既有 Turbopack tracing warning，而不是把 warning 包装成已解决。
- 有 runbook 说明本机如何进行上线前准备、如何验证、如何回滚到开发态。

本阶段不做公网部署、不改公网认证、不引入 Docker/Kubernetes/Nginx、不中断现有 `.env` 台账配置、不迁移数据库到 PostgreSQL。

## 2. 可复用方案调研

项目内可复用：

- `scripts\openai-smoke.mjs`、`scripts\coze-ppt-smoke.mjs`、`scripts\image-smoke.mjs`、`scripts\video-smoke.mjs` 已沉淀 provider env 命名和脱敏输出策略。
- `src\server\artifact-storage\local-artifact-storage.ts` 已支持 `ARTIFACT_STORAGE_ROOT`，metadata 不保存机器绝对路径。
- `scripts\init-sqlite-schema.mjs` 已支持 SQLite schema 初始化和补列。
- `npm run build` 已包含 Prisma generate 和 Next build。
- `docs\stages\local-real-mvp-current-state-audit.md` 已明确生产部署、认证和独立 worker 尚未完成。

官方/成熟方案参考：

- Next.js 自托管和 standalone 输出：`https://nextjs.org/docs/app/getting-started/deploying`、`https://nextjs.org/docs/app/api-reference/config/next-config-js/output`
- Next.js 环境变量加载边界：`https://nextjs.org/docs/app/guides/environment-variables`
- Prisma 配置和 datasource 环境变量：`https://www.prisma.io/docs/orm/reference/prisma-config-reference`

本阶段取舍：

- 使用 Next 官方 `output: "standalone"` 为后续部署缩小服务端运行包边界。
- 继续使用 SQLite 作为本地真实 MVP 数据库，不包装为公网生产数据库。
- 新增自研轻量 preflight 脚本，因为当前需求是项目特定 env、素材存储和 provider 边界检查，通用部署工具不能直接覆盖。

## 3. 复用、适配和必要自研

复用：

- 复用现有 provider env 命名。
- 复用 `.gitignore` 对 `.env`、`.tmp` 的保护。
- 复用 Node test 风格写脚本测试。

适配：

- `next.config.ts` 增加 `output: "standalone"`。
- `package.json` 增加 `preflight:production`。
- 新增 `scripts\production-preflight.mjs`，输出 JSON 检查结果。
- 新增 `tests\production-preflight.test.mjs`，覆盖成功、失败和脱敏。
- 新增 `docs\runbooks\local-real-mvp-production-readiness.md`，给出本机上线前准备步骤。

必要自研：

- `production-preflight` 检查项：
  - package build/start 脚本存在。
  - Next standalone 输出已配置。
  - `DATABASE_URL` 已显式设置，且当前本地 MVP 只接受 `file:` SQLite。
  - `ARTIFACT_STORAGE_ROOT` 已显式设置为绝对路径，且不指向项目 `.tmp`。
  - OpenAI-compatible 当前通道可定位到 key/base/model。
  - Coze PPT `/run` env 可定位。
  - 图片当前通道可定位到 key/base/model。
  - 视频当前通道可定位到 key/base/model。
  - `.env` 与 `.tmp` 继续被 git ignore。

## 4. 开发方案、风险和验证标准

执行方案：

1. 写 M31 阶段规划和测试定义。
2. 写红灯测试：没有脚本时 `production-preflight` 测试失败。
3. 实现 `scripts\production-preflight.mjs`。
4. 修改 `package.json` 和 `next.config.ts`。
5. 写生产准备 runbook。
6. 跑 M31 专项测试、`npm test`、`npm run build`、`npm run preflight:production`、Stage7、Stage27。
7. 更新 M31 报告和当前状态审计。
8. 提交 M31，不 push。

主要风险：

- preflight 只能证明配置具备上线前准备，不等于公网部署成功。
- provider env 只能证明配置项存在，不等于真实 provider 当前可用；真实可用性仍由 smoke 脚本证明。
- `output: "standalone"` 可能改变构建输出和 tracing warning 表现，必须用 `npm run build` 实测。
- 本地 SQLite 可支撑本地 MVP，不应包装为公网生产数据库方案。

验证标准：

- `node --test tests\production-preflight.test.mjs` 通过。
- `npm run preflight:production` exit 0，输出 `ok=true`，且不包含密钥、token、私有端点或 `.env` 内容。
- `npm test` 通过。
- `npm run build` 通过。
- `npm run test:e2e:stage7` 通过。
- `node scripts\run-stage27-e2e.mjs` 通过。
- `git diff --check`、`.env/.tmp` ignore 检查、脱敏扫描和残留进程检查通过。
