# V1-10C 单容器生产运行时测试计划

更新时间：2026-07-13

## 1. 自动化合同

| 编号 | 场景 | 通过标准 |
|---|---|---|
| 10C-01 | Node engine | 镜像 Node 满足 Next.js 与 Prisma 要求，不使用服务器 Node 16/20.13 |
| 10C-02 | 系统工具 | FFmpeg、ffprobe、soffice、pdfinfo、pdftoppm、curl 和中文字体均可执行 |
| 10C-03 | 图片 Executor | Windows解析`curl.exe`，Linux解析`curl`，密钥仍只经stdin配置传入 |
| 10C-04 | 构建隔离 | `.env`、数据库、Artifact、API私密台账、测试产物和本机依赖不进入镜像上下文 |
| 10C-05 | 单实例 | Compose只有一个应用服务，固定`SHANHAI_APP_INSTANCE_COUNT=1`且不允许host network/privileged |
| 10C-06 | 认证边界 | password、trusted proxy、公开注册关闭同时写入server和client构建/运行时 |
| 10C-07 | 数据边界 | SQLite与Artifact分别挂载到release外路径，环境文件来自仓库外 |
| 10C-08 | 进程权限 | 容器非root，drop capabilities并启用no-new-privileges |
| 10C-09 | localhost staging | 端口只绑定127.0.0.1，不改变nginx/80/443 |
| 10C-10 | readiness | health=200、未认证项目API=401、注册API=403 |
| 10C-11 | 重启持久性 | 容器重启后health仍为200，SQLite与Artifact探针保持可用 |
| 10C-12 | 现有服务保护 | staging前后既有监听端口和nginx配置校验结果不变 |

## 2. 验证命令

```powershell
node --test tests\container-deployment.test.mjs
npx vitest run tests\image-provider-curl-run.test.ts --maxWorkers=1
docker compose -f deploy\v1-compose.yml config --quiet
docker build -t shanhai-edu-studio:v1-10c .
```

容器运行后执行：

```text
GET /api/health -> 200
GET /api/workbench/projects -> 401
POST /api/auth/register -> 403
```

## 3. 阶段验收

```powershell
npx tsc --noEmit --pretty false
npm test
npm run build
git diff --check
```

远端 rehearsal 不调用真实媒体 Provider，不接公网流量，不替代 V1-9 与正式发布恢复门。
