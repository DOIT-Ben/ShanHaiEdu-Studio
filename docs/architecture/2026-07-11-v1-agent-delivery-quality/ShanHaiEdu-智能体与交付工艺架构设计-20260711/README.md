# ShanHaiEdu 智能体与交付工艺架构设计包

> 状态：设计已集中沉淀并完成独立审查，尚未接入代码；`08` 仍需正式接口评审与教师样本校准。
> 基线日期：2026-07-11。
> 分析工程：`E:\desktop\AI\11_Products\lab\ShanHaiEdu-Studio\main`。
> 代码基线：分支 `main`，HEAD `02703d0b96ce2fffecaabda5721c8d79d663b8fa`，本地相对 `origin/main` 为 ahead 14 / behind 0。当前工作树在分析期间仍由另一条开发线推进；最后一次完整架构审查为 2026-07-11 16:46 +08:00，16:58 最终状态复核未发现关键架构文件继续漂移，相关在途能力均按“未提交观察”标记。
> 边界：本轮未修改项目文件、未运行写库测试、未调用会创建外部任务的真实 Provider API；所有新增内容仅位于本目录。

## 一句话结论

ShanHaiEdu 当前已经有 Main Agent、OpenAI Runtime、ToolRegistry、ToolRouter、Provider/Package Adapter、HumanGate、Artifact 与 Job 的基础骨架；真正限制 PPT 和视频交付质量的，不是“缺一个能调用 API 的 Tool”，而是缺少可执行的专业生产工艺、逐节点质量合同、真实渲染/媒体验证、独立 Critic、可定位返修和可恢复的页/镜头级状态。

## 三套架构必须分开

| 架构 | 回答的问题 | 核心组件 |
|---|---|---|
| 智能体架构 | 谁理解、谁计划、谁调用工具、怎样 Observe/Replan、怎样暂停和恢复 | Main Agent、PPT Director、Video Director、Delivery Critic、ReAct Harness、ToolRouter、Checkpoint |
| 内容生产工艺架构 | 专业人员怎样一步步做出好 PPT、好视频 | 两个内置 Skills、共享教育媒体原则、页面/镜头方法论、风格与 Provider Profiles |
| 交付质量架构 | 产物是否合格、什么条件才能继续、失败回到哪里 | Node Contract、确定性 Validator、Rubric、多模态 Critic、QualityDecision、教师批准、FinalDeliveryGate |

不能把三者合并成一个巨型 system prompt。Skill 负责“怎样做好”，Contract 负责“什么不可违反”，Tool 负责“真实执行”，Rubric/Critic 负责“结果是否够好”，Workflow/Job 负责“状态、重试、恢复和审计”。

## 当前状态与目标状态

| 维度 | 当前真实状态 | 采用本设计后的目标状态 |
|---|---|---|
| 主智能体 | 模型可自然理解并选择 capability；在途 M72 增加 Resolver，当前主要实现 confirm/switch/ordinary，cancel/revise/clarify 仍多为声明 | Main Agent 负责目标/计划；Control Resolver 只做 ActionOffer 控制语义，不能成为第二 capability planner |
| ReAct | 对话层有 Observe/Plan/Guard/Act 雏形；原生工具循环默认最多 1 轮且需环境开关 | 每次 observation 都可触发受控 Replan；同时具备 run 级总熔断与 action/tool/provider 级预算 |
| Tool 层 | ToolRegistry/ToolRouter/adapters 已存在；internal capability 只支持固定任务到 Markdown Artifact | 先增加通用 AgentToolExecutor/结构化报告协议，再接 Director/Critic；执行 Tool 保持稳定 |
| Vercel AI SDK | 未安装、未使用；当前依赖官方 `openai` 包 | 不把迁移 SDK 当成质量优化前置条件；仅在需要统一流式 UI/ToolLoopAgent 时再评估 |
| Skills | 产品运行时没有 SkillRegistry，也没有按阶段装载专家方法 | 内置 `edu-ppt-production`、`edu-intro-video-production`，共享原则作为 reference，不碎成十几个 Skill |
| Node Contract | 只有 5 份 JSON；代码只发布/读取，运行主链未消费执行 | 每个关键节点有版本化合同，Prompt Compiler、Validator、Gate 和 provenance 真实使用合同 |
| PPT | 大纲→设计稿→Coze PPTX→单张课堂图片；图片生成晚于 PPTX | 叙事大纲→视觉系统→逐页设计→关键样张→资产包→可编辑组装→渲染→审查→问题页返修 |
| 视频 | 节点名较完整，但一次计划只触发一次文本视频请求；参考图未传；MP4 字节拼接 | `shotId` 级参考资产、逐镜头任务/QA/返修、音字后期、编码归一化、FFmpeg 合成、成片审查 |
| 质量判断 | 多数是文件头、大小、slideCount 等基础真实性校验 | `ValidationReport + CriticReport + QualityDecision`；Critic 不得重判确定性硬门 |
| 持久化恢复 | Artifact/Job/TurnJob 可保存；AgentRun 仅有状态和错误；无完整 checkpoint/event | 计划、observation、工具尝试、外部 taskId、质量报告、版本、恢复点全部可追踪 |
| 项目并发 | ConversationTurnJob 有局部锁语义，但未形成统一 `projectId` 生成租约 | ProjectExecutionLease 保证同一项目仅一个生成动作，支持续租、过期恢复和跨标签幂等 |
| 最终交付 | 有 final package Tool/Contract，但没有汇总路径资格、跨产物质量和陈旧血缘的总门 | FinalDeliveryGate 只接收 final-eligible、无陈旧血缘、报告完整的真实产物 |

## 优化优先级

下列 P0/P1/P2/P3 表示 `releasePriority`，不是质量问题严重度；质量问题统一使用 `blocker / major / minor`。

1. **P0：先立并发与最终交付总门。** ProjectExecutionLease、FinalDeliveryGate、路径资格和陈旧血缘检查必须早于扩大 ReAct。
2. **P0：再修交付事实模型。** 执行 Node Contract；引入 `pageId/shotId`；视频允许同时存在多个已选定镜头；参考资产真正传 Provider；FFmpeg 替代 MP4 字节拼接。
3. **P0：建立质量证据。** PPT 必须有渲染图/contact sheet；视频必须有 ffprobe/逐镜头报告；生成 Agent 不得自评通过。
4. **P1：接专家能力和最小 Replan。** 先有通用 AgentToolExecutor，再让两个 Director 与 Critic 接入；最小 Observe→Replan 不能拖到最后。
5. **P1：完成局部返修。** PPT 返修问题页或问题资产；视频只返修失败 shot 或音字轨道。
6. **P2：补 durable checkpoint 并逐步扩大自主度。** 每个 run 仍有 maxSteps/toolCalls/cost/wallClock/context 总熔断。
7. **P3：最后决定 SDK。** Vercel AI SDK、OpenAI Agents SDK 或 LangGraph 都是运行时选项，不代替教育内容工艺和质量体系。

教师可见体验仍可保持线性里程碑；智能体内部必须允许受控 ReAct、动态选路和局部返修。这同时兼容当前权威基线中的“线性工作台”和最新 RQ-015 的“非线性按需生产”。

## 文档地图

| 文件 | 用途 |
|---|---|
| `01-当前代码基线与分析纠偏.md` | 说明分析的是哪个工程、哪些能力已存在、哪些只是设计或在途代码 |
| `02-三层架构与受控ReAct设计.md` | 定义智能体、生产工艺、交付质量三层关系和受控 ReAct 循环 |
| `03-PPT生产工艺与质量架构.md` | 给出好 PPT 的完整流程、节点工件、质量门、量表和返修路径 |
| `04-视频生产工艺与质量架构.md` | 给出好视频的逐镜头流程、门禁、量表、合成与恢复设计 |
| `05-Skills-Tools-Contracts-Rubrics职责边界.md` | 回答“是不是封装成 Tool”以及怎样避免过度约束模型 |
| `06-现有架构接入映射与实施顺序.md` | 把设计映射到当前真实代码边界，但不实施代码 |
| `07-决策记录与证据索引.md` | 保存讨论演进、关键决策、代码证据、手册和官方来源 |
| `08-节点合同-质量量表-提示词草案.md` | 可直接进入下一阶段评审的合同字段、Critic 输出和提示词骨架 |
| `09-独立审查报告.md` | 记录独立智能体对本设计包的审查、问题与修订结果 |

## 使用方式

下一阶段不是立即改代码。先按 `06` 的 Phase -1/0 处理 M72 口径、ActionOffer 和合同评审，再冻结 `08` 的 Schema、量表、Lease 与 FinalDeliveryGate，最后才写测试先行的实施计划。任何实施都应在开发中的代码稳定后，从最新 HEAD/working tree 重新核验，不能直接把本设计包里的旧行号当成永久事实。
