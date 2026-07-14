# ADR：R5 PPT设计候选与生产设计包分层

日期：2026-07-14
状态：accepted

## 背景

R5验收Main Agent自主控制面，不验收真实可编辑PPTX、完整图片、样张生产或整包production gate。真实桌面证明现有`ppt-design-candidate.v1`虽然名为compact candidate，仍要求完整视觉系统、逐页可编辑图文/数学层、布局约束、无障碍字段、样张风险覆盖和生产检查清单，实际责任接近V1-9生产`PptDesignPackage`。真实模型两次生成均在该合同边界失败，Main Agent已读取Observation并尝试Director路径，但无法形成R5要求的最低可信候选。

## 决策

### 1. R5候选只保存语义骨架

`ppt-design-candidate.v1`在R5只要求：

- TaskBrief digest与完整目标摘要；
- 年级、学科、课题、受众、使用场景和目标页数；
- 至少一条绑定可信上游Artifact digest的EvidenceBinding；
- 教学目标与Evidence引用；
- 开场张力、学习推进和收束；
- 与目标页数一致、页码连续的逐页候选，每页只保留目标引用、叙事职责、教师动作、结论式标题和主视觉意图；
- 显式声明下游用途为`production_design_expansion`。

候选仍由真实模型生成，服务端只计算digest、验证任务/证据绑定和最低结构，不生成缺失的创意语义。

### 2. 生产字段后移到V1-9

以下字段不再属于R5模型输出合同：完整`visualSystem`、逐页学生动作、可编辑文字/数学层、布局族与坐标、无障碍字段、讲者备注、风险等级、acceptance checks、`samplePlan`和`requiredProductionChecks`。

R5不得把紧凑候选确定性扩写成完整`PptDesignPackage`，也不得把默认坐标、样张页或风险覆盖冒充模型完成。V1-9唯一真实全链路必须通过显式的production design expansion责任层生成并验证完整PageSpec、样张计划和Provider production gate。

### 3. 下游可用含义

R5的“可供下游使用”表示候选具有稳定schema、TaskBrief/Artifact血缘、连续逐页语义和明确的下一责任层，可以作为production design expansion的可信输入。它不表示已可直接调用图片、PPTX或样张Provider。

缺少完整`PptDesignPackage`时，现有真实媒体Tool继续fail closed；不得现场补默认生产字段。

## 模块边界

- `ppt-design-candidate.ts`：候选类型、digest与最低结构验证，不投影生产包。
- `openai-runtime.ts`：只向文本Runtime暴露紧凑候选合同。
- `capability-runner.ts`：验证真实模型来源、TaskBrief和Evidence绑定后保存候选。
- `ppt-design-validator.ts`与真实媒体Adapter：继续只验证V1-9完整生产设计包，不因R5放松。

## 验证

1. 最小候选通过，页码缺失、TaskBrief错绑、Evidence错绑继续失败。
2. Runtime请求不包含`visualSystem`、可编辑层、`samplePlan`或production checks。
3. candidate-only真实模型结果可保存为`ppt_design_draft`，但不包含`pptDesignPackage`。
4. 真实媒体、PPTX、图片和整包调用仍为0。
5. 不把离线合同写成R5整体通过；真实桌面仍需证据。V1发布前不新增390px真实黑盒，既有窄屏合同与历史证据继续保留。

## 回退

回退只恢复R5候选运输合同；不删除已持久化Artifact、Observation或Checkpoint。不得用回退恢复确定性生产包投影或放松V1-9 production gate。
