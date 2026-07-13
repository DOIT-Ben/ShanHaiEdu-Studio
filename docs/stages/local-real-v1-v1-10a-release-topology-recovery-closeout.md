# V1-10A 单实例发布拓扑与数据恢复收尾

更新时间：2026-07-13

## 1. 结论

V1-10A 已关闭目标服务器窗口之前可本地完成的发布工程合同：生产预检现在拒绝多实例 SQLite 拓扑；应用提供脱敏 readiness 健康检查；离线恢复 CLI 可以对 SQLite WAL 已提交数据和完整 Artifact 目录执行 backup、SHA-256 manifest校验、verify和恢复到新目录。

本结论不表示目标服务器已部署、共享卷已重启、真实 release 已回滚、生产备份已恢复或教师已签收。

## 2. 实现

- `production-preflight.mjs` 新增 `single-instance-topology`：要求 `SHANHAI_APP_INSTANCE_COUNT=1`，并拒绝已知多worker覆盖。
- `/api/health` 实际读取SQLite并对Artifact根做创建、fsync、删除探针；正常返回200，依赖异常返回503，响应不含路径、SQL、Provider或堆栈且`Cache-Control=no-store`。
- `release-data-recovery.mjs`：
  - SQLite backup API捕获WAL已提交数据；
  - 备份副本在签名前规范化为单文件DELETE journal；
  - Artifact普通文件流式SHA-256，拒绝符号链接、路径逃逸和特殊文件；
  - manifest绑定release id，只记录相对路径、size、hash、integrity和文件数；
  - verify拒绝缺失、额外、篡改或损坏；
  - restore先完整verify，只写不存在的新数据库和Artifact目录。
- package新增 `release:data:backup`、`release:data:verify`、`release:data:restore`。
- 新增V1邀请制发布与恢复runbook，明确代码回滚和数据灾难恢复分离。

## 3. 真实与隔离证据

- 正在运行的本地产品 `GET http://localhost:3110/api/health` 返回HTTP 200：数据库与Artifact storage均为`ok`。
- 隔离恢复rehearsal从WAL数据库和两层Artifact目录生成备份，verify通过，恢复后数据库行和文件字节一致。
- CLI按backup、verify、restore三个真实子命令运行，全部exit 0；标准输出不包含测试根路径。
- hash篡改、额外文件、符号链接、未确认离线状态和已有恢复目标均稳定拒绝。
- 当前开发 `.env` 的生产预检按设计未通过：仍缺客户端密码构建模式、可信代理、单实例声明、客户端注册关闭、release外绝对数据库和真实管理员。未直接修改开发配置冒充生产环境。

## 4. 验证

- 专项：Node 17/17、Vitest 4/4、TypeScript通过。
- 全量：Node 267/267、Vitest 841/841，`npm test` exit 0。
- 构建：`npm run build` exit 0，14/14页面；保留5条既有Turbopack动态文件匹配警告。
- 进程：未发现残留Vitest、Jest或Playwright worker。

## 5. 安全与回退

- 未读取、复制或输出任何密钥和私有端点。
- 未备份当前开发/生产数据库，未写真实共享卷，未部署，未切换release或公网流量。
- 本阶段没有数据库Schema迁移；代码可独立revert，恢复工具默认拒绝覆盖已有数据。

## 6. 剩余发布门

1. V1-9真实教师确认后，由产品Main Agent继续真实PPT、视频、Critic、HumanGate、Quality Gate和最终包E2E。
2. 在目标服务器设置生产构建变量、单实例进程守护、release外SQLite/Artifact和真实管理员，使production preflight通过。
3. 执行目标服务器共享卷重启、release回滚、备份恢复、公开注册关闭和公网健康检查。
4. 外部Codex对产品生成的最终包做黑盒审核；至少一名真实教师完成任务、局部返修、下载和可授课签收。
