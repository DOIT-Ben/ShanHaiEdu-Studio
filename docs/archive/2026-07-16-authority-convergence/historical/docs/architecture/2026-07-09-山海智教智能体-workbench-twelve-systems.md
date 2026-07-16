# 山海智教智能体 Workbench 十二系统架构设计

日期：2026-07-09

状态：核心系统边界设计；后续阶段规划、模块拆分、节点契约、记忆中心、Provider 接入和质量门禁设计均应优先引用本文。

关联文档：

- `docs\architecture\2026-07-09-山海智教智能体-workbench-five-planes.md`
- `docs\architecture\2026-07-09-山海智教智能体-核心设计串联.md`
- `docs\architecture\智能体设计架构\README.md`
- `docs\product\current-requirements-baseline.md`
- `docs\product\2026-07-09-agent-os-first-principles-analysis.md`

## 1. 总定义

ShanHaiEdu 的完整系统可抽象为十二个子系统：

```text
1. 工作台体验系统 Workbench UX System
2. 项目与身份系统 Project & Actor System
3. 主对话智能体系统 Main Conversation Agent System
4. 节点契约控制系统 Node Contract Control Plane
5. 能力注册系统 Capability Registry System
6. 工作流编排系统 Workflow Orchestration System
7. 模型运行时系统 Agent Runtime System
8. Provider Adapter 系统 Provider Adapter System
9. 产物与资产系统 Artifact & Asset System
10. 记忆系统 Memory System
11. 知识与证据系统 Knowledge & Evidence System
12. 质量、门禁与治理系统 Quality / Guard / Governance System
```

十二系统服务于五平面架构：

```text
体验平面：1、部分 4、部分 10
智能体控制平面：3、4、5、6
执行运行平面：7、8、部分 9
数据与记忆平面：2、9、10、11
质量治理平面：12、部分 4、部分 8、部分 9、部分 10
```

## 2. 系统一：工作台体验系统

### 2.1 定义

工作台体验系统是教师和管理员进入产品的界面层。它不是普通展示页，而是生产控制台。

### 2.2 核心问题

它回答：

```text
用户如何提出需求、确认计划、查看节点、阅读产物、修改反馈、下载交付物？
```

### 2.3 核心对象

- Project sidebar：项目列表与当前项目。
- Conversation：主对话和确认动作。
- Node rail：节点压缩进度。
- Artifact detail：产物阅读侧栏。
- Download actions：真实文件下载。
- Admin surfaces：节点契约、记忆、版本、门禁配置。

### 2.4 责任边界

负责：

- 展示教师可理解状态。
- 收集用户输入和确认动作。
- 呈现产物和下载入口。
- 展示失败原因和下一步建议。
- 提供管理员配置入口。

不负责：

- 判断能力选择。
- 直接执行模型或 Provider。
- 自行推断成功状态。
- 暴露 provider、schema、node_id、local path 等工程词。

### 2.5 当前代码映射

```text
src\components\layout\MediaWorkbench.tsx
src\components\conversation\
src\components\artifacts\
src\hooks\useWorkbenchController.ts
src\lib\workbench-api.ts
src\lib\workbench-mappers.ts
```

### 2.6 应借鉴的机制

- Codex/OpenCode 类工作台：对话是主视觉，工具与产物为辅助。
- Hermes memory approval：长期偏好写入要对用户可见、可审批。
- Linear 式状态表达：少噪声、状态明确、操作靠近上下文。

### 2.7 建设方向

1. Quick reply 升级为 actionId 驱动的 HumanGate。
2. 节点状态显示以后端事实为准。
3. Artifact 详情显示 contractVersion、validationStatus 的教师友好投影。
4. 管理员后台先支持 YAML/JSON contract 编辑，后续表单化。

## 3. 系统二：项目与身份系统

### 3.1 定义

项目与身份系统负责“谁在什么项目里做什么”。

### 3.2 核心问题

它回答：

```text
当前请求属于哪个教师、哪个项目、哪个会话、哪个权限范围？
```

### 3.3 核心对象

- LocalUser / Teacher
- AuthSession
- Project
- ProjectMembership
- AuditLog
- Actor context

### 3.4 责任边界

负责：

- 本地身份和项目隔离。
- 项目读写权限。
- 操作审计。
- 未来学校、教研组、组织空间扩展。

不负责：

- 模型生成内容。
- 节点规则。
- 长期偏好语义解释。

### 3.5 当前代码映射

```text
prisma\schema.prisma
src\server\auth\workbench-route.ts
src\server\workbench\service.ts
src\server\workbench\repository.ts
```

### 3.6 应借鉴的机制

- Mem0 的 `user_id / run_id / metadata` 作用域思想。
- LangGraph namespace：长期存储必须按用户、项目、组织隔离。

### 3.7 建设方向

1. 为 memory、contract publish、provider run 增加 actor 审计。
2. 为项目记忆建立 project scope。
3. 为未来学校/组织模板预留 org scope。

## 4. 系统三：主对话智能体系统

### 4.1 定义

主对话智能体系统是用户自然语言和结构化工作流之间的翻译层。

### 4.2 核心问题

它回答：

```text
用户现在想聊、想补充、想确认、想修改，还是想生成？下一步应该进入哪个能力？
```

### 4.3 核心对象

- MainConversationAgent
- ConversationContextBuilder
- ContextBudgetManager
- SessionCompactor
- ContextPackage
- SessionContextSnapshot
- AgentWorldState
- MainAgentTurn
- PendingAction
- ToolPlan / DeliveryPlan

### 4.4 责任边界

负责：

- 理解用户意图。
- 生成待确认计划。
- 总结工具结果。
- 处理打断、修改、继续、重试。
- 把项目状态转成模型可理解上下文。
- 每轮调用前读取 `ContextPackage`，而不是直接拼接完整长对话。
- 在上下文接近预算时触发后台压缩或要求先刷新上下文快照。

不负责：

- 直接生成所有产物。
- 绕过 PlanGuard 调工具。
- 绕过 HumanGate 执行真实 provider。

### 4.5 当前代码映射

```text
src\server\conversation\model-main-conversation-agent.ts
src\server\conversation\main-conversation-agent.ts
src\server\conversation\conversation-turn-service.ts
```

### 4.6 应借鉴的机制

- OpenCode agents：主 Agent 与 subagent 分工。
- LangGraph state：主 Agent 应读取统一世界状态，而不是零散消息。
- Hermes session summary：长对话应压缩为稳定上下文。
- OpenCode compaction：旧历史压缩为锚定摘要，最近用户回合保留原文。

### 4.7 建设方向

1. 建立 `AgentWorldState`，统一消息、产物、节点、工具、失败、记忆。
2. 建立 `ConversationContextBuilder`。
3. 建立 `ContextBudgetManager` 和 `SessionCompactor`，让长对话压缩在后台无感发生。
4. 将 deterministic agent 明确降级为 fallback/test double。
5. 引入 ToolObservationLoop，让工具失败回到模型重新规划。

## 5. 系统四：节点契约控制系统

### 5.1 定义

节点契约控制系统是人类配置智能体节点行为的控制面。

它把“提示词、节点要求、下拉选项、质量标准、禁止项、失败策略”结构化、版本化、可发布。

### 5.2 核心问题

它回答：

```text
每个节点应该怎么工作？管理员如何修改？修改后如何同步到运行时？
```

### 5.3 核心对象

- NodeContract
- NodeContractVersion
- NodeContractDraft
- NodeContractPublishLog
- PromptProfile
- QualityRubric
- FieldControl

### 5.4 合同内容

每个节点契约至少包含：

```text
id / version / displayName
purpose
inputs.required / inputs.optional
outputs.requiredSections / structuredSchema
controls：下拉、多选、开关、范围、自由输入
constraints
forbidden
qualityGates
failurePolicy
teacherVisibleProjection
memoryReadPolicy / memoryWritePolicy
providerPolicy
```

### 5.5 当前代码映射

当前尚未独立存在，相关规则散落在：

```text
src\server\agent-runtime\task-guidance.ts
src\server\capabilities\capability-registry.ts
src\server\ppt-design\ppt-design-validation.ts
src\server\coze-ppt\coze-ppt-run.ts
```

### 5.6 应借鉴的机制

- OpenCode agents/commands/skills/config 文件化。
- AI-youjiao node manuals / tool registry。
- Hermes skills as procedural memory。
- LangGraph node schema。

### 5.7 建设方向

第一阶段文件化：

```text
config\node-contracts\ppt_design.yaml
config\node-contracts\coze_ppt.yaml
config\node-contracts\video_storyboard.yaml
config\node-contracts\video_segment_plan.yaml
config\node-contracts\final_package.yaml
```

第二阶段后台化：

```text
/admin/node-contracts
草稿 -> 校验 -> 预览 Prompt -> 测试运行 -> 发布 -> 回滚
```

### 5.8 架构不变量

节点契约不是普通记忆。它是系统工作规则，必须版本化、可审计、可回滚。

## 6. 系统五：能力注册系统

### 6.1 定义

能力注册系统是系统可执行能力的产品级目录。

### 6.2 核心问题

它回答：

```text
系统有哪些能力？每个能力依赖什么、输出什么、是否要确认、使用哪个 contract 和 provider？
```

### 6.3 核心对象

- CapabilityDefinition
- CapabilityId
- ProviderMode
- DeterministicFallbackPolicy
- Input/Output artifact kinds
- Upstream capability dependencies

### 6.4 责任边界

负责：

- 声明系统能力。
- 声明输入、输出、依赖。
- 声明是否需要确认。
- 声明使用的 contractId、providerPolicy 和 failureRecovery。

不负责：

- 写具体提示词。
- 直接调用模型。
- 生成工作流状态。

### 6.5 当前代码映射

```text
src\server\capabilities\capability-registry.ts
src\server\capabilities\types.ts
```

### 6.6 应借鉴的机制

- OpenCode tool/custom tool registry。
- AI-youjiao `tool-registry-index.yaml`。
- MCP tool description：给模型看的能力说明应清晰表达输入输出和限制。

### 6.7 建设方向

1. 增加 `contractId`。
2. 增加 `guardPolicy`。
3. 增加 `memoryPolicy`。
4. 增加 `modelDescription`，区别于教师可见 `userLabel`。
5. 将旧 `CapabilityPlanner` 降级为 deterministic fallback。

## 7. 系统六：工作流编排系统

### 7.1 定义

工作流编排系统负责把多个能力串成可恢复的生产链路。

### 7.2 核心问题

它回答：

```text
当前项目做到哪一步？下一步是什么？失败后怎么修？用户修改后哪些下游失效？
```

### 7.3 核心对象

- Workflow
- WorkflowNode
- NodeState
- DeliveryPlan
- DependencyGraph
- NodeVersion
- RetryPolicy
- Supersede / Invalidation

### 7.4 责任边界

负责：

- 节点状态机。
- 依赖解析。
- 局部重跑。
- 下游失效。
- 断点续跑。
- 单项目生成锁。

不负责：

- 节点内部生成细节。
- Provider 实现。
- 用户长期偏好写入。

### 7.5 当前代码映射

```text
src\server\workbench\workflow-defaults.ts
src\server\workbench\m2-orchestrator.ts
src\server\conversation\conversation-turn-service.ts
```

当前缺口是编排逻辑与对话服务、外部 Provider 执行耦合较重。

### 7.6 应借鉴的机制

- LangGraph state/node/edge/checkpoint。
- AI-youjiao workflow-v1/v2 节点状态和 handoff。
- OpenCode workspace/control-plane：不同 workspace/session 可被控制面调度。

### 7.7 建设方向

拆出：

```text
src\server\workflow\workflow-orchestrator.ts
src\server\workflow\node-state-machine.ts
src\server\workflow\dependency-resolver.ts
src\server\workflow\delivery-plan-advancer.ts
```

## 8. 系统七：模型运行时系统

### 8.1 定义

模型运行时系统负责调用 LLM/VLM 等模型 API，并返回结构化结果。

### 8.2 核心问题

它回答：

```text
给定编译后的 prompt、节点契约、上下文和上游产物，模型输出了什么结构化草稿？
```

### 8.3 核心对象

- AgentRuntime
- AgentRuntimeTask
- OpenAIRuntime
- RuntimeResult
- StructuredOutputSchema
- RuntimeObservation

### 8.4 责任边界

负责：

- 模型调用。
- 结构化输出解析。
- 模型失败分型。
- fallback runtime 标记。

不负责：

- 选择产品能力。
- 判断节点依赖。
- 保存 artifact。
- 直接隐藏失败。

### 8.5 当前代码映射

```text
src\server\agent-runtime\openai-runtime.ts
src\server\agent-runtime\deterministic-runtime.ts
src\server\agent-runtime\runtime-factory.ts
src\server\agent-runtime\types.ts
```

### 8.6 应借鉴的机制

- OpenAI Responses JSON schema 输出。
- OpenCode model/provider 配置化。
- Hermes skills progressive disclosure：不要把所有技能全塞进上下文。

### 8.7 建设方向

1. 从 `taskGuidance` 过渡到 `PromptCompiler + NodeContract`。
2. 按节点选择模型和温度。
3. 将 RuntimeObservation 交回 Main Agent。
4. DeterministicRuntime 只作为测试替身或明确降级草稿。

## 9. 系统八：Provider Adapter 系统

### 9.1 定义

Provider Adapter 系统封装所有外部工具和真实文件生成服务。

### 9.2 核心问题

它回答：

```text
如何安全、可替换、可校验地调用外部服务？
```

### 9.3 核心对象

- CozePptAdapter
- ImageProviderAdapter
- VideoProviderAdapter
- DocumentParserAdapter
- ProviderConfig
- ProviderRunResult
- ProviderHealth

### 9.4 责任边界

负责：

- 读取服务端环境变量。
- 调用外部 API/CLI。
- 下载真实文件。
- 返回结构化 metadata。
- 报告失败类型。

不负责：

- 决定是否应该调用。
- 将失败伪装成功。
- 在 UI 暴露密钥、URL、路径或 provider 细节。

### 9.5 当前代码映射

```text
src\server\coze-ppt\coze-ppt-run.ts
src\server\image-generation\
src\server\video-generation\
```

### 9.6 应借鉴的机制

- AI-youjiao pre-submit gate：真实提交前 dry-run、allowlist、用户授权。
- Coze CLI/Session 真实文件产物通道。
- OpenCode custom tools：外部工具以可注册、可权限控制方式暴露。

### 9.7 建设方向

1. 统一 ProviderRunResult 类型。
2. 增加 provider health 和 readiness。
3. 外部真实生成能力必须有 sourceArtifact、job、output metadata。
4. 对图片、视频补质量门禁，不只校验文件头。

## 10. 系统九：产物与资产系统

### 10.1 定义

产物与资产系统保存和呈现系统生产出来的一切可复用结果。

### 10.2 核心问题

它回答：

```text
这个结果是什么？从哪里来？能不能复用？能不能下载？是否真实通过校验？
```

### 10.3 核心对象

- Artifact
- ArtifactVersion
- StructuredContent
- File metadata
- Source relationships
- Validation metadata
- Download projection

### 10.4 建议 metadata

```json
{
  "contractId": "ppt_design",
  "contractVersion": "2026-07-09-v1",
  "validationStatus": "passed",
  "providerStatus": "real",
  "sourceArtifactIds": [],
  "evidenceIds": [],
  "file": {
    "bytes": 0,
    "sha256": "...",
    "slideCount": 12
  }
}
```

### 10.5 当前代码映射

```text
ArtifactRecord
src\server\artifact-storage\
src\server\pptx\artifact-pptx.ts
src\components\artifacts\
```

### 10.6 应借鉴的机制

- Letta MemFS：文件化记忆/产物可以被版本追踪。
- AI-youjiao manifest/evidence_index：每个节点输出应有 manifest。

### 10.7 建设方向

1. Artifact 记录 contractVersion。
2. Artifact 记录 validationStatus。
3. Artifact 记录 sourceArtifactIds。
4. 区分 Markdown 草稿、真实文件、最终交付包。
5. 下载只允许通过真实文件 metadata。

## 11. 系统十：记忆系统

### 11.1 定义

记忆系统让工作台具备个性化和历史连续性，但必须分层、可审查、可删除。

### 11.2 核心问题

它回答：

```text
系统应该记住什么？什么时候读取？谁批准写入？记忆作用域是什么？
```

### 11.3 记忆类型

```text
TeacherProfileMemory：教师长期偏好。
ProjectMemory：当前项目事实和决策。
SessionMemory：当前对话临时状态。
SessionContextSnapshot：当前会话旧历史的结构化压缩摘要。
ContextPackage：每轮模型实际读取的上下文包。
ProceduralMemory：节点契约、skills、SOP。
OrganizationMemory：学校/教研组/地区规范。
```

### 11.4 责任边界

负责：

- 记忆存储。
- 记忆检索。
- 记忆写入建议。
- 写入审批。
- 删除、过期、合并。
- 按 scope 注入模型上下文。
- 保存完整 Conversation Log，并在后台维护可替换旧历史的 SessionContextSnapshot。
- 区分 Session Summary、Project Memory、Teacher Profile Memory，避免跨作用域污染。

不负责：

- 替代项目事实库。
- 替代节点契约。
- 保存密钥或敏感账号。
- 删除原始对话来换取压缩效果。
- 用摘要状态替代 Artifact、Workflow、Quality Gate 的真实状态。

### 11.5 应借鉴的机制

- Hermes `USER.md` / `MEMORY.md`：小型 curated memory。
- Hermes write approval：长期记忆写入审批。
- OpenCode compaction：摘要更新、最近回合保留、工具输出裁剪。
- Mem0：user/session/org memory 和 metadata。
- Letta：background reflection。
- LangGraph：short-term memory 与 long-term store 分离。

### 11.6 建设方向

MVP 表：

```text
MemoryItem
MemoryWriteProposal
MemoryRetrievalLog
SessionContextSnapshot
ContextBuildLog
```

MVP 能力：

```text
查看教师偏好
提出写入建议
审批/拒绝
项目记忆自动写入
运行时按节点读取相关记忆
长对话后台无感压缩
上下文包构建与 token 预算估算
```

### 11.7 对话上下文与无感压缩机制

ShanHaiEdu 必须区分“用户可见完整历史”和“模型可读上下文”。原始 Conversation Log 完整保存，服务用户回看、审计和恢复；模型每轮读取由 `ConversationContextBuilder` 生成的 `ContextPackage`。

```text
ContextPackage = 系统规则
  + Project State
  + Workflow / Node State
  + active SessionContextSnapshot
  + Project Memory
  + 已审批 Teacher Memory
  + 相关 Artifact / Evidence 摘要
  + 最近消息原文
  + 当前用户输入
  + Runtime Guardrails
```

后台 `SessionCompactor` 在以下场景刷新摘要：上下文估算超过预算阈值、工具输出过大、关键 Artifact 生成后、用户离开或重新进入长会话前。压缩对教师无感；前端不得暴露 compaction、token、snapshot 等工程词。

`SessionContextSnapshot` 至少记录：

```text
projectId / conversationId / version
summaryMarkdown
sourceMessageFromId / sourceMessageToId
preservedRecentMessageIds
tokenEstimateBefore / tokenEstimateAfter
model / createdBy / createdAt
status: active | superseded | failed
```

教育工作台摘要应包含：Teaching Objective、Confirmed Requirements、Project Facts、Workflow State、Artifact State、User Preferences、Open Decisions、Next Best Actions、Guardrails。摘要只能辅助模型理解，不能决定真实完成状态。

## 12. 系统十一：知识与证据系统

### 12.1 定义

知识与证据系统为教育内容提供可信依据。

### 12.2 核心问题

它回答：

```text
这条教学设计、知识点、PPT 页面和课堂活动的依据是什么？来源在哪里？可信度如何？
```

### 12.3 核心对象

- SourceDocument
- TextbookPage
- OCRBlock
- Citation
- LessonAnchor
- EvidenceRecord
- EvidenceIndex

### 12.4 责任边界

负责：

- 教材解析。
- OCR 与页码定位。
- 引用片段。
- 教材证据链。
- 区分已证实、推断、不确定。

不负责：

- 直接生成所有教案内容。
- 伪造教材来源。

### 12.5 当前代码映射

当前存在部分 fixture 和教材证据意识，但尚未形成独立系统。

相关未来位置可为：

```text
src\server\evidence\
src\server\textbook\
```

### 12.6 应借鉴的机制

- RAG metadata filtering。
- Mem0/向量检索的 metadata scope。
- AI-youjiao `lesson_anchors.json` 和教材解析节点。

### 12.7 建设方向

1. 先建立 EvidenceRecord。
2. 教案、PPT、视频节点都能引用 lesson anchors。
3. 用户可见内容区分“教材依据”和“设计建议”。
4. 没证据时标记为推断，不得伪装教材结论。

## 13. 系统十二：质量、门禁与治理系统

### 13.1 定义

质量、门禁与治理系统保证产品不是“生成即完成”，而是“通过验收才可交付”。

### 13.2 核心问题

它回答：

```text
这个计划能不能执行？这个产物能不能保存？这个文件能不能下载？这个项目能不能标记完成？
```

### 13.3 核心对象

- PlanGuard
- HumanGate
- ContractValidator
- PptDesignValidator
- PptxValidator
- VideoAuditGate
- FinalDeliveryGate
- PrivacyGuard
- SecurityGuard
- AuditLog
- SummaryValidator
- ContextScopeGuard

### 13.4 当前代码映射

```text
src\server\ppt-design\ppt-design-validation.ts
src\server\coze-ppt\coze-ppt-run.ts
src\server\pptx\artifact-pptx.ts
docs\product\current-requirements-baseline.md
```

当前缺口：

```text
PlanGuard
actionId HumanGate
通用 ContractValidator
视频质量门禁
最终交付强校验
记忆写入审批
摘要质量校验
上下文作用域校验
```

### 13.5 应借鉴的机制

- AI-youjiao：keyframe_audit_gate、pre_submit_gate、video_audit_gate、delivery_gate。
- Hermes：memory write approval。
- OpenCode：permission policy。

### 13.6 建设方向

1. `shouldRunToolNow` 必须经过 PlanGuard。
2. 真实 provider 必须经过 HumanGate。
3. `ppt_design_draft` 必须通过逐页完整校验。
4. `pptx_artifact` 必须通过真实 PPTX 和 slideCount 校验。
5. 视频必须通过结构化前置、真实文件、视觉审核和拼接门禁。
6. 最终包只打包合格真实产物。
7. 会话摘要必须校验：不能把未完成写成完成，不能丢失关键禁止项，不能把临时偏好写成长期记忆。
8. 压缩 agent 不拥有真实 Provider 执行权限，只能读源消息和写入摘要快照。

## 14. 横切机制：对话上下文与无感压缩

### 14.1 目标

该机制保证：用户回到任意历史项目时，完整对话、节点状态和产物状态都可恢复；模型继续工作时，只读取经过预算控制、作用域隔离和质量校验的必要上下文。

### 14.2 关键对象

```text
Conversation Log：完整原始消息，不因压缩删除。
SessionContextSnapshot：旧历史摘要，可版本化、可回滚、可重建。
ContextPackage：每轮模型输入边界。
ContextBudgetManager：估算 token 和判断压缩策略。
SessionCompactor：后台生成或刷新摘要。
SummaryValidator：校验摘要不伪造事实、不越权写记忆。
```

### 14.3 触发策略

```text
< 40% context budget：不压缩，直接使用项目状态、相关摘要和最近消息。
40%-70% context budget：后台异步预压缩，不阻塞普通对话。
> 70% context budget：主 Agent 调用前必须先刷新 SessionContextSnapshot。
工具输出过大：生成 Tool Output Digest，不把原始大日志、大文档、大设计稿常驻上下文。
```

### 14.4 失败策略

压缩失败不能导致原始历史丢失。低风险对话可降级为：Project State、Workflow State、Artifact metadata、最近消息原文。关键交付节点若无法恢复必要上下文，必须保守中断并要求用户确认，而不是盲目继续生成。

## 15. 十二系统之间的关系

### 15.1 主链路

```text
Workbench UX
  -> Main Conversation Agent
  -> Capability Registry
  -> Node Contract Control Plane
  -> Workflow Orchestration
  -> Agent Runtime / Provider Adapter
  -> Artifact & Asset System
  -> Quality / Guard / Governance
  -> Memory / Evidence / Project State
  -> Workbench UX
```

### 15.2 管理员优化链路

```text
Admin UX
  -> Node Contract Draft
  -> Contract Schema Validation
  -> Prompt Preview / Test Run
  -> Publish Contract Version
  -> Runtime loads latest published version
  -> Artifact records contractVersion
```

### 15.3 记忆反哺链路

```text
Conversation / Artifact / User Feedback
  -> Memory Write Proposal
  -> Approval / Auto project memory
  -> Memory Store
  -> Context Compiler retrieves scoped memory
  -> Agent Runtime uses memory in next task
```

### 15.4 证据链路

```text
Textbook / SourceDocument
  -> Evidence Extractor
  -> LessonAnchor / Citation
  -> LessonPlan / PPT / Video nodes
  -> Artifact metadata records evidenceIds
  -> FinalDeliveryGate verifies evidence coverage
```

## 16. Tool、Capability、Node Contract、Skill、Workflow、Agent 的层级

### 16.1 Tool

最小执行单元：

```text
下载 PPTX、调用 Coze、解析 PDF、生成图片、提交视频、校验文件、压缩 ZIP。
```

### 16.2 Capability

面向产品的能力：

```text
生成 PPT 设计稿、生成真实 PPTX、生成导入视频分镜、打包最终材料。
```

### 16.3 Node Contract

能力的规则说明书：

```text
输入是什么、输出是什么、禁止什么、怎样算通过。
```

### 16.4 Skill

可复用流程知识：

```text
如何做 PPT 设计、如何审查关键帧、如何做教材证据链。
```

### 16.5 Workflow

多能力有向流程：

```text
公开课完整材料包、PPT 生成工作流、导入视频工作流、最终交付工作流。
```

### 16.6 Agent

调度者：

```text
根据用户目标、项目状态、记忆、节点契约和工具状态，决定下一步做什么。
```

## 17. 复用先进机制的系统级映射

| 外部思想/工具 | 复用点 | 映射系统 |
|---|---|---|
| OpenCode config/agents/commands/skills | 文件化配置、按需加载、控制面 | 节点契约、能力注册、模型运行时 |
| OpenCode server/OpenAPI | 本地 server 控制 agent runtime | 工作台体验、主对话、工作流编排 |
| OpenCode compaction | 锚定摘要、最近回合保留、后台压缩、工具输出裁剪 | 主对话、记忆系统、质量治理 |
| Hermes USER/MEMORY | 小型长期记忆、用户画像 | 记忆系统 |
| Hermes write approval | 记忆写入审批 | 记忆系统、质量治理 |
| Hermes skills | 程序性记忆 | 节点契约、技能、工作流 |
| Mem0 memory types | 用户/会话/组织记忆分层 | 记忆系统 |
| Letta memory blocks | 常驻块与归档记忆 | 记忆系统 |
| LangGraph state/checkpoint | 工作流状态、断点恢复 | 工作流编排、主对话 |
| AI-youjiao node manuals | 节点输入输出、门禁、handoff | 节点契约、质量治理 |
| Coze CLI/Session | 真实 PPTX 文件产物 | Provider Adapter |

## 18. 推荐建设顺序

### 阶段 A：架构文档固化

完成本文和五平面文档，作为后续主线的骨架。

### 阶段 B：节点契约 MVP

先做：

```text
ppt_design
coze_ppt
video_storyboard
video_segment_plan
final_package
```

### 阶段 C：PromptCompiler 与 ContractValidator

将 `task-guidance.ts` 从硬编码逐步改为动态 contract。

### 阶段 D：Memory MVP

实现：

```text
TeacherProfileMemory
ProjectMemory
MemoryWriteProposal
```

### 阶段 E：Conversation Context MVP

实现：

```text
ConversationContextBuilder
ContextBudgetManager
SessionContextSnapshot
SessionCompactor
SummaryValidator
```

### 阶段 F：HumanGate / PlanGuard

工具执行必须绑定 actionId、pendingAction 和 guard 结果。

### 阶段 G：Admin 控制台

先 YAML/JSON 编辑，后可视化表单化。

### 阶段 H：Workflow Orchestrator 拆分

拆解重型 conversation-turn-service，形成独立编排系统。

## 19. 系统设计不变量

1. 教师项目是中心，不是消息流。
2. Agent 是调度者，不是单点生成器。
3. Node Contract 是规则源，不是普通 prompt。
4. Tool/Provider 是执行器，必须可替换、可校验。
5. Artifact 是事实，必须可追溯、可下载、可验证。
6. Memory 是个性化，不可污染项目事实和节点契约。
7. Evidence 是可信度，教育内容不能无依据冒充教材结论。
8. Quality Gate 是交付保障，模型自称完成不等于完成。
9. UI 是教师工作台，不是工程调试台。
10. 所有真实交付都必须有可复验的证据。
11. 完整 Conversation Log 必须保留；压缩只替代模型输入旧历史，不删除用户历史。
12. ContextPackage 是模型输入边界，不能让模型直接吞完整长会话。
13. SessionContextSnapshot 必须可版本化、可重建、可校验，不能成为唯一事实源。

## 20. 与五平面文档的关系

本文回答“系统怎么拆”。

`docs\architecture\2026-07-09-山海智教智能体-workbench-five-planes.md` 回答“这些系统属于哪些最高层平面，以及不同平面如何协作”。

后续所有设计建议遵守：

```text
先判断属于哪个平面，再判断属于哪个系统，再设计模块、接口和数据结构。
```
