# V1-10C 单容器生产运行时检查点

更新时间：2026-07-13

状态：`implementation verified / remote build blocked`

## 1. 已完成

- 精确实现提交：`aed4d55`，未push。
- Node 22 Bookworm运行时满足Next.js 16.2.10与Prisma 7.8 engine。
- 镜像合同包含FFmpeg/ffprobe、LibreOffice、Poppler、curl、中文字体与tini。
- Compose固定单应用实例、password认证、trusted proxy、公开注册关闭、非root、drop capabilities、no-new-privileges、localhost-only端口和release外SQLite/Artifact bind mount。
- 图片curl Executor在Windows解析`curl.exe`，在Linux解析`curl`，Linux不发送Windows Schannel专用参数。

## 2. 本地证据

- 容器静态合同：1/1通过。
- 图片跨平台专项：1/1通过。
- TypeScript：exit 0。
- `npm test`：Node 268/268、Vitest 842/842，exit 0。
- `npm run build`：14/14页面，exit 0；保留5条既有Turbopack动态文件匹配警告。
- Compose静态解析：通过；本机Docker daemon未启动，因此镜像构建转目标服务器执行。

## 3. 远端隔离证据

- 白名单源码包只包含构建所需源码、配置、脚本、Prisma、fixtures与public；不含docs、私密台账、`.env`、数据库或本机产物，内容扫描未命中密钥模式。
- archive哈希在目标服务器复核一致，新release与shared-staging目录创建成功；release内`.env`数量为0，shared-staging归属容器UID/GID。
- Compose配置校验通过，未修改nginx、80、443、3010、3001或现有服务。

## 4. 两轮构建失败

1. 官方源直连：索引下载约26KB/s，预计系统依赖下载耗时数小时，停止该路径。
2. host network加本地代理：297MB在2分52秒下载完成，但4个包返回502，`apt-get` exit 100。

失败后确认：无build/apt进程、无目标镜像、无staging容器、3210未监听；nginx校验通过，原根站与3001仍为200，3010仍监听。

## 5. 恢复入口

下一次只使用已测速通过的腾讯Debian镜像恢复构建，不再重复上述两条路径。镜像成功后依次执行：隔离DB初始化、容器runtime preflight、启动、health 200、项目API 401、注册API 403、重启持久性和既有端口复核。

本检查点不表示V1-10C完成，不表示公网发布、Provider可用、release回滚、备份恢复或教师签收通过。
