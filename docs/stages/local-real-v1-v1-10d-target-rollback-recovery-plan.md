# V1-10D 目标服务器回滚与恢复演练计划

更新时间：2026-07-13

状态：`accepted / in progress`

## 1. 目标

在不切换 nginx、公网流量、域名或证书的前提下，使用 V1-10C 已通过的 localhost-only staging 关闭两项剩余服务器门：代码 release 回滚/前滚，以及停写备份后恢复到全新数据目录。

## 2. 范围

1. 记录当前 `75bf141` 镜像、共享 SQLite 与 Artifact 基线。
2. 使用已保留的上一成功镜像回滚同一 staging，继续挂载当前共享数据并验证 200/401/403、SQLite 与 Artifact。
3. 前滚回 `75bf141` 精确镜像并复验相同门禁。
4. 停止唯一 staging 容器，确认 3210 无监听后执行离线 backup 与 verify。
5. restore 到不存在的全新 SQLite 文件和 Artifact 目录，不覆盖 shared-staging。
6. 使用独立容器和 `127.0.0.1:3211` 挂载恢复副本，验证 200/401/403、SQLite integrity、管理员记录与 Artifact 探针。
7. 停止独立恢复容器，恢复 `75bf141` staging，保留备份、恢复副本和脱敏证据供审计。
8. 对演练发现的 WAL 数据目录只读挂载导致 SQLite backup 无限重试增加 fail-closed 进度门禁，并更新 runbook。

## 3. 不变量

- 代码回滚复用当前 shared 数据，不自动恢复旧备份。
- 数据恢复只写全新目录，任何非空目标、hash 异常或 SQLite 损坏都停止。
- 全程保持单应用实例访问同一 SQLite；备份窗口内 staging 必须停止。
- 不读取、打印或提交外部环境文件中的密钥与账号值。
- 不修改 nginx、80/443、3010、3001 或其他服务，不调用真实媒体 Provider。

## 4. 风险与回退

- 旧镜像若与当前数据合同不兼容，立即停止回滚并前滚 `75bf141`，不得修改共享数据。
- 备份/恢复任一步失败时保留原 shared 数据和当前镜像，重新启动 `75bf141` staging。
- SQLite backup 连续无进展或超过合理时限时必须明确失败，不能持续占用 CPU；失败目录不自动删除。
- 独立恢复容器仅绑定 3211；冲突或健康失败时移除该容器，不切换正式数据挂载。

## 5. 退出标准

- 旧镜像回滚与新镜像前滚均 healthy，200/401/403 通过，共享数据哈希与记录保持一致。
- backup、verify、restore 均 exit 0，manifest 脱敏且 SQLite integrity=ok。
- 恢复副本的独立容器 healthy，200/401/403 通过，管理员记录与 Artifact 探针存在。
- 最终 `75bf141` staging 恢复 healthy；nginx、根站、3001、3010 保持不变。

本阶段不表示公网上线或教师签收完成。
