# ShanHaiEdu V1 Stage 1B 输入代际、幂等与 Provider 恢复收尾

日期：2026-07-12

状态：完成

关联需求：`RQ-022` 的 Stage 1B 切片

## 1. 阶段结论

Stage 1B 已把 GenerationJob 从一次性状态记录提升为可去重、可识别输入代际、可恢复异步 Provider task 的执行对象：

- Project 具有单调 `intentEpoch`；教师通过真实再生成入口修改上游产物时，在同一事务内递增。
- Provider 输入进入不可变 `RunInputSnapshot`，对象 key 稳定排序并生成 SHA-256 `inputHash`。
- `projectId + idempotencyKey` 唯一；同 key 同 hash 复用，同 key 异 hash 明确冲突。
- 两个独立 Prisma client 并发创建相同 Job 时收敛到同一行；SQLite timeout/locked 只在确认竞争场景下等待赢家提交后读取。
- GenerationJob 保存 intentEpoch、snapshot、inputHash、providerTaskId、pollState 和接受/轮询时间。
- 视频 submit/poll 已拆成可恢复 lifecycle；已有 taskId 时 submit 调用次数为 0。
- Provider 接受后 taskId 落库失败会进入 `submission_unknown`，retry policy 为 `do_not_retry_automatically`。
- 相同已完成视频请求直接复用原 Artifact，第二次 ToolRouter 调用次数为 0。
- 旧 epoch 结果不能把 Job 标记为 succeeded，而是进入 `quarantined/stale_intent`。
- inputHash、taskId、pollState 等恢复字段不进入公开 GenerationJob/API JSON。

## 2. 主要实现

| 区域 | 实现 |
|---|---|
| 数据模型 | `Project.intentEpoch`、`RunInputSnapshot`、GenerationJob 幂等与恢复字段 |
| 输入规范化 | 递归排序对象 key、保留数组语义顺序、拒绝非有限数字、SHA-256 hash |
| create-or-reuse | 稳定 server-owned key、同 hash 复用、异 hash 冲突、独立 client 并发收敛 |
| Job 状态机 | not_started、submitting、polling、completed、submission_unknown、stale_intent |
| 视频恢复 | taskId 先落库再 poll；已有 taskId 只 poll；落库未知不 poll、不自动重提 |
| 真实入口 | 对话 ToolRouter、PPTX、图片、视频 route 均创建带 snapshot 的 Job并复用已完成结果 |
| 意图代际 | `regenerateArtifact` 成功创建新版本后原子递增 epoch；冲突/失败不递增 |
| 信息边界 | 恢复字段只留在服务端内部执行返回值，不回给教师端 |

## 3. 验收矩阵

| 编号 | 结果 | 证据 |
|---|---|---|
| 1B-01 | 通过 | 同 key/hash 返回同一 Job/Snapshot；重复视频 route 的 ToolRouter 总调用仍为 1 |
| 1B-02 | 通过 | 同 key 异 hash 抛 `generation_job_idempotency_conflict`，数据库仍一行 |
| 1B-03 | 通过 | 传入已持久化 taskId 后 submit=0、poll=1 |
| 1B-04 | 通过 | taskId 保存失败后 poll=0；分类为 submission_unknown + do_not_retry_automatically |
| 1B-05 | 通过 | 上游 regenerate 使 epoch 0→1；epoch 0 Job 完成进入 quarantined |
| 1B-06/07 | 通过 | 对象 key 顺序不改变 hash；数组顺序变化会改变 hash |
| 1B-08 | 通过 | 两个独立 client 并发创建收敛到同一 Job id |
| 1B-09 | 通过 | 旧 GenerationJob 保留，新列、Snapshot 表和唯一索引补齐 |
| 1B-10 | 通过 | 已完成相同视频请求复用 Artifact，不再次调用 ToolRouter/Provider |
| 1B-11 | 通过 | PPTX/图片/视频入口共享同一 create-or-reuse 与 epoch 门禁 |

新鲜验证：

```text
npm test
Node 259/259 passed
Vitest 505/505 passed

npm run build
Next.js production build exit 0

git diff --check
exit 0
```

## 4. 审查修正

1. 两个 client 并发 upsert 在 SQLite 下可能返回 P1008 timeout，而不是 P2002；只对 timeout/locked 做有界等待并读取赢家结果。
2. 新恢复字段最初被公共 Job mapper 返回，即使 taskId 为 null 也泄露工程字段名；已拆出 server-only execution result。
3. `submission_unknown` 最初继承 `wait_for_provider`；已改为 `do_not_retry_automatically`。
4. route 对 unknown Job 最初会先抛通用异常；已改为返回不可执行状态并给出明确暂停提示。
5. IntentEpoch 最初只有显式方法，没有接真实用户修改；已接入 `regenerateArtifact` 原子事务。

## 5. 未关闭边界

- Artifact 目前仍先保存、再完成 Job；旧 epoch Job 会 quarantine，但已写 Artifact 的整体不可见性要由 Stage 1C staging/fenced commit 解决。
- `submission_unknown` 已保存对账状态并停止自动重试，但本阶段没有新增管理员对账 UI；发布运维界面与审计入口后续补充。
- 自然语言是否构成“修改意图”的完整影响分析由 Stage 2 处理；Stage 1B 只接入确定性的 Artifact regenerate 修改入口。
- 本阶段没有调用真实外部视频 API 制造付费中断；submit/poll 次数由注入式恢复测试证明，真实 Provider 能力沿用 Stage 0R 探测证据。
- 未提交、未 push、未部署，`v1` 标签未移动。

## 6. 下一阶段

```text
Stage 1C：staging、fenced commit、quarantine 与跨表原子提升
```

Stage 1C 必须让 Artifact、WorkflowNode、GenerationJob 的当前可见性一起提交，不能继续用“Job 已 quarantine”推断迟到 Artifact 不可见。
