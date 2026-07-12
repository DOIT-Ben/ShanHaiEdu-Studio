# ShanHaiEdu V1 Stage 2A 可执行合同与 ValidationReport 收尾

日期：2026-07-12

状态：完成

关联需求：`RQ-023` 的 Stage 2A 切片；`RQ-023` 整体仍为 `in_progress`

## 1. 阶段结论

Stage 2A 已把 ToolDefinition、ToolRouter、Artifact 保存和 Stage 1C promotion 串成可执行的确定性合同门：

- 17 个已注册能力均可投影 Runtime Contract；合同不包含强制 next/recommendedNext，不把 Main Agent 固化为 DAG。
- ToolDefinition 产生输入、输出、Provider 真值等最低 `must`；旧自然语言 Node Contract 在没有确定性 Validator 前仅为 `should` advisory。
- PreValidator 在执行器前检查项目内已批准输入；缺失时 executor 调用次数为 0。
- PostValidator 检查输出 kind/node、Provider Artifact Truth 与质量硬门；失败或证据不足不能保存 Artifact。
- ValidationReport 使用 canonical SHA-256；reportId、createdAt 和对象键顺序不影响语义 digest。
- 所有 ToolRouter 成功、失败、缺输入、禁用能力和未知工具结果均携带确定性报告。
- 内部 Tool 的 Artifact、WorkflowNode 和 ValidationReport 在同一事务提交。
- Provider 报告先绑定 GenerationJob/StagedArtifactCommit；promotion 时与最终 Artifact 原子绑定。
- 报告缺失、digest 被篡改、target digest、inputHash 或 intentEpoch 错配时结果 quarantined，Artifact 保持不可见。
- 相同语义报告即使 reportId/createdAt 变化也幂等复用，不重复写报告。

## 2. 主要实现

| 区域 | 实现 |
|---|---|
| 合同投影 | `runtime-contract.ts` 从 ToolDefinition 生成最低合同，published Node Contract 仅作 advisory 增强 |
| 确定性验证 | `contract-validator.ts` 提供 pre/post validator、ArtifactDraft digest 和报告 digest 验真 |
| 报告类型 | `quality-types.ts` 定义 authority、domain、target、gate、locator、inputHash、intentEpoch |
| ToolRouter | 执行前阻断缺输入，执行后验证所有结果；Provider 未通过硬门转为失败 observation |
| 内部保存 | `saveArtifact` 收到报告时先验 digest/target/status，再在同一事务写 Artifact、Node 和报告 |
| Provider staging | `stageGenerationResult` 强制报告存在且与 Job epoch/hash、目标草稿一致 |
| 原子提升 | promotion 复验报告记录并在 Artifact/Node/Job/staging 原子事务中绑定 artifactId |
| 数据模型 | 新增 `ValidationReportRecord` 及 project/artifact/job/staging 关系和查询索引 |
| SQLite 升级 | 初始化脚本加法式建表和索引；既有库可连续重复运行 |

## 3. Stage 2A 验收矩阵

| ID | 结果 | 证据 |
|---|---|---|
| 2A-01 | 通过 | 所有 implemented Tool 均投影合同，合同无固定 next 字段 |
| 2A-02 | 通过 | 缺批准输入返回 failed report，executor=0，locator 指向缺失 kind |
| 2A-03 | 通过 | 旧 prose 规则投影为 advisory，不产生确定性硬阻断 |
| 2A-04 | 通过 | output kind/node 错配产生 failed gates，成功结果转失败且不保存 |
| 2A-05 | 通过 | Provider 缺 Artifact Truth 或 passing QualityGate 时报告失败，Artifact=0 |
| 2A-06 | 通过 | reportId、createdAt、对象键顺序变化时语义 digest 稳定 |
| 2A-07 | 通过 | inputHash/intentEpoch 错配在 staging 隔离；报告保留，Artifact=0 |
| 2A-08 | 通过 | 内部 Artifact/Node/报告同事务提交；target 错配整体回滚 |

附加恢复证据：同语义报告使用新 reportId 重试时只保留一条记录；Provider promotion 故障恢复后报告与唯一 Artifact 绑定。

## 4. 新鲜验证

```text
npx vitest run tests/contract-validation.test.ts tests/tool-router.test.ts tests/generation-result-promotion.test.ts tests/generation-job-recovery.test.ts src/server/workbench/__tests__/stage30-generation-job-queue.test.ts --maxWorkers=1
5 files / 51 tests passed

npm test
Node 259/259 passed
Vitest 525/525 passed

npm run build
Next.js production build exit 0；TypeScript 通过；13 个静态页面生成完成

独立 .tmp SQLite 连续初始化
2/2 exit 0；ValidationReportRecord=1 table；7 indexes

git diff --check
exit 0
```

## 5. 未关闭边界

- Stage 2B 的 CriticReport、EffectiveRubric 和确定性 QualityDecisionEngine 尚未实现。
- Stage 2C 的统一 Observation、重复失败去重、checkpoint/pause、自然语言改道失效和 finish 证据门尚未实现。
- 本子阶段没有重新调用真实付费 PPTX、图片或视频 Provider；真实 Provider、PPT Quality、视频 Full Intro、最终包和教师签收仍是后续门禁。
- `RQ-023` 不能标记 done；只有 2A/2B/2C 全部完成并集中验收后才能关闭。
- 未提交、未 push、未部署，既有 `v1` 标签未移动。

## 6. 下一阶段

```text
Stage 2B：CriticReport、EffectiveRubric 与确定性 QualityDecisionEngine
```

Critic 只评语义与效果，不能覆盖文件真值、hash、页数、血缘、授权、Provider 实传等 Validator 硬门；决策顺序固定为 `block > repair > pass`。
