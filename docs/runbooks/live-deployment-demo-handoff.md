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

ShanHaiEdu 内测反馈中心上线时，固定使用 release 外共享目录：

```text
/opt/shanhai-edu-studio/shared/data/
/opt/shanhai-edu-studio/shared/artifact-storage/
```

服务器 `.env` 中：

- `DATABASE_URL` 指向 shared data 下的 SQLite 文件。
- `ARTIFACT_STORAGE_ROOT` 指向 shared artifact-storage。
- feedback 图片写入 `feedback` 子目录。
- `SHANHAI_AUTH_MODE=password`。
- `NEXT_PUBLIC_SHANHAI_AUTH_MODE=password`，并在构建阶段注入，保证前端显示密码登录门禁。
- 公开自助注册开关保持关闭；内测账号通过受控 invite/bootstrap 流程创建。

发布、回滚和替换 release 时不得覆盖 shared 目录。首个管理员通过一次性、服务器本地执行的 bootstrap 命令创建或提升为 `role=admin`；命令必须要求显式确认，只输出用户 ID/角色而不回显密码或 hash。完成后登录验证 `actor.isAdmin=true`，并删除一次性 bootstrap 输入。凭据不写入仓库。

内测准入门禁：

- 公网不显示“创建账号”，注册 API 在邀请开关关闭时返回 403。
- 内测教师账号由管理员生成一次性邀请码或执行服务器本地 invite 命令创建。
- 登录、注册/邀请和反馈提交需要速率限制与审计日志；未完成前不得开放公网内测。

## 5. 远程健康检查

服务器内检查：

```bash
curl -fsS http://127.0.0.1:<APP_PORT>/
curl -i http://127.0.0.1:<APP_PORT>/api/workbench/projects
```

未认证的 `/api/workbench/projects` 预期返回 HTTP 401；不能把 200 当作 password 模式健康标准。登录后的业务检查通过受控测试账号或浏览器会话完成。

公网检查：

```bash
curl -I https://<PUBLIC_HOST>/
curl -i https://<PUBLIC_HOST>/api/workbench/projects
```

公网未认证业务 API 预期返回 HTTP 401；公开注册 API 在邀请制关闭时预期返回 HTTP 403。

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

第二条预期为受控的 HTTP 401，而不是匿名 200。

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
3. 保持当前 shared 数据库和素材目录不变；如果旧 release 与新 schema 不兼容，先执行前向兼容修复或停止回滚，不得自动覆盖用户反馈。
4. 重启进程守护。
5. 重新执行公网 `curl`、登录、反馈读取和浏览器验收。

数据灾难恢复与代码 release 回滚必须分开：

- 只有确认数据库或素材已经损坏，且用户接受备份时间点之后的数据损失时，才恢复数据库/素材备份。
- 数据恢复前再次备份当前损坏现场，并记录恢复点和预计丢失窗口。
- 不得把“代码发布失败”当作恢复旧数据库备份的理由。

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
curl -i https://<PUBLIC_HOST>/api/workbench/projects
```

第三条预期为未认证 HTTP 401；后续业务检查通过受控内测账号登录完成。

演示时：

1. 打开 public URL。
2. 现场新建项目。
3. 输入公开课需求。
4. 展示需求、教材证据、教案、PPT 大纲、导入视频方案。
5. 下载最终交付包。
6. 如真实 provider 未现场触发，明确说明当前演示的是自动交付链路，不冒充实时生成成功。
