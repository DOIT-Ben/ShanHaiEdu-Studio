# V1-10D 目标服务器回滚与恢复演练测试计划

更新时间：2026-07-13

## 1. 测试矩阵

| 编号 | 场景 | 通过标准 |
|---|---|---|
| 10D-01 | 当前基线 | `75bf141` staging healthy，200/401/403，SQLite integrity=ok |
| 10D-02 | 代码回滚 | 上一成功镜像启动，继续使用同一 shared 数据，healthy 与 200/401/403 |
| 10D-03 | 数据兼容 | 回滚前后 SQLite/Artifact 探针哈希一致，管理员记录存在 |
| 10D-04 | 代码前滚 | 精确镜像 `75bf141` 恢复，镜像 ID 与健康门正确 |
| 10D-05 | 停写窗口 | backup 前唯一 staging 已停止，3210 无监听 |
| 10D-06 | 备份与校验 | backup/verify exit 0，release id、integrity 与文件数正确且不泄露绝对源路径 |
| 10D-07 | 新目录恢复 | restore exit 0，目标此前不存在，恢复后 verify 语义一致 |
| 10D-08 | 恢复副本运行 | 独立 3211 容器 healthy，200/401/403，管理员与 Artifact 探针存在 |
| 10D-09 | 最终恢复 | 独立容器停止，`75bf141` staging healthy，原 shared 数据保持不变 |
| 10D-10 | 服务保护 | nginx config、根站、3001 与 3010 结果不变 |

## 2. 停止条件

- 回滚镜像健康失败或出现数据合同错误。
- shared 数据 hash、SQLite integrity、管理员记录或 Artifact 探针异常。
- backup/verify/restore 任一返回非零或目标覆盖保护失效。
- 3210/3211 暴露到非 loopback，或 nginx/既有服务发生变化。

触发停止条件后只恢复 `75bf141` staging，不修复或覆盖 shared 数据，并记录失败点。

## 3. 边界

本测试不调用 Provider、不生成交付包、不代替真实教师 HumanGate，不执行公网 nginx/HTTPS 切流。
