# ShanHaiEdu V1 Stage 1B 输入代际、幂等与 Provider 恢复测试计划

日期：2026-07-12

状态：已执行并通过

## 1. 核心验收

| 编号 | 场景 | 必须证明 |
|---|---|---|
| 1B-01 | 同 idempotencyKey + 同 inputHash | 返回同一 Job/Snapshot；Provider submit 总次数仍为 1 |
| 1B-02 | 同 idempotencyKey + 不同 inputHash | 返回确定性冲突；不覆盖旧快照，不调用 Provider |
| 1B-03 | submit 后进程退出，taskId 已保存 | 新 worker 只 poll/download；submit 调用次数为 0 |
| 1B-04 | Provider 已接受但 taskId 保存未知 | Job=`submission_unknown`；自动重试不调用 submit/poll |
| 1B-05 | 教师修改上游导致 IntentEpoch 递增 | 旧 epoch Job 不能 succeeded/final_eligible，结果进入 stale/quarantine |

## 2. 补充验收

| 编号 | 场景 | 必须证明 |
|---|---|---|
| 1B-06 | canonical input 仅对象 key 顺序不同 | inputHash 相同 |
| 1B-07 | 数组顺序或有效参数变化 | inputHash 不同 |
| 1B-08 | 两个 client 并发 create-or-reuse | 最终只有一行相同 key Job，均读到同一 id |
| 1B-09 | 旧 SQLite GenerationJob 升级 | 旧行保留；新表、列、唯一索引存在 |
| 1B-10 | 已完成相同 Job 重试 | 复用 resultArtifactId，不重新调用 Provider |
| 1B-11 | 同步图片/PPT Provider | 可进入 completed_inline，但仍受 key/hash/epoch 门禁 |

## 3. Provider 调用计数

恢复测试必须分别注入 `submit`、`poll`、`download` 计数器：

- 新任务：submit=1，poll>=1，download=1。
- 已有 taskId：submit=0，poll>=1，download=1。
- submission_unknown：submit=0，poll=0，download=0。

不能只检查 Job 字段而不检查真实调用次数。

## 4. Epoch 时序

```text
epoch N 构造 snapshot/job
-> Provider 执行中
-> 教师修改上游，compare-and-increment 到 N+1
-> epoch N 结果返回
-> 提交被拒并隔离
```

Stage 1B 只证明代际栅栏；Artifact/Node 跨表原子可见性由 Stage 1C 证明。

## 5. 执行顺序

1. 先写 snapshot/hash 与 create-or-reuse 红测。
2. 实现 schema、SQLite 升级和 GenerationJob 状态机。
3. 写视频 submit/poll 恢复红测并拆分 Provider API。
4. 接入 ToolRouter、conversation 和 route-level generation。
5. 跑相关测试、完整测试、生产构建与 diff check。

## 6. 禁止的假证据

- 不能用同一个 Promise 返回值证明跨进程幂等。
- 不能用 HumanGate actionId 直接冒充 Provider 幂等键。
- 不能仅保存 taskId 后仍调用 submit。
- 不能把 `submission_unknown` 当普通 retryable_failed。
- 不能用 Job succeeded 替代真实 Artifact/file 质量门禁。
