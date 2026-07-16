# V1-10A 单实例发布拓扑与数据恢复计划

更新时间：2026-07-13

状态：`accepted / in_progress`

## 1. 背景与目标

V1-8 已证明两名教师在单应用进程、单 Prisma singleton、SQLite WAL 下可以在不同项目受控并发，同时明确多应用进程或多副本共享 SQLite 尚未证明安全。V1-10A 先关闭不依赖目标服务器窗口的发布工程合同：生产预检必须拒绝多实例拓扑，健康检查必须证明数据库和 Artifact 共享卷可用，离线恢复工具必须能对 SQLite 与 Artifact 文件形成可校验备份并恢复到新目录。

本阶段不部署、不切换公网流量、不修改真实生产数据库或共享卷，也不替代目标服务器重启、release 回滚和真实教师签收。

## 2. 范围

1. 生产预检新增显式单实例声明，拒绝 `SHANHAI_APP_INSTANCE_COUNT != 1` 及已知 cluster/worker 多实例配置。
2. 新增只返回稳定状态码和脱敏检查名的 `/api/health`：验证 SQLite 可读、Artifact 根目录可读写，不返回路径、SQL、账号或 Provider 信息。
3. 新增离线数据恢复 CLI：
   - `backup` 使用 SQLite backup API 生成一致数据库快照；
   - 复制 Artifact 目录中的普通文件，拒绝符号链接和路径逃逸；
   - 生成绑定release id的SHA-256 manifest；
   - `verify` 对数据库完整性、文件集合和 hash 做验证；
   - `restore` 只恢复到不存在或空的新目标，拒绝覆盖现有数据。
4. 更新生产 runbook，明确停写、备份、验证、发布、健康检查、回滚和恢复顺序。

## 3. 不变量

- SQLite 发布拓扑固定为单 Node 应用进程、单 Prisma singleton；多副本上线前必须迁移数据库或另行证明单写协调层。
- 备份和恢复必须显式确认应用已停写；工具不伪装跨数据库与文件系统的在线原子快照。
- release 目录与数据目录分离；代码回滚不得覆盖数据库、Artifact 或反馈附件。
- 任何 manifest、日志和 API 响应不得包含密钥、数据库绝对路径、Artifact 绝对路径或个人信息。
- 恢复默认 fail-closed：hash、SQLite integrity、符号链接、额外文件、缺失文件或非空目标任一异常即停止。

## 4. 实施顺序

1. 先补生产拓扑、健康检查和恢复 CLI 的失败测试。
2. 扩展 `production-preflight.mjs`，保持现有检查兼容。
3. 实现 health readiness helper 与 API route。
4. 实现离线 backup/verify/restore 和 package scripts。
5. 在隔离临时目录完成两次备份验证、恢复、二次校验和损坏拒绝。
6. 更新 runbook、全量测试、构建和 closeout。

## 5. 回退

本阶段不迁移数据库 Schema。代码回退可独立 revert V1-10A 提交；已有发布数据不需要转换。恢复工具只写用户指定的新目录，测试只写隔离临时目录。

## 6. 退出标准

- 生产预检对单实例通过、对多实例稳定失败。
- 健康检查在数据库/Artifact正常时返回200，任一不可用时返回503且不泄露路径。
- 备份 manifest、SQLite快照和Artifact文件通过hash与integrity验证。
- 恢复后的数据库记录与Artifact文件逐项一致；损坏、符号链接和非空目标稳定拒绝。
- 专项、全量、TypeScript和生产构建全部通过；真实目标服务器门仍明确保持 pending。
