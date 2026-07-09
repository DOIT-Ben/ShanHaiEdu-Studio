# 山海智教智能体 Workbench 五平面架构设计

日期：2026-07-09

状态：核心架构骨干设计；后续阶段规划、节点契约、记忆系统、Provider 接入和质量门禁设计均应优先引用本文。

关联文档：

- `docs\architecture\2026-07-09-山海智教智能体-workbench-twelve-systems.md`
- `docs\architecture\2026-07-09-山海智教智能体-核心设计串联.md`
- `docs\architecture\智能体设计架构\README.md`
- `docs\product\current-requirements-baseline.md`
- `docs\product\2026-07-09-agent-os-first-principles-analysis.md`

## 1. 一句话定义

ShanHaiEdu 不是普通 AI 聊天工具，也不是单点 PPT 或视频生成工具，而是：

```text
一个以教师项目为中心，以 Agent 为调度者，以节点契约为规则，以工具/Provider 为执行器，以 Artifact 为事实，以 Memory 为个性化，以 Evidence 为可信度，以 Quality Gate 为交付保障的教育内容生产操作系统。
```

五平面架构用于回答：这个操作系统从最高层应该怎么分区、每个分区负责什么、系统之间如何协作、哪些成熟机制可以复用。

## 2. 第一性原理

教师真实备课不是一次性生成文本，而是一个持续收敛过程：

```text
自然需求 -> 目标确认 -> 教材证据 -> 教案 -> PPT -> 图片/视频 -> 审核 -> 修改 -> 交付 -> 复用
```

这个过程天然具备以下特点：

1. **目标会变**：教师可能随时补充风格、课时、班情、教材页、输出格式。
2. **产物要可审查**：教案、PPT、视频不能只看模型自称完成，必须能被教师和系统检查。
3. **文件要真实**：PPTX、图片、视频、最终包必须有真实文件结构、下载路径和质量校验。
4. **失败要可恢复**：某个节点失败时，应该只修失败节点或失败镜头，而不是重跑全部。
5. **偏好要可记住**：教师长期偏好、项目决策、历史踩坑应能在合适范围内被召回。
6. **规则要可修改**：节点要求、提示词、质量门禁、下拉选项需要管理员持续优化，而不是写死在代码里。

因此，系统不应只有“前端 + 后端 + 模型接口”三层，而应拆成五个职责平面。

## 3. 五平面总览

```text
体验平面 Experience Plane
  ↓ 用户操作、确认、阅读、下载
智能体控制平面 Agent Control Plane
  ↓ 理解、计划、节点契约、提示词编译、确认门禁
执行运行平面 Runtime Plane
  ↓ 模型、工具、Provider、文件生成、适配器
数据与记忆平面 Data & Memory Plane
  ↓ 项目、会话、产物、证据、用户偏好、项目记忆
质量治理平面 Quality & Governance Plane
  ↓ 合同校验、真实文件校验、隐私安全、审计、交付门禁
```

五个平面不是部署层级，而是职责分区。一个代码模块可以横跨多个平面，但设计上必须明确它主要服务哪个平面，避免职责混杂。

## 4. 平面一：体验平面 Experience Plane

### 4.1 定义

体验平面是教师、管理员和内部运营人员直接接触系统的界面集合。

教师看到的是：

```text
项目、对话、节点进度、产物、确认、修改、下载、失败说明。
```

管理员看到的是：

```text
节点契约、提示词配置、下拉选项、记忆审批、版本发布、质量报告。
```

### 4.2 核心职责

1. 承载教师主工作流：从一句话备课需求到最终材料包。
2. 呈现节点进度：哪些已完成、哪些待确认、哪些失败、哪些可重试。
3. 呈现 Artifact：教案、PPT 设计稿、PPTX、图片、视频、最终包。
4. 承载 HumanGate：确认开始、继续下一步、重试、修改、回退。
5. 承载管理员配置：节点契约编辑、版本发布、记忆审批。

### 4.3 非职责

体验平面不负责：

- 判断应该调用哪个模型或工具。
- 直接读取密钥或调用外部 Provider。
- 伪造成功状态。
- 根据前端按钮禁用替代后端锁或队列。
- 暴露内部工程字段。

### 4.4 当前项目映射

当前主要对应：

```text
src\components\
src\hooks\
src\lib\workbench-api.ts
src\lib\workbench-mappers.ts
```

### 4.5 设计原则

1. 教师界面只讲教学语言，不讲工程语言。
2. 失败说明必须可理解、可操作。
3. 下载按钮必须基于真实文件和真实校验结果。
4. 节点进度是状态投影，不是前端自造状态。
5. 管理员界面可以显示工程配置，但必须有权限和审计。

### 4.6 可借鉴机制

- OpenCode 的 TUI/Server 分离：体验层是 client，运行时由 server 控制。
- Linear/Codex 风格工作台：低噪声、密集、任务优先。
- Hermes 的记忆审批体验：长期记忆写入不应静默发生。

## 5. 平面二：智能体控制平面 Agent Control Plane

### 5.1 定义

智能体控制平面负责决定“下一步该做什么”，并把人类可编辑规则转化为模型和工具可执行的指令。

它是系统的指挥层，不是具体生产层。

### 5.2 核心职责

1. 主对话理解：判断用户是在聊天、补充需求、确认计划、要求修改，还是请求生成。
2. 能力选择：选择 `requirement_spec`、`lesson_plan`、`ppt_design`、`coze_ppt`、`video_segment_plan` 等能力。
3. 节点契约加载：根据 capability 找到当前 published contract。
4. 提示词编译：把节点契约、项目上下文、上游产物、记忆和证据编译为模型输入。
5. 计划校验：通过 PlanGuard 判断模型提出的 toolPlan 是否可执行。
6. 人工确认：通过 HumanGate 判断真实执行是否获得授权。
7. 编排推进：决定当前节点成功后下一节点是什么，失败后如何重试、回退或改路。
8. 上下文编排：每轮模型调用前生成 `ContextPackage`，而不是把完整长对话原文直接塞给模型。

### 5.3 关键组件

```text
MainConversationAgent
ConversationContextBuilder
ContextBudgetManager
SessionCompactor
AgentWorldState / ContextCompiler
CapabilityRegistry
NodeContractRegistry
PromptCompiler
PlanGuard
HumanGate / PendingAction
WorkflowOrchestrator
DeliveryPlanAdvancer
```

### 5.4 当前项目映射

当前已有或部分已有：

```text
src\server\conversation\model-main-conversation-agent.ts
src\server\conversation\main-conversation-agent.ts
src\server\conversation\conversation-turn-service.ts
src\server\capabilities\capability-registry.ts
src\server\capabilities\capability-planner.ts
src\server\agent-runtime\task-guidance.ts
```

当前缺口：

```text
NodeContractRegistry
PromptCompiler
PlanGuard
HumanGate actionId
AgentWorldState
ContextPackage / SessionContextSnapshot
后台无感压缩任务
```

### 5.5 设计原则

1. 模型负责理解和提出计划，代码负责审核和执行边界。
2. 规则不要散落在 prompt 字符串里，应沉淀为 Node Contract。
3. 用户确认不能只靠自然语言正则，应通过 actionId 绑定 pendingAction。
4. CapabilityRegistry 说“有什么能力”，NodeContract 说“能力怎么做”。
5. WorkflowOrchestrator 只推进合法状态，不伪造完成。
6. 主 Agent 不直接读取完整历史，而读取由 `ConversationContextBuilder` 编排过的上下文包。

### 5.6 可借鉴机制

- OpenCode 的 `agents/commands/skills/config` 文件化和 server control plane。
- LangGraph 的 node/state/edge/checkpoint 思维。
- AI-youjiao 的节点手册和工具注册表。
- Hermes skills 的 progressive disclosure：只在需要时加载完整技能/契约。

## 6. 平面三：执行运行平面 Runtime Plane

### 6.1 定义

执行运行平面负责真正“做事”：调用模型、调用 Coze、生成图片、生成视频、解析文档、读写文件、打包下载。

### 6.2 核心职责

1. 模型运行时：调用 OpenAI-compatible API 或 fallback runtime。
2. Provider Adapter：封装 Coze PPT、图片、视频、OCR、文档解析等外部服务。
3. 文件生成：下载 PPTX、保存图片、保存视频、打包 ZIP。
4. 工具观测：返回 providerStatus、bytes、sha256、slideCount、duration、errorCategory。
5. 失败分型：配置缺失、请求失败、下载失败、文件无效、页数不匹配、质量门禁失败。

### 6.3 关键组件

```text
AgentRuntime
OpenAIRuntime
DeterministicRuntime / Test Double
CozePptAdapter
ImageProviderAdapter
VideoProviderAdapter
DocumentParserAdapter
ArtifactStorage
DownloadBuilder
PackageAssembler
```

### 6.4 当前项目映射

```text
src\server\agent-runtime\openai-runtime.ts
src\server\agent-runtime\runtime-factory.ts
src\server\coze-ppt\coze-ppt-run.ts
src\server\image-generation\
src\server\video-generation\
src\server\artifact-storage\
src\server\pptx\artifact-pptx.ts
```

### 6.5 设计原则

1. 所有外部调用都必须走 Provider Adapter。
2. Provider 未成功不能返回 succeeded。
3. 真实交付文件必须下载到本地并校验。
4. 密钥只在服务端 adapter 层读取。
5. Runtime 不应决定产品流程，只接收编译好的任务输入并返回结构化结果。

### 6.6 可借鉴机制

- OpenCode custom tools / plugins：工具扩展应有统一注册与权限模型。
- AI-youjiao 的 pre-submit gate：真实视频提交前必须 dry-run 和授权。
- Coze CLI / Claw Session 实测链路：PPTX 生成短期主通道应以真实文件和 slideCount 为准。

## 7. 平面四：数据与记忆平面 Data & Memory Plane

### 7.1 定义

数据与记忆平面负责保存事实、状态、上下文、证据和个性化信息。

这里必须区分：

```text
项目事实 ≠ 会话临时状态 ≠ 用户长期偏好 ≠ 节点契约 ≠ 技能经验
```

### 7.2 核心职责

1. 项目数据：项目、用户、权限、节点状态。
2. 对话数据：完整消息、assistant turn、pendingAction、会话摘要、上下文快照。
3. 产物数据：Artifact、版本、来源、文件 metadata、合同版本、校验状态。
4. 生成任务：队列、运行中、成功、失败、重试。
5. 记忆数据：教师偏好、项目记忆、会话记忆、程序性记忆。
6. 证据数据：教材、页码、OCR、引用、来源、置信度。
7. 上下文数据：`ContextPackage`、`SessionContextSnapshot`、token 估算、摘要来源消息范围和保留消息范围。

### 7.3 记忆分层

```text
Teacher Profile Memory：长期用户偏好，小而准，可审批。
Project Memory：绑定项目，保存已确认目标、教材、风格、决策和产物。
Session Memory：当前对话临时状态，可压缩、可清理、可恢复。
Procedural Memory：节点契约、skills、workflow templates、SOP。
Organization Memory：学校模板、教研组规范、地区课标、公共素材库。
```

### 7.4 对话上下文与无感压缩

长对话不能依赖模型“自己记得”。ShanHaiEdu 必须完整保存原始对话，但每轮模型调用只发送经过编排的必要上下文。

```text
Conversation Log：完整原始消息，服务用户回看、审计和恢复，不因压缩删除。
SessionContextSnapshot：旧对话的结构化摘要，记录覆盖消息范围、保留最近消息、压缩模型、版本和 token 变化。
ContextPackage：每轮实际发给模型的上下文包，由项目状态、节点状态、Artifact 摘要、Evidence、Memory、Session Summary、最近消息和当前输入组成。
```

压缩应由后台无感触发：当上下文估算接近预算阈值、工具输出过大、生成关键产物后，或用户离开后，系统刷新 `SessionContextSnapshot`。压缩失败不得删除原始历史；低风险对话可降级使用项目状态、最近消息和 Artifact metadata，关键交付节点必须保守中断并提示需要恢复上下文。

### 7.5 压缩摘要结构

ShanHaiEdu 的会话摘要不采用通用聊天摘要，而采用教育工作台结构：

```text
Teaching Objective：年级、学科、课题、课时、交付物。
Confirmed Requirements：已确认要求、禁止擅改边界、风格和格式。
Project Facts：教材版本、单元、课文/知识点、班情、素材来源。
Workflow State：节点进度、待确认节点、失败节点和重跑边界。
Artifact State：artifactId、类型、状态、真实文件和质量门禁结果。
User Preferences：本会话出现但未写入长期记忆的偏好。
Open Decisions：尚待用户确认的问题。
Next Best Actions：下一步推荐动作。
Guardrails：本项目禁止事项和质量边界。
```

摘要不是事实源。Artifact 真实状态必须以数据库和质量门禁为准；长期偏好必须走记忆写入审批；节点规则必须来自 Node Contract。

### 7.6 当前项目映射

```text
prisma\schema.prisma
src\server\workbench\repository.ts
src\server\workbench\service.ts
ConversationMessage
SessionContextSnapshot
ContextPackage
Artifact
GenerationJob
AuditLog
```

### 7.7 设计原则

1. Artifact 是事实，不是聊天消息附属品。
2. 每个真实文件必须记录可验证 metadata，如 bytes、sha256、slideCount、duration。
3. 长期记忆写入应可审批、可删除、可追溯。
4. 项目记忆不能污染其他项目。
5. 大型教材和历史内容不应常驻 prompt，应按需检索。
6. 原始对话不因压缩删除；压缩只影响模型输入，不影响用户回看和审计。
7. 会话摘要不能把未完成产物写成已完成，也不能把临时想法写成长期偏好。

### 7.8 可借鉴机制

- Hermes 的 `USER.md` / `MEMORY.md`：小型 curated memory、写入审批、会话启动注入。
- OpenCode compaction：旧历史摘要 + 最近消息原文保留 + 锚定摘要更新。
- Mem0 的 user/session/org memory 和 metadata filtering。
- Letta 的 memory blocks、archival memory、background reflection。
- LangGraph 的 short-term state + long-term store 分离。

## 8. 平面五：质量治理平面 Quality & Governance Plane

### 8.1 定义

质量治理平面负责判断“能不能继续、能不能下载、能不能说完成、能不能写入记忆、能不能调用真实 Provider”。

它是系统可靠性的最后防线。

### 8.2 核心职责

1. 节点合同校验：输出是否满足 Node Contract。
2. 真实文件校验：PPTX、图片、视频、ZIP 是否真实有效。
3. 证据校验：教材引用、页码、课标、来源是否存在。
4. 交付门禁：最终包是否包含合格教案、PPTX、图片、视频、说明和 QA。
5. 隐私安全：密钥、本地路径、账号、内部字段不得出现在用户可见界面。
6. 记忆治理：长期偏好写入审批、敏感记忆阻断、过期和删除。
7. 审计观测：记录谁在何时触发了哪个节点、使用哪个 contract、调用哪个 provider、结果如何。
8. 摘要治理：校验会话摘要不丢失关键约束、不伪造完成状态、不污染长期记忆。

### 8.3 关键组件

```text
ContractValidator
PlanGuard
HumanGate
PptDesignValidator
PptxValidator
ImageValidator
VideoValidator
FinalDeliveryGate
PrivacyGuard
AuditLog
MemoryWriteApproval
SummaryValidator
ContextScopeGuard
```

### 8.4 当前项目映射

```text
src\server\ppt-design\ppt-design-validation.ts
src\server\coze-ppt\coze-ppt-run.ts
src\server\pptx\artifact-pptx.ts
docs\product\current-requirements-baseline.md
AGENTS.md
```

当前缺口：

```text
统一 ContractValidator
统一 PlanGuard
actionId HumanGate
视频 QA Gate
FinalDeliveryGate 强校验
MemoryWriteApproval
SummaryValidator
ContextScopeGuard
```

### 8.5 设计原则

1. 模型输出不能直接等于完成。
2. `shouldRunToolNow` 不能绕过 PlanGuard 和 HumanGate。
3. Mock、placeholder、deterministic draft、文本 fallback 不得伪装真实交付。
4. 失败原因必须内部可诊断，外部可理解。
5. 交付状态必须由真实校验结果驱动。
6. 压缩摘要不能决定产物完成状态；它只能作为模型上下文线索。
7. 长期记忆写入、项目事实更新和会话摘要刷新必须有作用域隔离。

### 8.6 可借鉴机制

- AI-youjiao 的 keyframe audit、pre-submit gate、video audit、delivery gate。
- Hermes memory write approval。
- OpenCode compaction permissions：压缩 agent 不应拥有真实工具执行权限。
- OpenCode permissions：不同工具与操作应有明确权限。
- 真实 PPTX 校验：zip header、`ppt/presentation.xml`、slideCount。

## 9. 五平面之间的数据流

### 9.1 正常生成流

```text
体验平面：教师提出需求
  ↓
控制平面：Main Agent 理解并选择 capability
  ↓
控制平面：加载 Node Contract 并编译 prompt
  ↓
运行平面：调用模型或 Provider
  ↓
数据平面：保存 Artifact / Job / Message
  ↓
质量平面：校验合同、文件、证据和交付门禁
  ↓
体验平面：展示可读结果、确认项和下载入口
  ↓
数据平面：沉淀项目记忆或待审批长期记忆
```

### 9.2 对话恢复与后台压缩流

```text
体验平面：用户发送消息或回到历史项目
  ↓
数据平面：完整 Conversation Log、Project State、Artifact State 原样恢复
  ↓
控制平面：ContextBudgetManager 估算上下文预算
  ↓
数据平面：若接近阈值，后台 SessionCompactor 生成或刷新 SessionContextSnapshot
  ↓
质量平面：SummaryValidator 校验摘要不伪造完成、不丢关键禁止项、不越权写长期记忆
  ↓
控制平面：ConversationContextBuilder 生成 ContextPackage
  ↓
运行平面：模型只接收 ContextPackage，不接收全部原始长历史
```

用户看到的是完整历史和连续项目；模型看到的是可控、可压缩、可校验的上下文包。

### 9.3 失败恢复流

```text
运行平面：Provider 失败或文件校验失败
  ↓
质量平面：分型失败原因
  ↓
控制平面：把 observation 回给 Main Agent
  ↓
控制平面：决定重试、换路、降级、回退或询问用户
  ↓
体验平面：显示教师可理解的失败原因和下一步
  ↓
数据平面：保存失败节点、失败原因、可重试状态
```

### 9.4 管理员优化流

```text
体验平面：admin 编辑节点契约或记忆
  ↓
质量平面：校验 contract schema / 敏感信息 / 冲突
  ↓
数据平面：保存 draft
  ↓
体验平面：admin 预览 prompt、测试运行、发布
  ↓
控制平面：ContractRegistry 激活新版本
  ↓
运行平面：下一次节点执行使用新 contract
  ↓
数据平面：Artifact 记录 contractVersion
```

## 10. 复用原则

本项目应坚持“复用机制，不盲目复用整套产品”。

| 来源 | 可借鉴机制 | 应用到哪个平面 |
|---|---|---|
| OpenCode | agents/commands/skills/config 文件化，server control plane，plugin/tools | 控制平面、体验平面、运行平面 |
| OpenCode compaction | 后台摘要、最近回合保留、锚定摘要更新、prompt cache 友好 | 控制平面、数据与记忆平面、质量治理平面 |
| Hermes | USER/MEMORY 小记忆、写入审批、session search、skills as procedural memory | 数据与记忆平面、质量治理平面 |
| Mem0 | 分层记忆、metadata filtering、混合检索 | 数据与记忆平面 |
| Letta | memory blocks、archival memory、background reflection | 数据与记忆平面 |
| LangGraph | state/node/edge/checkpoint、short-term/long-term memory 分离 | 控制平面、数据平面 |
| AI-youjiao | 节点手册、PPT contract、视频门禁、最终交付 gate | 控制平面、质量治理平面 |
| Coze CLI/Session | `@PPT` 文件产物通道、真实 PPTX 下载 | 运行平面 |

## 11. 架构不变量

以下原则不能被阶段性需求破坏：

1. 教师项目是中心对象。
2. Artifact 是事实对象。
3. Node Contract 是节点规则源。
4. Memory 与 Contract 必须分离。
5. Provider Adapter 不得泄露到 UI。
6. 真实文件必须真实校验。
7. 长期记忆必须可审查和可删除。
8. 工具执行必须经过 PlanGuard / HumanGate。
9. 失败必须可诊断、可恢复、可追踪。
10. 用户可见界面不得暴露工程词和敏感信息。
11. 完整 Conversation Log 必须保留；压缩只替代模型输入中的旧历史，不删除用户历史。
12. ContextPackage 是模型输入边界；模型不得直接依赖未编排的全部数据库消息。

## 12. 推荐演进顺序

1. 固化五平面与十二系统文档。
2. 建立 Node Contract MVP：先文件化 `ppt_design`、`coze_ppt`、`video_storyboard`、`video_segment_plan`、`final_package`。
3. 建立 PromptCompiler：让 Runtime 使用 contract，而不是硬编码 `taskGuidance`。
4. 建立 ContractValidator：先校验 PPT 设计稿、视频分镜、最终交付。
5. 建立 Memory MVP：TeacherProfileMemory、ProjectMemory、MemoryWriteProposal。
6. 建立 Conversation Context MVP：ConversationContextBuilder、ContextBudgetManager、SessionContextSnapshot、后台无感压缩、SummaryValidator。
7. 建立 Admin 最小后台：查看、编辑、发布、回滚节点契约；审批记忆。
8. 拆分 Orchestrator：把主对话、工作流推进、Provider 执行、失败恢复分离。

## 13. 与十二系统文档的关系

本文回答“最高层分为哪些平面”。

`docs\architecture\2026-07-09-山海智教智能体-workbench-twelve-systems.md` 回答“每个平面下有哪些系统、每个系统职责是什么、当前代码如何映射、未来怎么建设”。

后续任何阶段计划建议同时引用两份文档：

```text
五平面文档：确定职责归属。
十二系统文档：确定系统边界和落地位置。
```
