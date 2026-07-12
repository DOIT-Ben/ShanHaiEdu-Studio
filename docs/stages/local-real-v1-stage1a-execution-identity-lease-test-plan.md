# ShanHaiEdu V1 Stage 1A 执行身份与项目写租约测试计划

日期：2026-07-12

状态：已执行并通过

## 1. 验收矩阵

| 编号 | 测试场景 | 必须观察到的证据 |
|---|---|---|
| 1A-01a | TurnJob 缺 actor 快照 | 不启动 executor，不产生 assistant message / Artifact / Job 写入 |
| 1A-01b | actor 已停用 | 获取执行权或首个后台写入被拒，原有历史数据只读保留 |
| 1A-01c | session 已撤销或过期 | 后台写 fail-closed，任务不能标记 succeeded |
| 1A-02 | 两个独立 Prisma client 的 worker 同时竞争同一 project | 只有一个获得有效 lease；数据库只有一个当前 holder/token |
| 1A-03 | 两个独立项目并发获取 lease | 两者均可获得，不存在全局项目锁 |
| 1A-04a | lease 过期后新 worker 接管 | 新 token 严格大于旧 token |
| 1A-04b | 旧 worker 在接管后完成 | fenced commit 被拒；TurnJob 进入 quarantined，不能 succeeded |
| 1A-05 | 当前 holder 续租 | token 不变、到期时间前移，之后仍可提交 |
| 1A-06 | 旧 holder 释放新 lease | release 无效，新 holder 仍保持当前租约 |
| 1A-07 | 旧 SQLite 数据库升级 | 新表/字段/索引存在，既有核心表行数和关键字段不变 |
| 1A-08 | 现有单项目队列 | FIFO、失败重试、blocked 状态和原有行为没有无关回归 |

## 2. 并发测试要求

- 1A-02 和 1A-03 必须使用指向同一临时 SQLite 文件的两个独立 `PrismaClient`。
- 不接受同一个 client 内两个 Promise、进程内 `Set` 或前端按钮禁用作为并发证据。
- 测试记录最终 lease 行的 `holderId`、`fencingToken` 和 expiresAt，但不输出账号、session token 或其他敏感值。

## 3. 身份测试要求

- 公共认证身份由 `LocalUser + AuthSession` 构造。
- 分别修改 `disabledAt`、`revokedAt`、`expiresAt`，不能只 mock 一个布尔值。
- session 快照只保存数据库 session id，不保存 cookie token 或 token hash。
- 本地开发身份单独测试，确保它不能绕过公共认证模式的 session 要求。

## 4. Fence 测试时序

```text
worker A acquire -> token N
worker A claim TurnJob
时间推进使 lease 过期
worker B acquire -> token N+1
worker A 尝试后台写/完成
断言写入被拒且任务不为 succeeded
```

## 5. 执行顺序

1. 先新增定向测试并确认在旧实现上失败。
2. 实现 schema、初始化升级、身份验证和 lease repository。
3. 接入 service execution guard 与 conversation queue。
4. 运行 Stage 1A 定向测试。
5. 运行相关 conversation/auth/SQLite 升级测试。
6. 运行完整 `npm test`。
7. 运行 `npm run build` 和 `git diff --check`。

## 6. 判定规则

- 任一 1A-01 至 1A-04 未通过，Stage 1A 不得标记完成。
- 仅“没有看到重复写”不算证明；必须检查数据库当前 holder/token 和任务最终状态。
- 仅 job 锁通过不算项目租约通过。
- 仅任务状态 quarantine 不代表所有产物已经原子隔离；该能力必须留给 Stage 1C 验收。
