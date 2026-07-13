# ShanHaiEdu V1 邀请制发布与恢复 Runbook

更新时间：2026-07-13

## 1. 发布拓扑

V1 固定使用：

```text
反向代理 / HTTPS
  -> 单个 Node.js 应用进程
  -> 单个 Prisma singleton
  -> release 外 SQLite 文件
  -> release 外 Artifact 共享目录（包含 feedback 附件）
```

生产环境必须显式设置 `SHANHAI_APP_INSTANCE_COUNT=1`。`WEB_CONCURRENCY`、`PM2_INSTANCES`、`NODE_CLUSTER_WORKERS` 若存在也只能为 `1`。不得使用 PM2 cluster、多 Node worker、多容器副本或多主机实例共享同一 SQLite。

若需要多副本，先迁移到支持目标并发拓扑的数据库，或实现并验证独立单写协调层；不得用前端禁用、无界进程锁或运维约定冒充并发安全。

## 2. 数据与 Release 分离

服务器上至少分为：

```text
releases/<release-id>/       只读代码与构建输出
shared/data/                 SQLite
shared/artifacts/            PPT、图片、视频、最终包与 feedback 附件
backups/<backup-id>/         恢复包
current -> releases/<id>/    当前 release 指针
```

路径由目标服务器本地配置决定，不写入仓库。`DATABASE_URL` 必须是 release 外绝对 SQLite `file:` 地址；`ARTIFACT_STORAGE_ROOT` 必须是 release 外真实可读写目录。

## 3. 发布前门禁

应用仍在线时先完成代码与配置检查；数据备份前再进入停写窗口。

```powershell
npm test
npm run build
npm run preflight:production
```

`preflight:production` 必须全部为 `ok=true`，至少证明：密码认证、可信代理、公开注册关闭、单实例拓扑、release 外数据库、真实管理员、release 外 Artifact 根和四类 Provider 配置存在。

## 4. 离线备份

备份工具不会伪装在线原子快照。执行前必须停止应用进程并确认没有 worker、脚本或管理员任务继续写 SQLite/Artifact。

```powershell
npm run release:data:backup -- `
  --database <SQLITE_ABSOLUTE_PATH> `
  --artifacts <ARTIFACT_ROOT_ABSOLUTE_PATH> `
  --backup <NEW_BACKUP_DIRECTORY> `
  --release-id <GIT_COMMIT_OR_RELEASE_ID> `
  --confirm-offline

npm run release:data:verify -- --backup <BACKUP_DIRECTORY>
```

通过标准：

- backup 与 verify 均 exit 0、`ok=true`。
- SQLite `integrity_check=ok`。
- manifest 记录release id、相对路径、size、SHA-256 和文件数量，不记录源绝对路径。
- 符号链接、路径逃逸、缺失/额外文件、hash变化或数据库损坏全部失败。

## 5. 发布与健康检查

1. 创建新 release，不覆盖旧 release。
2. 安装锁定依赖并构建。
3. 复用 shared SQLite 与 Artifact 目录。
4. `npm run preflight:production` 通过后启动唯一应用进程。
5. 先检查本机，再切反向代理：

```text
GET http://127.0.0.1:<port>/api/health
```

预期 HTTP 200：

```json
{"status":"ok","checks":{"database":"ok","artifactStorage":"ok"}}
```

该接口不检查 Provider，也不返回路径、SQL、账号、密钥或异常堆栈。任一数据依赖不可用时返回503。随后验证未认证业务API为401、公开注册为403，并用受控教师账号完成登录、项目读取、反馈读取和一个无媒体写操作。

## 6. 代码 Release 回滚

代码回滚不等于数据恢复：

1. 停止新 release 的唯一应用进程。
2. 将 `current` 切回上一可运行 release。
3. 继续挂载当前 shared 数据，不自动恢复旧数据库或 Artifact 备份。
4. 启动单实例并检查 `/api/health`、登录、项目、旧产物和反馈附件。
5. 若旧代码与当前数据合同不兼容，停止回滚并采用前向修复；不得覆盖新数据。

## 7. 灾难恢复 Rehearsal

只有数据库或 Artifact 确认损坏、且已接受备份点之后的数据损失时，才进入数据恢复。先保留损坏现场副本，再恢复到全新的目标路径：

```powershell
npm run release:data:verify -- --backup <BACKUP_DIRECTORY>

npm run release:data:restore -- `
  --backup <BACKUP_DIRECTORY> `
  --database-target <NEW_SQLITE_PATH> `
  --artifacts-target <NEW_ARTIFACT_ROOT> `
  --confirm-offline
```

restore 拒绝覆盖任何已有数据库文件或 Artifact 目录。恢复成功后，把临时环境指向新目标，执行 schema 初始化幂等检查、`preflight:production`、`/api/health`、登录、项目/产物/反馈抽检；全部通过后才允许切换正式配置。

## 8. 发布停止条件

出现以下任一情况立即停止或回滚：

- `/api/health` 返回503。
- 生产预检发现多实例、数据目录位于 release 内或公开注册开启。
- SQLite integrity、manifest hash、Artifact 文件集合不一致。
- 登录、项目归属、反馈附件、最终包下载或跨账号隔离异常。
- 新增 P0、安全问题、脏提交或重复 Provider 计费。

目标服务器共享卷重启、release 回滚、备份恢复、公网配置复核和真实教师签收必须保存脱敏证据；本地自动化 rehearsal 不能替代这些最终发布门。
