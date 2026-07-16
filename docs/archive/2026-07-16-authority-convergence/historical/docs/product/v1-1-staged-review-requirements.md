# 审查需求拆分记录（原V1.1草案）

日期：2026-07-13

状态：superseded；不得作为V1.1实施入口

关联需求：RQ-023、RQ-024、RQ-025、RQ-027、RQ-028、RQ-032、RQ-033

> 2026-07-13需求重新分期：每阶段独立QA和前端展示拆分为RQ-034，进入`docs\product\v1-2-stage-qa-requirements.md`；持续多轮、高强度、可计费审校保留为RQ-033，延期到V2.0之后，入口为`docs\product\v2-plus-continuous-review-requirements.md`。下文只保留最初合并方案的历史推导，不得触发V1.1开发。

## 1. 决策

接受“生产前有目标与计划、阶段内持续审查和定点返修、最终包完成后再做跨产物总审查”的模式，并把额外多轮独立审查设计为可选的深度审校。

不采用在教师输入框中自动填写并发送“请全面审查”的实现。该行为会伪装教师意图、污染对话事实和绕过授权。ShanHaiEdu必须由服务端质量策略创建可审计的ReviewPlan，由Main Agent调度独立Critic并根据结构化结果Replan。

## 2. 第一性原理

公开课交付质量由三类问题决定：

1. 阶段内部问题：例如PPT第6页排版、视频某镜头字幕、教案某活动不可执行。
2. 上游传播问题：例如课程目标或叙事大纲错误，导致后续PPT、视频和最终包一起偏离。
3. 跨产物问题：单看教案、PPT和视频都可以，但三者版本、节奏或答案揭示不一致。

因此审查必须分层：阶段审查尽早截断缺陷，最终审查只承担跨产物和交付级问题。只做最终审查会返工过晚；每步无限审查会造成成本失控。

## 3. 当前基础与缺口

| 能力 | 当前状态 | V1.1补充 |
|---|---|---|
| Main Agent受控ReAct | 已有，Agent Tool后可Observe/Replan | 增加ReviewPlan与多轮审查策略 |
| PPT Critic | 已有样张/整套审查和页级返修 | 统一进入阶段ReviewRound |
| 视频 Critic | 已有课程锚点/成片审查和镜头定位 | 统一进入阶段ReviewRound |
| 硬门Validator | 已有ValidationReport与确定性QualityDecision | 每个阶段固定执行，不因套餐关闭 |
| 版本与影响 | 已有ArtifactVersion、PPT影响分析和下游stale传播 | 扩展到教案、视频、最终包的最小依赖切片 |
| 教案/Brief独立Critic | 未形成统一能力 | 新增语义Rubric和独立Executor |
| 最终包跨产物Critic | 未形成统一能力 | 新增ClassroomRunSpec/manifest一致性审查 |
| 多轮审查预算 | 只有通用步骤/费用/重试预算 | 新增ReviewPolicySnapshot和轮次/调用/积分上限 |
| 教师可见审查过程 | 当前仅有消息与计划卡 | 新增长任务活动流和审查待办投影 |

## 4. 角色与权限

| 角色 | 职责 | 禁止事项 |
|---|---|---|
| Main Agent | 建立计划、调用Critic、影响分析、生成RepairPlan、调度Tool、Replan | 不能用自己的自评替代独立Critic |
| Domain Director | 形成PPT/视频/教案专业生产方案 | 不能批准自己的产物 |
| Deterministic Validator | 检查文件、页数、hash、血缘、版本、证据和合同 | 不评价审美与教学效果 |
| Independent Critic | 按Rubric审查语义与效果，返回findings | 不能执行写Tool、批准产物或更改计划 |
| Quality Policy | 将Validator和Critic结果确定性落成pass/repair/block | 不能根据模型语气放宽硬门 |
| HumanGate | 批准真实生成、范围扩张、上游意图变化和额外预算 | 不能由模型代替教师确认 |

独立Critic采用当前`delivery_critic.review` Agent Tool边界，必须使用独立Executor、独立上下文和绑定当前目标digest的Report；不是Main Agent在同一回答中的自我反思文本。

## 5. 审查生命周期

```text
ProductionPlan + ReviewPlan
        ↓
Produce stage candidate
        ↓
Deterministic ValidationReport
        ↓
Independent CriticReport
        ↓
Deterministic QualityDecision
        ↓
pass ───────────────→ next stage
repair → ImpactAnalysis → RepairPlan → targeted Tool → revalidate/re-review
block  → pause / ask teacher / revise upstream
        ↓
Final cross-artifact review
        ↓
final_eligible package or blocked handoff
```

每轮审查必须生成唯一roundId，并绑定projectId、IntentEpoch、planId、revision、stage、target artifact/version/digest、rubric、policy snapshot和证据引用。

## 6. 阶段审查点

| 阶段 | 必查内容 | 问题后的最小动作 |
|---|---|---|
| Brief/课程目标 | 教材边界、教师意图、受众、交付范围 | 修订Brief并分析全部下游影响 |
| 教案/课堂结构 | 目标、学情、活动、评价、课堂可执行性 | 返修目标section或上游Brief |
| PPT叙事与PageSpec | 每页作用、教学动作、视觉逻辑、信息负荷 | 返修指定page spec |
| PPT关键样张 | D/V/P、图片来源、风格、可读性 | 返修指定样张或视觉系统 |
| PPT完整成品 | 真实页数、可编辑性、页级质量、节奏一致性 | 只返修定位页面/素材 |
| 视频创意与课程锚点 | 独立创意、唯一回接、不泄露答案 | 返修创意/锚点，未通过不生产 |
| 视频分镜与成片 | 镜头意图、连续性、音字、时间线、锚点漂移 | 只返修shot/track/time range |
| 最终包 | 教案/PPT/视频版本一致、ClassroomRunSpec、manifest、下载真实性 | 重建受影响切片并重新组包 |

Blocker和Major问题必须在进入高成本下游前关闭。Minor问题是否自动返修由ReviewPolicy决定，但不得让硬门失败的产物进入final_eligible。

## 7. 返修与依赖失效

Critic finding固定包含：

```text
findingId
severity
locator
evidenceRefs
responsibleStage
minimalFix
invalidatesDownstream
```

Main Agent收到finding后先执行影响分析：

1. locator只影响单页、单镜头、单段落或单轨道时，生成`repair_unit`计划。
2. finding指向Brief、大纲、视觉系统或课程锚点时，生成`repair_upstream`计划。
3. 使用Artifact lineage、version、digest和inputHash标记真正依赖该上游的产物为stale。
4. 保留未受影响且血缘仍合法的产物，不从头重跑。
5. 修复后只复验该finding和受影响的跨产物合同；最终包从最新final_eligible版本重新组装。

如果影响分析无法证明最小范围，必须暂停并请求教师选择，不得默认全量重做或静默扩大积分消耗。

## 8. 标准审校与深度审校

| 项目 | 标准审校（默认） | 深度审校（可选） |
|---|---|---|
| 硬门Validator | 每阶段执行 | 每阶段执行 |
| 独立Critic | 关键语义/高成本里程碑 | 每个主要产物里程碑 |
| 审查视角 | 当前领域Rubric | 当前领域 + 高风险第二视角 |
| 返修轮次 | 有界的一轮定点返修 | 有界的多轮定点返修与复验 |
| 最终审查 | 一次跨产物总审查 | 跨产物审查 + 未关闭finding复核 |
| 教师交互 | 仅范围变化/高成本动作确认 | 开始前确认额外消耗，预算扩张再次确认 |
| 积分 | 基础消耗 | 更高；按真实计划和预算显示 |

标准审校不是“无审查”，深度审校也不是无限循环。具体轮次不得硬编码在Prompt中，由服务端ReviewPolicySnapshot冻结并进入任务快照。

审校深度与RQ-027生成强度相互独立：

- 生成强度决定单次模型调用的能力和成本。
- 审校深度决定审查点、独立视角、返修轮次和证据量。
- 选择深度审校不自动切换模型档位；需要提高生成强度时仍走RQ-027独立确认。

## 9. 预算与暂停

`ReviewPolicySnapshot`至少包含：

```text
mode: standard | deep
maxReviewRoundsPerStage
maxRepairRoundsPerFinding
maxAdditionalProviderCalls
pointBudget
deadline
autoRepairScope
rubricVersions
```

- 标准模式使用产品默认预算，不需要额外确认，但真实Provider调用仍遵守既有HumanGate。
- 深度模式开始前说明会增加独立审查、返修轮次、耗时和积分；教师确认后生成绑定当前IntentEpoch的actionId。
- 当前没有可靠积分计量时，只显示“预计较高/消耗更快”和调用上限，不虚构具体积分。
- 达到任何轮次、Provider调用、积分或时间上限时立即暂停，展示已关闭/未关闭finding并请求教师选择继续、降低范围或结束。
- 上游范围变化、重新选择创意、修改已批准大纲或视觉系统始终触发新的HumanGate，不被深度模式预授权覆盖。

## 10. 审查计划与活动流

审查开始时，教师看到的是系统生成的审查计划，不是输入框里的伪用户消息：

```text
开始最终审校
○ 复核课程目标与教材边界
○ 检查PPT页级质量与可编辑性
○ 检查视频独立创意与课程锚点
○ 核对教案、PPT和视频版本一致性
○ 验证最终包结构和下载文件
```

执行过程中活动流依次展示：

```text
正在检查PPT页面结构
已确认12页完整；发现第6页文字偏多
正在分析影响范围：只影响第6页
已生成第6页返修版本
正在复验第6页和整套节奏
第6页问题已关闭
```

活动事件只展示业务行动、观察和证据摘要。原始Prompt、思维链、命令、路径、Provider和调试日志不进入教师界面。

## 11. 最终审查边界

最终审查不是把每个阶段从头再做一次，而是检查阶段审查无法独立发现的内容：

- 教案、PPT、视频和最终包是否引用同一课程目标与版本。
- 视频结束点、PPT承接页、教师第一问和答案揭示是否一致。
- 已批准资产是否真正进入最终PPT/MP4/ZIP。
- 所有Major/Blocker finding是否关闭，Minor是否有明确处置。
- manifest、hash、slideCount、时长、字幕、音轨和真实文件是否一致。
- 最终包是否达到可授课、可下载、可恢复和可反馈状态。

最终审查发现上游问题时，仍按第7节影响分析处理，不允许直接覆盖旧版本或把整包状态改成成功。

## 12. 验收标准

1. 系统不在教师输入框自动发送审查提示词；ReviewPlan由服务端策略创建并可审计。
2. 每个高风险阶段都有确定性Validator；标准模式不能关闭基础质量门。
3. Critic使用独立Executor，只返回结构化Report，不直接执行写Tool或批准产物。
4. Main Agent依据QualityDecision和ImpactAnalysis生成定点RepairPlan；修一页/一镜头不重跑整包。
5. 上游修改只使真实依赖产物stale，未受影响的合格版本继续复用。
6. 最终审查只承担跨产物一致性和交付资格，不无差别重复阶段审查。
7. 深度审校开始前披露额外耗时/积分并取得教师确认；模型强度不静默升级。
8. ReviewPolicySnapshot、ReviewRound、finding、RepairPlan、复验证据和费用事件可恢复、可审计、双用户隔离。
9. 预算耗尽、范围扩张或上游意图变化时暂停并触发HumanGate，不无限审查/返修。
10. 教师活动流能持续看到审查计划、当前检查、finding、定点修复、复验和最终结果，但看不到思维链和工程日志。
