# ADR：R5 PPT设计候选与生产设计包分层

日期：2026-07-14
状态：accepted

## 背景

R5验收Main Agent自主控制面，不验收真实可编辑PPTX、完整图片、样张生产或整包production gate。真实桌面证明现有`ppt-design-candidate.v1`虽然名为compact candidate，仍要求完整视觉系统、逐页可编辑图文/数学层、布局约束、无障碍字段、样张风险覆盖和生产检查清单，实际责任接近V1-9生产`PptDesignPackage`。真实模型两次生成均在该合同边界失败，Main Agent已读取Observation并尝试Director路径，但无法形成R5要求的最低可信候选。

## 决策

### 1. R5候选只保存语义骨架

R5新增两个版本化边界：模型输出`ppt-design-semantic-candidate.v1`，服务端投影并持久化`ppt-design-candidate.v2`。既有`ppt-design-candidate.v1`只作历史读取兼容，不改变其字段或digest语义。模型只要求：

- 完整目标摘要；
- 年级、学科、课题、受众、使用场景和目标页数；
- 至少一条可定位到上游语义的Evidence声明，包含稳定的`evidenceId`、页码/段落引用和事实主张；
- 教学目标与Evidence引用；
- 开场张力、学习推进和收束；
- 与目标页数一致、页码连续的逐页候选，每页只保留目标引用、叙事职责、教师动作、结论式标题和主视觉意图；
- 显式声明下游用途为`production_design_expansion`。

模型不得承担或伪造`TaskBrief.digest`、`sourceArtifactId`、Artifact `version/digest`或`candidateDigest`。模型即使因旧Prompt回传这些字段，服务端也必须视为不可信运输字段并丢弃。

服务端只在以下权威事实同时成立后投影持久化候选：

- `ExecutionEnvelope`已通过ToolGateway校验，且其actor、project、task、IntentEpoch、plan revision、强度、授权、幂等键和`taskBriefDigest`均属于当前执行；
- `taskInput.taskBrief`自身digest有效，并与`ExecutionEnvelope`的project、task、IntentEpoch和digest一致；
- 当前可信输入中存在具备正式Artifact ID、version和digest的`ppt_draft`。

服务端使用上述TaskBrief digest和可信`ppt_draft`投影全部权威绑定，包括Artifact ID、version和digest，并计算`candidateDigest`；它可以覆盖模型回传的错误ID/version/digest，但不得生成缺失的目标、叙事、教学动作、Evidence主张或逐页视觉语义。

### 2. 生产字段后移到V1-9

以下字段不再属于R5模型输出合同：完整`visualSystem`、逐页学生动作、可编辑文字/数学层、布局族与坐标、无障碍字段、讲者备注、风险等级、acceptance checks、`samplePlan`和`requiredProductionChecks`。

R5不得把紧凑候选确定性扩写成完整`PptDesignPackage`，也不得把默认坐标、样张页或风险覆盖冒充模型完成。V1-9唯一真实全链路必须通过显式的production design expansion责任层生成并验证完整PageSpec、样张计划和Provider production gate。

### 3. 下游可用含义

R5的“可供下游使用”表示候选具有稳定schema、TaskBrief/Artifact血缘、连续逐页语义和明确的下一责任层，可以作为production design expansion的可信输入。它不表示已可直接调用图片、PPTX或样张Provider。

缺少完整`PptDesignPackage`时，现有真实媒体Tool继续fail closed；不得现场补默认生产字段。

### 4. 失败分类与可恢复性

候选进入服务端边界后必须区分：

- `ppt_design_candidate_missing`：模型结果没有候选；
- `ppt_design_candidate_semantics_invalid`：目标、Evidence声明、叙事或逐页结构不完整，或与当前结构化任务语义冲突；
- `ppt_design_task_binding_missing`：有效TaskBrief或ExecutionEnvelope权威绑定缺失/不一致；
- `ppt_design_evidence_binding_missing`：没有当前可信`ppt_draft`可供服务端绑定。

reasonCode必须进入Tool失败结果、`ValidationReport`和Observation，使同一个Main Agent可以修输入、换合法路径或Replan。上述失败都不是默认HumanGate理由；重试预算耗尽后保存checkpoint并诚实暂停。

## 模块边界

- `ppt-design-candidate.ts`：分别验证`ppt-design-semantic-candidate.v1`、历史`ppt-design-candidate.v1`和服务端`ppt-design-candidate.v2`，统一投影权威绑定并计算候选digest，不投影生产包。
- `openai-runtime.ts`：只向文本Runtime暴露紧凑语义候选合同，并剥离模型回传的服务端权威字段。
- `capability-runner.ts`：使用已验证ExecutionEnvelope、TaskBrief和可信`ppt_draft`投影权威绑定后保存候选。
- `ppt-design-validator.ts`与真实媒体Adapter：继续只验证V1-9完整生产设计包，不因R5放松。
- `contract-validator.ts`：candidate-only结果验证最低候选合同；结果若携带生产`PptDesignPackage`则继续执行完整生产设计包验证。真实媒体Adapter仍只接受完整生产包。
- 可选Director路径不得维护第二套模型权威绑定规则。Director只输出Evidence语义和服务端可解析的Artifact kind，Adapter使用Invocation Envelope中的ID/version/digest投影；缺少唯一可信来源时失败关闭。

## 验证

1. 最小语义候选通过；页码缺失、Evidence主张缺失和任务语义冲突继续失败。
2. 模型回传错误TaskBrief digest、Artifact ID/version/digest时，服务端使用当前ExecutionEnvelope、有效TaskBrief和可信`ppt_draft`覆盖权威绑定；缺少任一权威源则失败关闭。
3. Runtime候选合同不要求模型输出`taskBriefDigest`、`sourceArtifactId`、Artifact digest或`candidateDigest`，也不包含`visualSystem`、可编辑层、`samplePlan`或production checks。
4. candidate-only真实模型结果可保存为`ppt_design_draft`，但不包含`pptDesignPackage`；对应ValidationReport验证候选而不是错误要求生产包。
5. 四类失败reasonCode进入ValidationReport和Observation。
6. 真实媒体、PPTX、图片和整包调用仍为0。
7. 不把离线合同写成R5整体通过；真实桌面仍需证据。V1发布前不新增390px真实黑盒，既有窄屏合同与历史证据继续保留。

## 回退

回退只恢复R5候选运输合同；不删除已持久化Artifact、Observation或Checkpoint。不得用回退恢复确定性生产包投影或放松V1-9 production gate。
