# V1-8 多 Prisma Client 并行写阻塞记录

更新时间：2026-07-13

状态：`deferred to V1-10 deployment topology gate`

## 已知事实

- 隔离 SQLite、两个独立 PrismaBetterSqlite3 client、两个不同项目均已建立。
- 两个 client 可同时为不同项目获取 ProjectExecutionLease。
- 持有租约后，两个 client 同时更新不同项目的生成强度，第二个写入稳定超时。
- 将强度更新从交互事务改为单条条件更新仍复现。
- 启用 `journal_mode=WAL`、`synchronous=NORMAL`、15 秒 busy timeout 后仍复现。

## 失败点

SQLite 在当前 PrismaBetterSqlite3 多连接、持租约并行写组合下不能可靠完成第二个写事务。这不是项目数据串线，但会导致多进程或多副本部署时请求超时。

## 已尝试动作

1. 顺序化一次性项目建档，保留运行期并发。
2. 移除强度更新的读后写交互事务。
3. 启用 WAL、NORMAL synchronous 和 15 秒写等待。

## 影响范围

- 当前目标部署为单 Node 进程、单 Prisma singleton；两个教师请求共享数据库 client，可以继续验证。
- V1-10 不得启动多个应用进程、副本或独立 SQLite client 承担并行写，除非该阻塞已通过正式验证。
- 若发布拓扑需要多副本，应迁移到支持多写连接的数据库，或引入经过验证的单写协调层；不得用无界全局锁伪装解决。

## 恢复入口

- V1-10 部署拓扑门禁。
- 最小复现：`tests\v1-two-user-concurrency-isolation.test.ts` 中把两个 actor 服务切回两个独立 repository client，并在持有不同项目租约时并行更新强度。
