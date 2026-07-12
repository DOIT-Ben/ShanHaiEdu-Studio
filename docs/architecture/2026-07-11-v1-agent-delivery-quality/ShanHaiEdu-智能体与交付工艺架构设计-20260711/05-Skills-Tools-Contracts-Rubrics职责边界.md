# 05 Skills、Tools、Contracts、Rubrics 职责边界

## 1. 直接回答“不是封装成 Tool 吗”

是，但不是把整本手册直接写成一个普通 Tool。

正确封装关系是：

```text
Main Agent 看到的是 Agent-as-Tool
  ├─ ppt_director.plan_or_repair
  ├─ video_director.plan_or_repair
  └─ delivery_critic.review

Director 内部按阶段加载 Skill
  ├─ edu-ppt-production
  ├─ edu-intro-video-production
  └─ education-media-invariants（共享 reference，不单独路由）

Director 产出结构化计划后，真实执行仍调用普通 Tool
  ├─ image.generate / pptx.compose / render / validate
  └─ video.generate / tts / overlay / ffprobe / transcode / ffmpeg.concat
```

所以“封装成 Tool”是主 Agent 的调用接口；“Skill”是专家 Tool 内部的方法来源。两者不是二选一。

## 2. 六类对象的唯一职责

| 对象 | 唯一职责 | 典型内容 | 不能做什么 |
|---|---|---|---|
| Skill | 可迁移的专家方法 | 怎么拆页/镜头、默认策略、提示词片段、返修经验 | 保存运行状态、宣称通过、调用外部副作用 |
| Agent-as-Tool | 对主 Agent 暴露领域推理能力 | 规划、比较方案、定位根因、提出返修动作 | 绕过 Router/Guard，直接改真实世界 |
| Contract | 稳定硬边界 | 必填输入输出、血缘、ID、禁止项、继续条件 | 塞审美长文、固定 Provider、替代质量评分 |
| Tool | 确定性或外部执行 | 生图、组装、渲染、ffprobe、FFmpeg、打包 | 自己决定教学创意和产品目标 |
| Validator | 判定确定性硬事实 | schema、页数、文件结构、ffprobe、血缘、可编辑性 | 做审美/教学主观评分 |
| Rubric/Critic | 评价语义和感知质量 | 维度、权重、证据、严重度、责任节点 | 重判 Validator、直接执行修复、替代教师决定 |
| QualityDecisionEngine | 确定性聚合报告和路径政策 | pass/repair/block、deliveryEligibility | 调模型临场改变阈值 |
| Workflow/Job | 状态与恢复 | pending/running/blocked、attempt、taskId、checkpoint、审批 | 代替 Agent 做创意判断 |
| Profile | 可覆盖策略/能力配置 | 风格、模型、比例、参考图、成本、时长 | 冒充全局质量合同 |

## 3. 最小 Skills 集

### `edu-ppt-production`

- 触发：需要设计、生成、审查或返修课堂 PPT。
- 输入上下文：当前阶段、PresentationBrief、Evidence、相关 page/asset、历史质量报告。
- 输出：NarrativeOutline、VisualSystem、PageDesignSpec、SamplePlan、AssetPlan 或 RepairPlan。
- 不输出：真实 PPTX 成功、外部任务状态、教师批准。

### `edu-intro-video-production`

- 触发：需要设计、生成、审查或返修课堂导入视频。
- 输入上下文：当前阶段、VideoIntent、Storyboard、目标 shot、参考资产、质量报告。
- 输出：CreativeBrief、BeatSheet、ShotSpec、ReferencePlan、ResolvedExecution 建议或 RepairPlan。
- 不输出：真实 clip 成功、FFmpeg 成片成功、教师批准。

### `education-media-invariants`

只作为共享 reference，由 Prompt Compiler 引入，不作为第三个可路由 Skill：

- 教材忠实和课程锚点
- 精确信息不烘进不可控生成媒体
- 真实文件、版本、血缘与可追溯
- 儿童安全、隐私、版权、品牌和课堂适配
- `validationStatus`、`selectedVersion`、`humanDecision` 的严格区分；Critic 通过不等于教师批准
- Fast/Quality、Short/Full 的 productionPath 和 deliveryEligibility 不可伪装升级

不要建立“PPT 大纲 Skill、样张 Skill、底图 Skill、镜头 Skill、字幕 Skill、审查 Skill”等十几个入口。节点细节是 Skill 的章节，不是独立能力品牌。

## 4. 推荐 Agent-as-Tool 接口

### `ppt_director.plan_or_repair`

```text
输入：goal、stage、briefRef、evidenceRefs、targetPageIds、qualityReportRef、profileId
输出：decision、artifactDraft、nextToolIntents、assumptions、overrideReasons、stopConditions
副作用：none
```

### `video_director.plan_or_repair`

```text
输入：goal、stage、videoIntentRef、targetShotIds、assetRefs、qualityReportRef、providerCapabilities
输出：decision、shot/asset/repair draft、nextToolIntents、overrideReasons、stopConditions
副作用：none
```

### `delivery_critic.review`

```text
输入：domain、stage、artifactRefs、validationReportRef、render/mediaEvidenceRefs、rubricVersion、contractVersion
输出：criticRecommendation、scores、semanticFindings[]、typedLocators、responsibleStage、minimalFix
副作用：不修改被审产物、不调 Provider；Harness 可持久化其 CriticReport；不能重判硬门或批准教师决策
```

`DeliveryCritic` 不必先做第三个 Skill。它是一个独立 Agent，按 `domain + stage + rubricVersion` 加载相应量表，并使用与生成 Agent 隔离的上下文。最终 `QualityDecision` 由确定性 Engine 聚合 ValidationReport 与 CriticReport，不能由 Critic 自己宣布。

## 5. Prompt Compiler 如何避免重复规则

每次模型调用的上下文只由以下部分编译：

```text
Role Summary
+ Current Goal
+ Trusted World State
+ Current Node Contract
+ Current Skill Stage Slice
+ Selected Profile
+ Relevant Evidence/Artifacts
+ Previous Quality Issues for target units
+ Output Schema
+ Runtime Guardrails
```

不再同时在 Main Agent instructions、taskGuidance、CapabilityRegistry、ToolRegistry、手册和 Node Contract 复制同一条规则。

建议权威源：

| 规则 | 唯一源 |
|---|---|
| 教材/安全/真实产物不变量 | shared invariants + contract |
| 专业方法和默认工艺 | Skill |
| 输入输出和硬门禁 | Node Contract |
| Tool 参数和 Provider 限制 | Tool Schema + ProviderProfile |
| 评分阈值和问题严重度 | Rubric |
| 当前运行状态 | DB/Artifact/Job/Event |
| 教师偏好 | Project/Teacher Memory |

## 6. 防止过度约束的规则格式

每条 Skill 策略建议包含：

```text
id
statement
applicability
default
overrideConditions
reasonRequired
examples
antiExamples
```

示例：

```text
id: ppt.sample.count
statement: 高质量路径应先做代表样张再批量生产
applicability: quality_path && visual_risk != low
default: 3
overrideConditions: 页数很少、页型高度单一、已有批准模板、风险评估要求更多覆盖
reasonRequired: true
```

这样 Agent 可以把 6 页简单复习课设为 2 张样张，也可以把 30 页多场景公开课设为 4 张；但不能跳过“高视觉风险先验证”的方法原则。

## 7. Contract 不应包含什么

以下内容若写成全局硬合同会压制模型：

- 所有 PPT 必须立体 3D、全部 AI 生图、纯白或某种色盘。
- 所有视频必须 6 个镜头、每个 10 秒、固定模型名。
- 所有镜头必须同样数量的参考图。
- 每个 PPT 都必须走同一 Provider。
- 每次失败都整套重做。

Contract 应只锁定事实、安全、身份、血缘、批准、真实文件和继续条件。审美与实现选择进入 Profile；Director 可在 Contract 内自主选择。

## 8. 版本与 provenance

每个交付 Artifact 至少记录：

- `skillId + skillVersion`
- `contractId + contractVersion`
- `rubricId + rubricVersion`
- `profileId + profileVersion`
- `productionPath + qualityTier + deliveryEligibility`
- 输入 artifact IDs/versions/hash
- Tool/provider/model 解析结果
- Prompt template version 与安全摘要
- ValidationReport/CriticReport/QualityDecision IDs
- HumanDecision ID、targetVersion、inputHash 和 action scope

这样出现质量漂移时，能判断是方法、合同、模型、Prompt、资产还是代码变化，而不是靠猜。

## 9. 当前架构如何最小复用

当前 `internal_capability → AgentRuntime` 只能证明 Router 能把内部 Tool 送到模型运行时，**不能直接当作完整 Agent-as-Tool 协议**。现状固定为 `CapabilityId → AgentRuntimeTask → Markdown Artifact`，成功结果也强制 artifactDraft；仅增加 profile 字段不足以承载 Director/Critic 的隔离 instructions、结构化 I/O 和报告语义。

第一阶段应先定义通用 `AgentToolExecutor`：

```text
expertProfileId
methodSkillId
allowedStages
outputContractId
readOnly
runtimeInstructionsRef
inputContextPolicy
outputMode: artifact_draft | critic_report | plan_draft
reportPersistencePolicy
```

它可以继续复用 ToolRouter 和部分 Runtime Adapter，但必须新增 profile 解析与 output-contract 运输。等 tracing、handoff、budget 语义稳定后，再决定是否增加独立 `agent` adapterKind。

## 10. 最终边界判断

- **是 Tool**：对 Main Agent 来说，PPT Director、Video Director、Delivery Critic 都应通过稳定工具接口调用。
- **也是 Skill**：Director 的专业能力来自按阶段加载的内置 Skill。
- **需要 AgentToolExecutor**：当前 internal capability 不是通用专家/审查运输协议，不能只改 ToolDefinition 就宣称完成。
- **不能只有 Tool**：Tool schema 无法承载完整专业方法和适用性判断。
- **不能只有 Skill**：Skill 不负责外部执行、状态、硬门禁和真实结果。
- **不能只有工作流**：工作流保存状态，但不替代 Agent 的创造、判断和 Replan。
