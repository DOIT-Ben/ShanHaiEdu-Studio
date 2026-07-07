# ShanHaiEdu 真实环境部署演示交接包

日期：2026-07-08

## 1. 当前结论

当前仓库已经具备两类演示前门禁：

```powershell
npm run preflight:deploy-demo
npm run demo:e2e:delivery
```

- `preflight:deploy-demo` 证明本机生产构建、SQLite schema、standalone 服务和基础 HTTP smoke 可通过。
- `demo:e2e:delivery` 证明自动化完整交付演示可跑通，包含最终材料包 ZIP。
- `deploy-demo-readiness` 不等于公网 live。真正对外演示前仍必须完成 live target、反向代理、HTTPS、进程守护、provider smoke 和公网 URL 验收。

## 2. Live Target 待填信息

实际部署前必须明确：

- 服务器供应商与实例名。
- SSH alias 或登录方式。
- 部署目录，例如 `/opt/shanhai-edu-studio/current`。
- 对外域名或公网 IP。
- 对外端口与内网应用端口。
- 进程管理方式：systemd、pm2、Docker Compose 或其他。
- 反向代理方式：nginx、Caddy、云负载均衡或其他。
- HTTPS 证书来源与续期方式。
- 数据目录与备份目录。
- 素材存储目录与容量上限。
- provider 配置来源。

这些值不得写入 git；runbook 只记录变量名、用途和验收方式。

## 3. 部署前本机门禁

在工作树执行：

```powershell
npm run preflight:deploy-demo
npm run demo:e2e:delivery
npm test
npm run build
git diff --check
```

通过后才进入服务器动作。

## 4. 服务器部署顺序

推荐顺序：

1. 在服务器建立 release 目录与共享数据目录。
2. 上传源码或 release bundle。
3. 安装 Node.js 与依赖。
4. 写入服务器本地 `.env`，只放在服务器，不进入 git。
5. 创建 SQLite 数据目录与素材存储目录。
6. 执行：

```bash
npm ci
npm run preflight:production
npm run db:init
npm run build
```

7. 启动 standalone 服务或 `npm run start`。
8. 配置进程守护。
9. 配置 nginx / reverse proxy。
10. 配置 HTTPS。
11. 执行公网验收。

## 5. 远程健康检查

服务器内检查：

```bash
curl -fsS http://127.0.0.1:<APP_PORT>/
curl -fsS http://127.0.0.1:<APP_PORT>/api/workbench/projects
```

公网检查：

```bash
curl -I https://<PUBLIC_HOST>/
curl -fsS https://<PUBLIC_HOST>/api/workbench/projects
```

浏览器检查：

- 打开 public URL。
- 新建项目。
- 输入公开课需求。
- 确认右侧产物能显示。
- 下载最终材料包。
- 检查浏览器 console 无阻断级错误。

## 6. Provider Smoke

生产预检只证明 provider 配置类别存在，不证明实时 provider 一定可用。正式演示前需要按实际演示目标选择 smoke：

```bash
node scripts/openai-smoke.mjs
node scripts/image-smoke.mjs
node scripts/video-smoke.mjs
node scripts/coze-ppt-smoke.mjs
```

如果某个 provider smoke 失败：

- 不宣称该 provider live 可用。
- 可切换到 `demo:e2e:delivery` 的 local-substitute 演示路线。
- 对外说明当前演示模式。

## 7. 反向代理与 HTTPS 检查

nginx / reverse proxy 必须确认：

- `/` 转发到应用端口。
- `/api/*` 转发到同一个应用。
- WebSocket 或长连接策略按后续真实任务再补。
- 上传/下载大小限制满足 PPTX、图片、视频材料包。
- 缓存策略不返回旧 demo 页面。
- HTTPS 强制跳转或证书策略符合演示要求。

最低验收：

```bash
curl -I https://<PUBLIC_HOST>/
curl -I https://<PUBLIC_HOST>/api/workbench/projects
```

## 8. 回滚

上线前必须有：

- 当前 release 目录备份。
- 当前 `.env` 备份，仅在服务器本地保存。
- SQLite 数据库备份。
- 素材目录备份策略。
- 上一个可运行 release 的启动命令。

回滚顺序：

1. 停止新服务。
2. 恢复上一个 release 软链或目录。
3. 恢复数据库备份，必要时恢复素材目录。
4. 重启进程守护。
5. 重新执行公网 `curl` 与浏览器验收。

## 9. 演示当天 Run Order

演示前本机：

```powershell
npm run preflight:deploy-demo
npm run demo:e2e:delivery
```

演示前服务器：

```bash
npm run preflight:production
curl -I https://<PUBLIC_HOST>/
curl -fsS https://<PUBLIC_HOST>/api/workbench/projects
```

演示时：

1. 打开 public URL。
2. 现场新建项目。
3. 输入公开课需求。
4. 展示需求、教材证据、教案、PPT 大纲、导入视频方案。
5. 下载最终交付包。
6. 如真实 provider 未现场触发，明确说明当前演示的是自动交付链路，不冒充实时生成成功。
