# ShanHaiEdu V1-8 两用户并发与恢复收尾

更新时间：2026-07-13

状态：`done for single-process V1 topology`

## 1. 完成内容

- 新增双 password actor、双项目、单应用 Prisma singleton 的隔离 SQLite 综合测试。
- 两个项目可同时持有独立 ProjectExecutionLease；同一项目第二 worker 获取租约失败，不影响另一项目。
- 两项目生成强度与 intensityVersion 独立，分别保持增强和深度档。
- 两项目可建立相同幂等键和相同 `shotId` 的 GenerationJob/VideoShot，projectId、sourceArtifactId、inputHash 和状态不串线。
- Provider taskId 在服务端 SQLite 中分别绑定各自项目；教师可见 DTO 不暴露底层 taskId。
- 已持久化 taskId 的恢复路径实测 submit=0、poll=1。
- 两项目预算事件分别保存在各自消息元数据；交叉快照访问返回项目不存在。
- SQLite 初始化启用 WAL、NORMAL synchronous 和 15 秒 busy timeout；第二连接实测 `journal_mode=wal`。
- 生成强度更新改为单条条件写，保留归档/回收站和乐观版本门禁，减少读后写事务升级风险。

## 2. 验证证据

| 门禁 | 结果 |
|---|---|
| V1-8 专项 | 7 文件，43/43 通过 |
| 双用户综合 | 1/1 通过 |
| TypeScript | `npx tsc --noEmit --pretty false` exit 0 |
| Node | 259/259 通过 |
| 完整 Vitest | 随 `npm test` 正常完成；终端尾部摘要被截断 |
| 生产构建 | exit 0，13 个静态页面；保留 4 条既有动态文件追踪性能警告 |
| SQLite | 隔离数据库、WAL 实测、双 actor 状态隔离与恢复通过 |
| diff | `git diff --check` exit 0 |
| 浏览器 | 本阶段无 UI 改动；既有双账号桌面/390px权限证据保留，本阶段不重复 |

## 3. 部署拓扑边界

- V1-8 证明的是当前目标部署：单 Node 进程、单 Prisma singleton、两名教师并发请求。
- 两个独立 PrismaBetterSqlite3 client 在分别持有项目租约后并行写不同项目，稳定出现第二写事务超时。
- 单条条件更新、WAL 和 15 秒 busy timeout 均未关闭该多 client 问题；详情见 `local-real-v1-v1-8-multi-client-sqlite-write-blocker.md`。
- V1-10 发布时必须保持单应用实例，禁止 PM2 cluster、多 Node worker 或多副本共享同一 SQLite；若需要多副本必须先迁移数据库或验证专用单写协调层。

## 4. 边界

- 未调用真实媒体 Provider，未生成新交付包。
- 未扩展到十用户、组织多租户、SSO 或复杂 RBAC。
- 没有用全局业务锁规避并发；项目级租约仍是写者边界。
- V1-8 不证明真实 Provider 容量，真实端到端只在 V1-9 执行一次。

## 5. 下一阶段

进入 V1-9 产品内真实 E2E：由产品 Main Agent 从界面独立完成一次真实 PPT、图片、视频与最终包，产品内部完成两道视频 Critic；外部 Codex 只在成包后黑盒审核。执行前先关闭真实视频 FFmpeg/ffprobe、五类成片证据和最终包版本一致性缺口。
