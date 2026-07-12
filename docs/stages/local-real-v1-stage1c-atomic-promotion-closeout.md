# ShanHaiEdu V1 Stage 1C 生成结果原子提升与隔离收尾

日期：2026-07-12

状态：完成

关联需求：`RQ-022` 的 Stage 1C 切片

## 1. 阶段结论

Stage 1C 已关闭真实 Provider 文件生成后 `Artifact`、`WorkflowNode` 与 `GenerationJob` 分两次提交的半成功窗口：

- 每个新 GenerationJob 在创建事务内建立唯一 `StagedArtifactCommit` 槽位。
- Provider 长调用保持在数据库事务外；结果先持久化到 staging，再进入短事务原子提升。
- Artifact 创建、WorkflowNode 状态更新、GenerationJob succeeded/resultArtifactId 和 staging committed 在同一事务完成。
- 事务中任一步失败会整体回滚；staging 与 storage refs 保留，Artifact 不可见。
- 旧 intent epoch、inputHash 不一致、失效身份或旧 fence 的结果只进入 quarantine，不创建 Artifact。
- 当前 fence 可恢复同一 actor/auth/session 的 staging；不同身份不能继承旧结果。
- PPTX、图片、视频三个直接入口统一持有 ProjectExecutionLease 和心跳；对话 Provider 路径复用队列既有 guarded service。
- 已删除可绕过原子提升的 `finishGenerationJob(resultArtifactId)` service/repository 入口。

## 2. 主要实现

| 区域 | 实现 |
|---|---|
| 数据模型 | `StagedArtifactCommit`、Job 唯一 staging、state、draft、storage refs、epoch/hash、fence、执行身份、result Artifact |
| staging | Job 创建时预建 `awaiting_result`；Provider 成功后更新为 `staged` |
| 原子提升 | 单事务创建 Artifact、更新 Node/Job/staging；重复调用返回同一 Artifact |
| 隔离 | stale intent、input hash mismatch、旧 fence 或身份失效时 Job/staging 同步 quarantined |
| 恢复 | committed 直接复用；staged 可由同一有效执行身份的新 fence 接管，不重复 Provider |
| 文件对账 | 递归提取安全 `localOutput` 到去重 `storageRefsJson`；危险路径不记录 |
| 直接路由 | Coze PPTX、图片、视频统一 `runWithProjectExecutionLease` |
| 对话工具 | Provider 工具结果统一 `commitGenerationResult`，非 Provider 内部工具仍走普通 `saveArtifact` |
| 旧库升级 | `init-sqlite-schema.mjs` 加法式建表、补身份列、建唯一索引，可重复执行 |

## 3. 验收矩阵

| 编号 | 结果 | 证据 |
|---|---|---|
| 1C-01 | 通过 | 强制数据库提交失败后 slot 保持 staged、storage refs 可读、Artifact=0、Node 未推进、Job 未成功 |
| 1C-02 | 通过 | SQLite trigger 在 Job succeeded 更新处强制失败，Artifact 创建整体回滚；移除故障后重试只生成一个 Artifact/一个版本 |
| 1C-03 | 通过 | PPTX、图片、视频路由和对话 Provider 路径均使用统一 commit；三路由均持有项目租约 |
| 1C-04 | 通过 | Provider 期间 intent epoch 变化后 Job/staging quarantined，Artifact=0 |
| 1C-05 | 通过 | 旧 fence promote 被拒；同一有效执行身份的新 fence 可恢复，slot 更新到新 token |
| 1C-06/07 | 通过 | 重复 promote 返回同一 Artifact；已成功请求继续复用 result Artifact |
| 1C-08 | 通过 | 旧数据库数据保留；新表、身份列、唯一索引存在；初始化连续两次成功 |
| 1C-09/10 | 通过 | awaiting_result 不提升；storage refs 去重且过滤路径逃逸 |

## 4. 新鲜验证

```text
npx vitest run tests/generation-result-promotion.test.ts --maxWorkers=1
1 file / 6 tests passed

受影响回归
11 files / 107 tests passed

npm test
Node 259/259 passed
Vitest 511/511 passed

npm run build
Next.js production build exit 0

node scripts/init-sqlite-schema.mjs（同一 dev.db 连续两次）
2/2 exit 0

git diff --check
exit 0
```

## 5. 审查修正

1. 初版只绑定 staging 的 holder/token，导致请求结束后同一教师的新 fence 也无法恢复；已增加 actor/auth/session 快照，并只允许完全相同且仍有效的身份接管。
2. 初版隔离事务并行发出 Job 与 staging 更新；已改为同一交互事务内顺序更新，降低 SQLite 驱动不必要的并发风险。
3. 旧 M61 静态测试仍要求 `saveArtifact`；已升级为 HumanGate 必须先于 `commitGenerationResult`，并新增项目租约断言。
4. 旧 `finishGenerationJob` 虽已无生产调用，但仍可被未来代码误用；已从 repository/service 删除，并迁移旧测试。
5. 完整测试第一次失败是共享 `dev.db` 未执行已有 Stage 1B `intentEpoch` 升级；已对测试实际数据库执行幂等初始化后复验，不把环境错位误判为业务回归。

## 6. 未关闭边界

- 本阶段验证的是提交原子性、隔离与恢复，没有再次调用真实付费 PPTX、图片或视频 Provider；真实 Provider 能力沿用 Stage 0R 探测证据。
- 自动清理 quarantined/orphaned 文件未实现；当前只保留可审计 storage refs，禁止自动删除真实资产。
- 节点 pre/post contract、ValidationReport、CriticReport、QualityDecision、预算与自然语言影响分析属于 Stage 2 / RQ-023。
- PPT 逐页质量、视频完整工作流、整堂课一致性、最终包和真实教师签收仍未关闭。
- 未提交、未 push、未部署，`v1` 标签未移动。

## 7. 下一阶段

```text
Stage 2：可执行节点合同、确定性质量决策与受控 ReAct
```

Stage 2 先实现跨 PPT/视频共用的 Contract/Validation/QualityDecision 最小闭环，再进入 PPT Quality 与视频 Full Intro，不把 Main Agent 固化为线性 DAG。
