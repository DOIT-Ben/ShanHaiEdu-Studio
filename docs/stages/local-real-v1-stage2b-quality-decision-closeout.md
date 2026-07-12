# ShanHaiEdu V1 Stage 2B Critic 与确定性质量决策收尾

日期：2026-07-12

状态：完成

关联需求：`RQ-023` 的 Stage 2B 切片；`RQ-023` 整体仍为 `in_progress`

## 1. 阶段结论

Stage 2B 已建立 CriticReport、EffectiveRubric 和确定性 QualityDecision 的分权闭环：

- CriticReport authority 固定为 `advisory_semantic`，只能提交语义/感知评分、证据、严重度、定位和最小修复建议。
- Critic payload 严格拒绝 Artifact Truth、validationStatus、lineage、file hash、slideCount、Provider 实传等 validator-only 字段。
- EffectiveRubric v1 由 Registry 固定版本和 digest；Critic 不能临场改权重、阈值或评分锚点。
- 评分仅允许 `95/80/60/30/not_scorable`，每个有效分数必须有证据。
- QualityDecision authority 固定为 `deterministic_policy`，决策顺序固定为 `block > repair > pass`。
- Validation failed/inconclusive、报告/目标/rubric/inputHash 错配、Critic 缺失或证据不足、必需维度 not_scorable 均 block。
- blocker 必须 block；major 和返修阈值进入 repair；只有硬门、证据、维度和严重度全部通过才 pass。
- Critic recommendation 无法覆盖 ValidationReport；相同语义输入不受报告、维度和 finding 顺序影响。
- Fast/Preview/Short 路径即使高分也最多 `preview_only`；Quality/Full pass 最多 `final_candidate`，仍需教师批准。
- CriticReport 与 QualityDecision 在当前短租约和执行身份下同事务持久化；写 Decision 失败时 Critic 整体回滚。
- 持久化前复核最新 Artifact 版本/digest、ValidationReport 数据库绑定及三类 digest；旧版本不能写入新决定。

## 2. 主要实现

| 区域 | 实现 |
|---|---|
| 类型 | 扩展 page/asset/shot/track/timeline/frame_range locator、CriticReport、Rubric、QualityDecision |
| Rubric Registry | PPT final、Video shot、Video final 的基础维度、权重和阈值固定并带 digest |
| Critic parser | 严格字段边界、评分锚点、证据要求、locator 时间范围和 frame evidence 校验 |
| Decision Engine | 确定性聚合 Validation/Critic/Rubric，稳定计算 outcome、score、reason、nextAction、eligibility |
| 持久化 | `quality-report-repository.ts` 在项目租约、身份和当前 Artifact 复核后原子写 Critic/Decision |
| 数据模型 | 新增 `CriticReportRecord`、`QualityDecisionRecord` 及 Artifact/Project/报告关系与幂等索引 |
| SQLite | 三张质量报告表加法式初始化，连续运行不破坏既有数据 |

## 3. Stage 2B 验收矩阵

| ID | 结果 | 证据 |
|---|---|---|
| 2B-01 | 通过 | Validation failed + Critic pass 仍为 block |
| 2B-02 | 通过 | 缺证据或必需维度 not_scorable 为 block + regenerate_evidence |
| 2B-03 | 通过 | 硬门、维度、证据和严重度达标时稳定 pass |
| 2B-04 | 通过 | major finding 返回 repair 和最小 typed locator |
| 2B-05 | 通过 | blocker finding 无条件 block，Critic recommendation 无法覆盖 |
| 2B-06 | 通过 | Validation、dimension、finding 顺序变化时 decision digest 稳定 |
| 2B-07 | 通过 | Critic 写 validator-only 字段时 parser 拒绝 |
| 2B-08 | 通过 | Artifact version/digest 变化后旧报告 block，持久化拒绝旧版本 |

附加事务证据：Critic/Decision 原子回滚、同语义新 ID 幂等复用、无当前 fence/身份不能写质量决定。

## 4. 新鲜验证

```text
npx vitest run tests/quality-decision-engine.test.ts tests/quality-report-persistence.test.ts --maxWorkers=1
2 files / 12 tests passed

npm test
Node 259/259 passed
Vitest 537/537 passed

npm run build
Next.js production build exit 0；TypeScript 通过；13 个静态页面生成完成

独立 .tmp SQLite 连续初始化
2/2 exit 0
ValidationReportRecord: 1 table / 7 indexes
CriticReportRecord: 1 table / 3 indexes
QualityDecisionRecord: 1 table / 4 indexes

git diff --check
exit 0
```

## 5. 未关闭边界

- Stage 2C 的统一 Observation、重复失败去重、checkpoint/pause、自然语言改道失效和 finish 证据门尚未实现。
- 本阶段建立了 Critic 的严格运输 Schema、解析器、Rubric 和持久化边界，但尚未把真实 Delivery Critic 模型接入 PPT render 或视频 frame/audio 证据；该接入随 RQ-024/RQ-025 的真实工艺节点完成。
- 本阶段没有调用真实付费 PPTX、图片或视频 Provider，也没有宣称任何现有 PPT/视频达到课堂交付质量。
- `pass` 仅为 `final_candidate`，不等于教师批准或 `final_eligible`。
- `RQ-023` 不能标记 done；Stage 2C 完成并集中验收后才能关闭。
- 未提交、未 push、未部署，既有 `v1` 标签未移动。

## 6. 下一阶段

```text
Stage 2C：统一 Observation、Replan、暂停、改道与 finish 证据门
```

所有合同失败、质量返修、证据不足和成功结果都必须回流 Main Agent；同 action/inputHash/reason 重复失败不得无限原样重试，finish 必须引用当前 Artifact、ValidationReport 和 QualityDecision。
