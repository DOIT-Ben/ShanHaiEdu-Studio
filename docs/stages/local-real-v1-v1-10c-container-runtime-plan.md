# V1-10C 单容器生产运行时计划

更新时间：2026-07-13

状态：`done / target localhost staging verified`

## 1. 背景

目标服务器只读审计确认：宿主机默认 Node.js 为 16.9.0，已有定制 Node.js 为 20.13.1；当前 Next.js 16.2.10 要求 Node.js >=20.9，Prisma 7.8.0 要求 Node.js ^20.19、^22.12 或 >=24，因此宿主机现有运行时不能承载当前 V1。服务器已安装 Docker 26.1.4 与 Compose 2.27.1，且尚无 ShanHaiEdu 部署目录。

V1 仍固定单应用实例、单 Prisma singleton 与 SQLite。V1-10C 采用单容器单 Node 进程，把现代 Node 运行时和 PPT/视频系统依赖固定在镜像内；SQLite 与 Artifact 继续使用 release 外 bind mount，不把数据写入镜像或 release。

## 2. 目标

- 使用 Node.js 22 Bookworm 镜像满足 Next.js 与 Prisma 的真实 engine 要求。
- 镜像包含 FFmpeg/ffprobe、LibreOffice、Poppler、curl、中文字体与最小 init。
- 容器以非 root 用户运行，只启动一个 standalone Node 进程。
- Compose 只绑定目标服务器 localhost 端口，不修改 nginx、443、80 或现有应用。
- 数据库和 Artifact 由服务器 release 外目录 bind mount；环境文件位于仓库外且权限收紧。
- 固定 password 认证、可信代理、公开注册关闭和单实例声明。
- 图片 curl Executor 在 Windows 使用 `curl.exe`，在 Linux 使用 `curl`；不依赖 PowerShell 才能走生产 curl 通道。

## 3. 范围

### 3.1 本阶段实现

1. Dockerfile、`.dockerignore` 与 V1 Compose 合同。
2. 容器运行时预检，校验 Node engine 和真实二进制。
3. 图片 curl Executor 的跨平台命令解析。
4. 本地静态合同、镜像构建和隔离容器 health/401/403 rehearsal。
5. 远端只创建全新 staging release/shared 目录并绑定 localhost；不接公网流量。

### 3.2 本阶段不做

- 不修改现有 nginx、域名、证书或 80/443 路由。
- 不覆盖 `/www/wwwroot/node`、3010、3001 或其他现有服务。
- 不调用真实 PPT、图片或视频 Provider。
- 不迁移或复制当前开发数据库，不替教师确认 V1-9 HumanGate。
- 不把公网 staging rehearsal 声称为正式邀请制上线。

## 4. 运行拓扑

```text
127.0.0.1:<staging-port>
  -> one Docker container
  -> one Node.js standalone process
  -> /srv/shanhai/data/production.db       (host bind mount)
  -> /srv/shanhai/artifacts/               (host bind mount)
  -> external env file                     (host only, not copied into image)
```

镜像运行用户固定为非 root。服务器 shared 目录由发布前步骤创建并授权给容器 UID/GID；发布和回滚不得覆盖 shared 数据。

## 5. 风险与回退

- LibreOffice 与中文字体会增加镜像体积；这是 PPT 渲染门的真实依赖，不允许为缩小镜像移除后再把渲染失败当作可降级。
- Linux 不支持本机 PowerShell wrapper；远端固定使用跨平台 curl/原生 fetch Provider路径，PowerShell wrapper仅保留本机兼容。
- 本阶段远端 staging 只绑定 localhost，失败时停止并移除新容器和新 release；不删除 shared staging 数据，不影响现有 nginx 与服务。
- 正式切流前仍需单独完成 nginx/HTTPS、公网注册关闭、release 回滚、备份恢复、真实教师签收和 V1-9 产品内真实 E2E。
## 6. 退出标准

- 静态合同测试与图片跨平台测试通过。
- Docker image build 通过，容器内 Node、FFmpeg、ffprobe、soffice、pdfinfo、pdftoppm、curl 和中文字体检查通过。
- Compose 配置证明单实例、非 root、localhost-only、password、trusted proxy、注册关闭和 release 外 bind mount。
- 隔离容器 `/api/health`=200，未认证项目 API=401，注册 API=403。
- 容器停止/重启后 SQLite 与 Artifact 探针保持可用；现有远端服务与端口不变。

## 7. 完成结论

2026-07-13 已使用精确提交 `75bf141` 在目标服务器完成镜像构建与 localhost-only staging 验证。最终镜像内 Node、媒体/文档工具、中文字体与 `better-sqlite3` 均可用，临时构建工具已清除；容器重启后 SQLite 完整性、管理员记录与 Artifact 探针保持可用。详细证据见 `local-real-v1-v1-10c-container-runtime-closeout.md`。

本阶段完成不表示公网发布。release 回滚、备份恢复、nginx/HTTPS 切流、真实教师签收仍属于 V1-10 后续发布门。
