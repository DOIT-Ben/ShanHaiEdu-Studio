# ShanHaiEdu V1 Stage 1A 执行身份与项目写租约计划

日期：2026-07-12

状态：已完成

关联需求：`RQ-022`

## 1. 目标

Stage 1A 要把后台对话执行从“请求进程内顺手异步执行”提升为可被数据库验证的受控写执行：

```text
持久化 actor/session 快照
-> 执行前重新验证身份
-> 获取项目级写租约
-> 携带单调 fencing token 执行
-> 每次后台写前复核身份与租约
-> 仅允许当前 fence 完成任务提交
```

本阶段必须证明：同一项目只有一个有效写者；不同项目可并发；账号停用、会话撤销或身份缺失后不再产生后台写入；租约过期后旧 worker 不能提交。

## 2. 当前事实

- `activeProjectDrains` 只在单个 Node.js 进程内生效，不能跨进程互斥。
- `ConversationTurnJob.lockedBy/lockedUntil` 是任务级领取标记，不是项目级唯一写者协议。
- `ConversationTurnJob` 未保存 actor、auth mode 或 session 快照。
- 消息路由把请求期 service 直接交给后台 drain；后台写入沿用请求期 actor，没有重新验证停用、撤销或过期状态。
- 任务完成没有 fencing token，失去锁的旧 worker 仍可能提交。
- 仓库没有 Prisma migrations 目录，SQLite 生产升级由 `scripts/init-sqlite-schema.mjs` 兼容处理。

## 3. 范围

### 3.1 本阶段实现

1. `ConversationTurnJob` 持久化执行身份快照：`actorUserId`、`actorAuthMode`、`authSessionId`。
2. 新增一项目一行的 `ProjectExecutionLease`：holder、单调 `fencingToken`、到期时间和审计时间。
3. 提供 acquire、renew、release、assert-current 操作；Provider 长调用期间不持有数据库事务。
4. 公共认证模式下，执行前和后台写前重新验证：用户存在、未停用、session 存在、未撤销、未过期、auth mode 与 actor 一致。
5. 本地开发模式保留无公共 session 的受控执行，但不得被生产公共认证路径复用。
6. 队列执行使用唯一 worker id 和项目租约；任务领取记录 fencing token。
7. 完成或失败任务时必须匹配当前 holder、fencing token 和未过期租约；否则任务进入 `quarantined`，不能标记成功。
8. SQLite 初始化脚本兼容新库与旧库升级；Prisma client 按 schema 重新生成。

### 3.2 本阶段不宣称完成

- `IntentEpoch`、`RunInputSnapshot`、Provider idempotency/poll 恢复属于 Stage 1B。
- Artifact/Node/GenerationJob 的 staging、跨表原子提升和迟到产物隔离属于 Stage 1C。
- Stage 1A 会阻断失效身份和失租约 worker 的后续写入，并隔离任务完成提交；不会把现有所有业务写自动改造成一个跨 Provider 长事务。

## 4. 设计

### 4.1 执行身份

执行身份是入队时的授权快照，不是长期授权：

```text
actorUserId
actorAuthMode
authSessionId (公共认证必填，本地开发为空)
```

快照负责说明“谁发起”；数据库实时状态负责决定“现在还能不能写”。后台不能仅凭序列化 actor 继续执行。

### 4.2 项目租约

`ProjectExecutionLease.projectId` 唯一。首次获取产生 token 1；租约过期后被新 holder 接管时 token 单调递增；同 holder 续租不改变 token。释放只允许当前 holder + token 成功，旧 holder 的释放不能删除新租约。

### 4.3 写入守卫

后台执行作用域携带：

```text
projectId + holderId + fencingToken + executionIdentity
```

后台 service 的 write/generate 操作先做实时身份校验和 `assert-current`。任一条件失败即 fail-closed。普通同步请求仍使用现有请求授权，不伪装成后台 lease 写入。

### 4.4 隔离语义

失租约 worker 的任务完成提交改为 `quarantined`，保留错误码和审计原因。Stage 1C 再把业务产物先写 staging，确保失 fence 时 Artifact/Node/Job 也整体不可见。

## 5. 改动边界

预计涉及：

- `prisma/schema.prisma`
- `scripts/init-sqlite-schema.mjs`
- 新的 execution identity / project lease 模块
- `src/server/auth/workbench-route.ts`
- `src/server/workbench/types.ts`
- `src/server/workbench/repository.ts`
- `src/server/workbench/service.ts`
- `src/server/conversation/conversation-turn-queue.ts`
- 消息路由和 Stage 1A 定向测试

不改前端、不改 PPT/视频业务节点、不改 Provider adapter、不提交、不推送、不部署。

## 6. 风险与回退

| 风险 | 控制 |
|---|---|
| SQLite 两个 client 竞争行为与单进程 Promise 不同 | 必须使用两个独立 Prisma client 和同一数据库文件实测 |
| 旧库已有 TurnJob 没有身份快照 | 新字段允许旧行存在；旧任务执行时 fail-closed，不猜测 actor |
| 长调用租约过期 | 预留 renew；队列在提交前再次校验；Stage 1A 测试覆盖接管 |
| 旧 worker 先写出部分业务数据 | 后续写被守卫阻断，任务提交 quarantine；完整 staging 在 Stage 1C 解决 |
| 影响现有同步请求 | execution guard 只用于后台作用域，普通请求授权路径保持不变 |

回退时按本阶段改动文件定向回退；SQLite 新表和新增 nullable 字段可保留，不需要破坏性降级。

## 7. 完成标准

- `1A-01` 至 `1A-04` 全部由新鲜测试证据证明。
- 旧库升级测试证明不丢项目、消息、产物和任务数据。
- 现有 conversation queue 测试通过。
- 完整 `npm test`、`npm run build`、`git diff --check` 通过。
- Closeout 明确列出 Stage 1A 已完成边界和 Stage 1C 残余风险。
