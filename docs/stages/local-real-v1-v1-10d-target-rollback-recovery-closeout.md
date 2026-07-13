# V1-10D 目标服务器回滚与恢复演练收尾

更新时间：2026-07-13

状态：`done / target localhost rehearsal verified`

## 1. 完成内容

- 当前共享 SQLite 与 Artifact 上完成上一成功镜像回滚，再前滚到 V1-10C 精确镜像；两个方向均未恢复旧数据。
- 停止唯一 staging 并确认 3210 无监听后，使用正式 CLI 完成 backup、verify 和 restore 到全新目录。
- 恢复副本通过独立 `127.0.0.1:3211` 容器启动验证；验证后容器已停止，3211 无监听。
- 演练发现 WAL 数据目录错误挂为文件系统只读时，`better-sqlite3` backup 会持续高 CPU；精确提交 `c7533ef` 增加无进展与总耗时双门禁，并更新 runbook。
- 修复镜像 `sha256:7f49d645ffbc47381619f21e48084a97226dd8116d3fb7f50148de6dd11e0ecd` 已接管 localhost staging。

## 2. 目标服务器证据

| 门禁 | 结果 |
|---|---|
| 代码回滚 | 上一镜像 healthy，health=200、项目=401、注册=403 |
| 数据不变 | 回滚与前滚前后 SQLite/Artifact 探针哈希一致 |
| 代码前滚 | 修复前精确镜像 healthy，200/401/403 |
| 停写窗口 | staging停止，3210监听数=0 |
| 数据备份 | backup与verify均`ok=true`，release=`75bf141`，integrity=ok，Artifact文件数=1 |
| 全新目录恢复 | restore=`ok=true`，未覆盖 shared-staging |
| 恢复副本 | 3211 healthy，200/401/403，SQLite integrity=ok，管理员=1，Artifact探针存在 |
| 负例修复 | 错误只读WAL挂载在0秒内exit 2，未触发10秒外部timeout |
| 最终 staging | 精确提交`c7533ef`镜像 healthy，SQLite integrity=ok，管理员与Artifact探针存在 |
| 服务保护 | 单staging容器，3210仅loopback；nginx通过，根站与3001=200，3010仍监听 |

## 3. 本地验证

- 恢复专项：8/8通过。
- 完整 Node：269/269通过。
- 完整 Vitest：119文件、842/842通过。
- 生产构建：exit 0，14/14页面；保留5条既有Turbopack动态文件追踪警告。
- `git diff --check`：通过。
- 未发现本轮残留Vitest/Jest/Playwright worker；3个既有Playwright daemon创建时间早于本轮测试，未停止。

## 4. 失败路径与处理

- 首次容器化备份把 WAL 数据目录挂为`:ro`，444KB数据库的backup持续约4分钟并占用单核100%，目标文件保持0字节。
- 该备份容器被定向停止，预设trap恢复原staging；health=200且无额外备份容器残留。
- 正确挂载下backup/verify/restore一次通过。修复后同一错误挂载快速返回通用exit 2，不打印绝对源路径或内部异常。
- 两个未签名失败备份目录保留在受限服务器备份根下，未做未经授权的删除；它们不能通过verify，也不作为恢复点。

## 5. 残余边界

- localhost staging、代码回滚和数据恢复均已通过，但 nginx/HTTPS 尚未切向 ShanHaiEdu，不能称为公网上线。
- 公开注册在 localhost API 已稳定返回403；正式域名切流后仍需复核。
- V1-9 仍停在真实教师需求确认 HumanGate；外部 Codex 不代替批准。
- 至少一名真实教师的产品内完整任务、局部返修、下载和可授课签收仍未完成。

## 6. 下一阶段

1. 回收 V1-9 真实教师需求确认，由产品 Main Agent 独立完成一次真实 PPT、视频、Critic、HumanGate、Quality Gate 与最终包 E2E。
2. 外部 Codex 仅在最终成包后黑盒审核并归因，不介入中间样张、创意和返修决策。
3. V1-9通过后执行正式 nginx/HTTPS 切流，复核域名健康、注册403、登录、项目、产物与反馈，再完成教师签收。
