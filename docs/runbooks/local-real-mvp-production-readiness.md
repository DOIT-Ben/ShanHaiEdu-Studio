# Local Real MVP Production Readiness Runbook

日期：2026-07-07

## 1. 适用范围

本 runbook 用于 ShanHaiEdu 本地真实 MVP 的上线前本机准备。当前目标是“先不上线，但具备上线能力”：能构建、能检查生产启动前置条件、能初始化本地 SQLite、能把真实素材写入固定本地存储目录。

本 runbook 不代表已经完成公网部署、正式账号体系、域名、HTTPS、对象存储、CDN、监控或生产级数据库迁移。

## 2. 本机准备

工作目录：

```powershell
cd E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\local-real-mvp-mainline
```

必须存在但不得提交的本机配置：

- `.env`
- `data\`
- `artifact-storage-root\`

`.env` 至少需要包含这些类别的配置：

- `DATABASE_URL`：本地生产准备 SQLite 文件地址，使用 `file:`。
- `ARTIFACT_STORAGE_ROOT`：本地真实素材存储根目录，使用绝对路径。
- OpenAI-compatible 当前固定通道 env。
- Coze PPT `/run` env。
- 图片 provider 当前固定通道 env。
- 视频 provider 当前固定通道 env。

不得在文档、日志、截图或提交信息里展示任何真实 key、token、私有端点或完整 `.env` 内容。

## 3. 上线前检查命令

生产预检：

```powershell
npm run preflight:production
```

通过标准：

- exit 0。
- JSON 输出 `ok=true`。
- 每个检查项 `ok=true`。
- 输出不包含密钥、token、私有端点或 `.env` 内容。

初始化本地 SQLite schema：

```powershell
npm run db:init
```

生产构建：

```powershell
npm run build
```

浏览器关键回归：

```powershell
npm run test:e2e:stage7
node scripts\run-stage27-e2e.mjs
```

## 4. 本地生产启动候选流程

当前推荐流程：

```powershell
npm run preflight:production
npm run db:init
npm run build
npm run start
```

如果需要指定端口，优先通过运行环境变量或外层进程管理器设置，不把端口硬编码进业务代码。

## 5. 构建输出

`next.config.ts` 已配置 `output: "standalone"`，用于准备 Next.js 自托管运行包边界。

当前已知边界：

- `npm run build` 仍可能出现 1 条既有 Turbopack tracing warning，来源在视频下载和本地 ArtifactStorage 链路。
- 该 warning 不等于构建失败，但生产部署前必须在实际部署方式下继续复查。

## 6. 回滚方式

如果生产预检失败：

1. 不启动生产服务。
2. 只根据 `missing` 字段补本机 `.env` 或本地目录。
3. 不把真实值写入 git。
4. 复跑 `npm run preflight:production`。

如果生产构建失败：

1. 保留完整构建输出。
2. 先跑 `npm test` 判断是否代码回归。
3. 如仅 Next tracing warning，不当作失败；如 exit 非 0，必须先修复再启动。

如果真实素材生成失败：

1. 先确认 `npm run preflight:production` 是否通过。
2. 再分别跑对应 smoke 脚本。
3. 不在公开日志中输出 provider 原始响应、任务 id、远程 URL 或 token。

## 7. 仍未完成的生产项

- 公网认证、密码/OAuth/SSO、CSRF、组织/班级权限。
- 独立后台 worker、队列取消、重试退避、限流和监控。
- 对象存储、CDN、备份、素材生命周期清理。
- WebKit、客户端 exe 和真实设备专项验收。
