# ShanHaiEdu V1 Stage 1B 输入代际、幂等与 Provider 恢复计划

日期：2026-07-12

状态：已完成

关联需求：`RQ-022`

## 1. 目标

Stage 1B 要保证同一生成意图不会因重复点击、进程退出或重试而重复付费提交，也不能让旧输入结果覆盖教师的新意图：

```text
当前 IntentEpoch
+ 不可变 RunInputSnapshot
-> canonical inputHash
-> server-owned idempotencyKey
-> create-or-reuse GenerationJob
-> submit accepted 后先保存 providerTaskId
-> 只 poll/download
-> epoch/fence 校验后交给 Stage 1C 提升
```

## 2. 当前事实

- `GenerationJob` 只有 kind、sourceArtifactId、status、attempts 和 resultArtifactId。
- 对话工具、PPTX 路由、图片路由、视频路由每次请求都会新建 Job。
- Job 没有 inputHash、idempotencyKey、IntentEpoch、输入快照或 providerTaskId。
- 视频生成在一个函数内完成 submit + poll；taskId 只存在于进程内变量。
- 进程在 submit 后退出会丢失 taskId，重试可能再次付费提交。
- 当前上游修改没有项目级意图代际，旧结果与新意图无法做确定性比较。

## 3. 数据合同

### 3.1 Project IntentEpoch

`Project.intentEpoch` 是教师当前意图的单调代际。只有会改变交付语义或上游事实的教师动作才递增；继续、查看、下载和纯确认不递增。

Stage 1B 提供显式 compare-and-increment 操作。自然语言意图分类与影响分析在 Stage 2 接入；本阶段不把每条消息机械视为新 epoch。

### 3.2 RunInputSnapshot

每个 Provider Job 绑定不可变输入快照：

- projectId、intentEpoch、capability/kind；
- source artifact id、version、kind、hash；
- 已批准上游 artifact ids、versions、hashes；
- 教师指令和影响 Provider 请求的结构化参数；
- canonical JSON 与 SHA-256 inputHash。

快照只保存业务输入，不保存 token、签名 URL、密钥或 Provider 私有认证信息。

### 3.3 GenerationJob

新增：

- `intentEpoch`
- `runInputSnapshotId`
- `idempotencyKey`
- `inputHash`
- `providerTaskId`
- `pollState`
- `providerAcceptedAt`
- `lastPolledAt`

`projectId + idempotencyKey` 唯一。相同 key + 相同 hash 返回原 Job；相同 key + 不同 hash 返回冲突，不能静默复用。

## 4. Provider 状态机

```text
queued
-> submitting
-> polling (providerTaskId 已持久化)
-> downloading
-> succeeded / failed

submitting
-> submission_unknown (Provider 可能已接受，但 taskId 未可靠落库)
```

规则：

1. `providerTaskId` 已存在时只允许 poll/download，不再 submit。
2. `submission_unknown` 禁止自动重提，必须人工对账或显式作废后创建新意图。
3. 同步 Provider 可使用 `completed_inline`，但仍受 inputHash/idempotency/epoch 约束。
4. taskId 只作为服务端恢复字段，不回显到教师界面或普通日志。

## 5. 接入范围

### 5.1 本阶段实现

- Prisma schema 与 SQLite 旧库升级。
- canonical snapshot/hash 工具。
- GenerationJob create-or-reuse、冲突、submit/poll/unknown 状态转换。
- 项目 IntentEpoch compare-and-increment 与旧 epoch 提交拒绝。
- 视频 Provider 拆分可恢复 submit/poll：taskId 落库后才继续 poll。
- 对话 ToolRouter 和三个真实生成路由使用 server-owned job identity。
- 重复请求命中已完成 Job 时复用已校验结果，不再次调用 Provider。

### 5.2 不在本阶段

- Artifact/Node/Job staging 与跨表原子提升属于 Stage 1C。
- Main Agent 对自然语言修改的完整影响分析属于 Stage 2。
- PPT/视频逐页、逐镜头业务质量合同分别属于 Stage 3/4。

## 6. 失败语义

| 情况 | 结果 |
|---|---|
| 同 key 同 hash | 返回原 Job；根据 pollState 继续恢复 |
| 同 key 异 hash | `idempotency_conflict`，要求新意图标识 |
| 有 taskId | 只 poll/download |
| Provider 接受但 taskId 保存失败 | `submission_unknown`，停止自动重提 |
| Job epoch 小于项目当前 epoch | `stale/quarantined`，不能成为当前有效结果 |
| 输入快照无法构造 | Provider 不调用，Job 不进入 submitting |

## 7. 风险与回退

- 不能用 HumanGate actionId 直接作为 Provider 幂等键；key 由服务端执行身份、capability、epoch 和稳定 run identity 生成。
- canonical JSON 必须排序对象 key，数组顺序按业务语义保留。
- Provider 长调用不持有数据库事务；状态转换使用短事务和 Stage 1A fence。
- 旧 GenerationJob 没有快照，保留历史但不自动恢复为可重提任务。
- 回退代码时保留新增 nullable 字段和快照表，避免破坏性数据库降级。

## 8. 完成标准

- 1B-01 至 1B-05 全部有新鲜测试证据。
- 视频恢复测试证明已有 taskId 时 submit 调用次数为 0。
- submission_unknown 测试证明自动重试次数为 0。
- 现有 PPTX/图片/视频 route 与 ToolRouter 回归通过。
- 完整 `npm test`、`npm run build`、`git diff --check` 通过。
