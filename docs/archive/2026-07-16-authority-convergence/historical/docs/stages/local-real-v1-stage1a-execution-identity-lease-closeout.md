# ShanHaiEdu V1 Stage 1A 执行身份与项目写租约收尾

日期：2026-07-12

状态：完成

关联需求：`RQ-022` 的 Stage 1A 切片

## 1. 阶段结论

Stage 1A 已建立后台对话执行的身份与项目级写租约底座：

- TurnJob 持久化 actor、auth mode 和数据库 session id，不保存 cookie token 或 token hash。
- 公共认证后台执行前和写入前重新验证用户、session、项目写权限。
- 同项目通过 SQLite 持久化 lease 选出一个有效 holder，不再把进程内 `Set` 当作并发正确性来源。
- 租约接管产生单调 fencing token；同 holder 过期重获也递增 token。
- 后台 service 的 write/generate 操作统一执行 identity + lease guard。
- 默认 ConversationTurn executor 已改用 execution-scoped service，未保留未守卫闭包。
- 旧 fence 完成任务时不能写成 succeeded；仍拥有该 job 的旧 worker 会把任务标记为 `quarantined`。
- 旧 worker 不能覆盖已被新 fence 重领的 job。

Stage 1A 完成不等于 RQ-022 或 V1 完成。IntentEpoch、Provider 幂等恢复属于 Stage 1B；Artifact/Node/Job staging 和跨表原子提升属于 Stage 1C。

## 2. 主要实现

| 区域 | 实现 |
|---|---|
| 数据模型 | `ConversationTurnJob` 新增执行身份与 fence；新增一项目一行的 `ProjectExecutionLease` |
| 旧库升级 | `scripts\init-sqlite-schema.mjs` 幂等补表、补列、补索引 |
| 身份守卫 | `execution-identity.ts` 验证缺失身份、停用用户、撤销/过期 session 和项目写权限 |
| 租约仓库 | 原子 acquire、renew、release、assert-current；过期接管 token 单调递增 |
| 请求入口 | `workbench-route.ts` 从真实解析 session 构造入队身份快照 |
| 队列 | 唯一 worker id、数据库 lease、心跳续租、execution-scoped service、fenced completion |
| 隔离状态 | 失效身份或旧 fence 使用 `quarantined`，不伪装成功 |

## 3. 验收证据

| 编号 | 结果 | 证据 |
|---|---|---|
| 1A-01 | 通过 | 缺 actor、停用 actor、撤销 session、过期 session 均 fail-closed；缺 actor/撤销 session 不调用 executor |
| 1A-02 | 通过 | 同一 SQLite 文件上的两个独立 Prisma client 同时竞争，同项目仅一个 lease 成功 |
| 1A-03 | 通过 | 两个独立 client 对不同项目并发获取 lease，二者均成功 |
| 1A-04 | 通过 | 过期接管 token 递增；旧 worker 完成进入 quarantine，不能 succeeded |
| 1A-05 | 通过 | 当前 holder 续租不改变 token，延长到期时间 |
| 1A-06 | 通过 | 非当前 holder/token 的 release 不影响当前 lease |
| 1A-07 | 通过 | 旧 SQLite TurnJob 保留；新增列、租约表和索引可幂等升级 |
| 1A-08 | 通过 | 原 M60 FIFO、重试、blocked、默认 executor 等 13 项回归通过 |

新鲜命令证据：

```text
npx vitest run ...Stage 1A/相关回归... --maxWorkers=1
25/25 passed

npx tsc --noEmit
exit 0

npm test
Node 259/259 passed
Vitest 494/494 passed

npm run build
Next.js production build exit 0

git diff --check
exit 0
```

## 4. 审查修正

实施过程中发现并修正：

1. 定向 Vitest 初跑绕过数据库初始化，旧测试库缺新列；改按真实入口初始化后复测。
2. 两套源码加载型安全测试不接受路由新增运行时 import；改为直接从已解析 session 构造三字段快照，认证行为保持不变。
3. 默认 executor 原先闭包引用未守卫 service；改为使用队列传入的 execution-scoped service。
4. 旧 worker quarantine 更新原先可能覆盖新 worker token；改为 status + fencingToken 条件更新，冲突时拒绝旧提交。
5. 隐式测试身份会弱化 fail-closed；已删除生产 service 中的测试分支，测试身份只存在于 M60 测试夹具。
6. 同 holder 过期重获若复用 token 会留下 ABA 风险；已改为过期后必增 token。

## 5. 未关闭边界

- 当前业务写仍是多次提交；Stage 1A 通过每次写前 guard 阻断后续写，但 Provider 返回后的 Artifact/Node/Job 整体 staging 与原子提升要到 Stage 1C。
- 还没有 `IntentEpoch`、`RunInputSnapshot`、`inputHash`、GenerationJob providerTaskId/pollState；进入 Stage 1B 实施。
- 本阶段是后端执行安全改动，没有新增教师界面，因此未新增浏览器 UI 验收。
- 未执行真实外部 Provider、目标服务器恢复或邀请上线；这些仍是后续发布门禁。
- 未提交、未 push、未部署，既有 `v1` 标签未移动。

## 6. 下一阶段

```text
Stage 1B：输入代际、幂等与 Provider 任务恢复
```

先冻结 IntentEpoch、RunInputSnapshot、inputHash、idempotencyKey 和 provider task 恢复合同，再写 1B 红测；不能在 Stage 1B 提前宣称 Stage 1C 的原子可见性完成。
